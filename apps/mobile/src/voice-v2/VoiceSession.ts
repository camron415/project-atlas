/**
 * Voice v2 — single owner for Path B lifecycle.
 * AVAudioSession stays active from connecting through each turn; mic + WS in parallel.
 */
import {
  isNativeAudioCaptureAvailable,
  releaseNativeAudioSession,
  startNativeAudioCapture,
  startNativeBackgroundHold,
  stopNativeAudioCapture,
  stopNativeBackgroundHold,
} from "atlas-audio-capture";
import { fetchRealtimeClientSecret } from "../api";
import { activateVoiceSessionAudio } from "../background-audio";
import { stopPlayback } from "../audio";
import { dlog, dwarn } from "../log";
import { applyVoiceAudioMode, ensureSpeechReady, prepareForNativeStream } from "../speech";
import { startUnifiedPcmPlayback, stopUnifiedPcmPlayback } from "../realtime-playback";
import { connectRealtime, type RealtimeConnection } from "./RealtimeConnection";
import type { RealtimeEvent, VoicePhase, VoiceSessionOptions, VoiceTurnDeps } from "./types";

const noop = () => {};
const TURN_COMMIT_MS = 1400;

function isConnectionLive(conn: RealtimeConnection | null): boolean {
  return Boolean(conn?.isOpen() && conn.isReady());
}

export class VoiceSession {
  private phase: VoicePhase = "idle";
  private active = false;
  private interrupted = false;
  private sessionGen = 0;

  private connection: RealtimeConnection | null = null;
  private captureStop: (() => Promise<void>) | null = null;
  private micStartPromise: Promise<void> | null = null;
  private holdActive = false;

  private playback: Awaited<ReturnType<typeof startUnifiedPcmPlayback>> | null = null;
  private playbackChain = Promise.resolve();
  private turnInFlight = false;
  private atlasText = "";
  private turnTranscript = "";
  private lastCommittedText = "";
  private commitTimer: ReturnType<typeof setTimeout> | null = null;

  private lock: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly options: VoiceSessionOptions,
    private readonly deps: () => VoiceTurnDeps,
  ) {}

  getPhase(): VoicePhase {
    return this.phase;
  }

  isActive(): boolean {
    return this.active;
  }

  isListenActive(): boolean {
    if (!this.active || !isConnectionLive(this.connection)) return false;
    return (
      this.phase === "listening" ||
      this.phase === "connecting" ||
      Boolean(this.captureStop)
    );
  }

  isSessionHealthy(): boolean {
    return this.active && isConnectionLive(this.connection);
  }

  isCaptureRunning(): boolean {
    return Boolean(this.captureStop) || this.holdActive;
  }

  getTranscript(): string {
    return this.turnTranscript.trim();
  }

  private runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.lock.then(fn, fn);
    this.lock = next.then(noop, noop);
    return next;
  }

  private setPhase(phase: VoicePhase): void {
    this.phase = phase;
    const deps = this.deps();
    if (phase === "listening") deps.onStatus("listening");
    if (phase === "thinking") deps.onStatus("thinking");
    if (phase === "speaking") deps.onStatus("speaking");
  }

  private emitListenPhase(phase: "connecting" | "hearing" | "transcribing"): void {
    this.options.onListenPhase?.(phase);
  }

  private async stopMic(): Promise<void> {
    const stop = this.captureStop;
    this.captureStop = null;
    if (!stop) return;
    try {
      await stop();
    } catch {
      await stopNativeAudioCapture().catch(noop);
    }
  }

  private async startBackgroundHold(): Promise<void> {
    if (this.holdActive) return;
    try {
      await startNativeBackgroundHold();
      this.holdActive = true;
    } catch (e) {
      dwarn("voice-v2", "background hold failed", e);
    }
  }

  private async stopBackgroundHold(): Promise<void> {
    if (!this.holdActive) return;
    try {
      await stopNativeBackgroundHold();
    } catch {}
    this.holdActive = false;
  }

  private closeConnection(): void {
    this.sessionGen += 1;
    const conn = this.connection;
    this.connection = null;
    conn?.close();
  }

  private async stopPlaybackPipeline(): Promise<void> {
    this.playback = null;
    this.playbackChain = Promise.resolve();
    await stopUnifiedPcmPlayback();
    await stopPlayback();
  }

  /** Start mic once; PCM buffers until Realtime is ready. */
  private async ensureMic(): Promise<void> {
    if (this.captureStop) return;
    if (this.micStartPromise) return this.micStartPromise;

    const work = (async () => {
      if (this.captureStop) return;
      await this.stopBackgroundHold();
      await applyVoiceAudioMode({ continuousVoice: true });
      let firstChunk = false;
      const stop = await startNativeAudioCapture((chunk) => {
        if (!this.active) return;
        if (this.phase === "speaking") return;
        if (!firstChunk) {
          firstChunk = true;
          dlog("voice-v2", "first pcm chunk");
        }
        this.connection?.appendMicPcmBase64(chunk.base64);
      });
      this.captureStop = stop;
    })().finally(() => {
      this.micStartPromise = null;
    });

    this.micStartPromise = work;
    return work;
  }

  private async restartMic(): Promise<void> {
    await this.stopMic();
    await this.ensureMic();
  }

  private clearCommitTimer(): void {
    if (this.commitTimer) {
      clearTimeout(this.commitTimer);
      this.commitTimer = null;
    }
  }

  private scheduleTurnCommit(): void {
    this.clearCommitTimer();
    this.commitTimer = setTimeout(() => {
      this.commitTimer = null;
      const text = this.turnTranscript.trim();
      if (!text) return;
      void this.handleUserTurn(text);
    }, TURN_COMMIT_MS);
  }

  private async finishPlayback(): Promise<void> {
    await this.playbackChain;
    if (this.playback) {
      await this.playback.finish();
      await this.playback.completion;
    }
    this.playback = null;
  }

  private async handleUserTurn(text: string): Promise<void> {
    const clean = text.trim();
    if (!clean || this.turnInFlight) return;
    if (clean === this.lastCommittedText) return;

    this.turnInFlight = true;
    this.lastCommittedText = clean;
    const deps = this.deps();
    const interrupted = this.interrupted;
    this.interrupted = false;

    this.setPhase("thinking");
    this.emitListenPhase("transcribing");
    deps.onUserMessage(clean);
    this.turnTranscript = "";
    this.options.onPartial("");

    const history = deps.getHistory();
    const deep = deps.isDeep(clean);
    const needsRefresh = deps.isRefresh(clean);
    const needsResearch = deps.isResearch(clean);
    const needsMoment = deep || needsRefresh || needsResearch;

    try {
      if (!isConnectionLive(this.connection)) {
        throw new Error("Voice connection lost — tap mic to reconnect.");
      }

      if (needsMoment) {
        await this.stopMic();
        await deps.onMoment();
        await this.stopPlaybackPipeline();
      }

      if (needsRefresh) {
        await deps.onRefresh();
      }

      let messageForAtlas = clean;
      if (needsResearch) {
        const loc = await deps.getLocationPrefix();
        if (loc) messageForAtlas = `${loc} ${clean}`;
      }

      if (deep) {
        this.connection?.cancelResponse();
        await this.stopPlaybackPipeline();
        await deps.onDeepTurn(messageForAtlas, history, interrupted, needsMoment);
        this.setPhase("listening");
        await this.restartMic();
        return;
      }

      await prepareForNativeStream({ continuousVoice: true });
      this.connection?.requestResponse();
      this.atlasText = "";
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.options.onError(msg);
      this.lastCommittedText = "";
      this.setPhase("listening");
      await this.restartMic();
    } finally {
      this.turnInFlight = false;
    }
  }

  private onRealtimeEvent(event: RealtimeEvent): void {
    if (event.type === "configured") {
      dlog("voice-v2", `configured session=${event.sessionId ?? ""}`);
      return;
    }
    if (event.type === "speech_started") {
      this.clearCommitTimer();
      return;
    }
    if (event.type === "speech_stopped") {
      this.scheduleTurnCommit();
      return;
    }
    if (event.type === "user_transcript") {
      this.turnTranscript = event.text;
      this.options.onPartial(event.text);
      return;
    }
    if (event.type === "atlas_text_delta") {
      this.atlasText = event.text;
      this.deps().onAtlasDelta(event.text);
      return;
    }
    if (event.type === "audio_delta") {
      this.playbackChain = this.playbackChain.then(async () => {
        const enteringSpeak = this.phase !== "speaking";
        if (enteringSpeak) {
          this.setPhase("speaking");
          await prepareForNativeStream({ continuousVoice: true });
        }
        if (!this.playback) {
          this.playback = await startUnifiedPcmPlayback(24000, () => {
            this.deps().onStatus("speaking");
          });
        }
        await this.playback.appendBase64Chunk(event.base64);
        if (enteringSpeak) {
          setTimeout(() => {
            void this.stopMic().then(() => this.startBackgroundHold());
          }, 220);
        }
      });
      return;
    }
    if (event.type === "response_done") {
      void (async () => {
        await this.playbackChain;
        await this.finishPlayback();
        await new Promise((resolve) => setTimeout(resolve, 150));
        const reply = this.atlasText.trim();
        if (reply) this.deps().onAtlasComplete(reply);
        this.atlasText = "";
        if (!isConnectionLive(this.connection)) {
          this.active = false;
          this.setPhase("idle");
          this.options.onError("Voice connection ended — tap mic to continue.");
          return;
        }
        this.setPhase("listening");
        this.emitListenPhase("hearing");
        await this.restartMic();
        const m = this.connection?.metrics();
        if (m) {
          dlog(
            "voice-v2",
            `turn complete connect=${m.realtimeConnectMs ?? "?"}ms firstAudio=${m.firstAudioDeltaMs ?? "?"}ms total=${m.turnCompleteMs ?? "?"}ms`,
          );
        }
      })();
      return;
    }
    if (event.type === "error") {
      this.options.onError(event.message);
    }
  }

  private async openSession(): Promise<void> {
    const gen = this.sessionGen + 1;
    this.sessionGen = gen;

    await activateVoiceSessionAudio();
    await this.stopPlaybackPipeline();
    await applyVoiceAudioMode({ continuousVoice: true });
    await ensureSpeechReady();

    this.setPhase("connecting");
    this.emitListenPhase("connecting");

    const secret = await fetchRealtimeClientSecret();
    const wsUrl = secret.proxyWsUrl ?? secret.wsUrl;
    if (!secret.proxyWsUrl) {
      dwarn("voice-v2", "proxyWsUrl missing — using direct xAI WS (no Mac proxy)");
    }

    const onEvent = (event: RealtimeEvent) => {
      if (gen !== this.sessionGen || this.connection === null) return;
      this.onRealtimeEvent(event);
    };

    const conn = connectRealtime(wsUrl, secret.value, onEvent);
    this.connection = conn;
    const history = this.deps().getHistory();
    if (history.length > 0) {
      dlog("voice-v2", `seeding ${history.length} prior turns into realtime session`);
    }
    conn.configure({
      instructions: this.deps().getInstructions(),
      voice: this.deps().getVoice(),
      history,
    });

    const micReady = this.ensureMic();

    try {
      await conn.waitReady();
      if (gen !== this.sessionGen) {
        throw new Error("Voice session interrupted — tap mic to try again.");
      }
      await micReady;
    } catch (error) {
      await this.stopMic();
      throw error;
    }

    this.emitListenPhase("hearing");
    this.setPhase("listening");
  }

  private async teardownAll(): Promise<void> {
    this.active = false;
    this.turnInFlight = false;
    this.clearCommitTimer();
    this.turnTranscript = "";
    this.lastCommittedText = "";
    this.closeConnection();
    await this.stopMic();
    await this.stopBackgroundHold();
    await this.stopPlaybackPipeline();
    await releaseNativeAudioSession().catch(noop);
    this.setPhase("idle");
    this.options.onPartial("");
  }

  async start(): Promise<void> {
    if (!isNativeAudioCaptureAvailable()) {
      throw new Error("Native audio capture is not available — rebuild the iOS app.");
    }
    await this.runExclusive(async () => {
      await this.teardownAll();
      this.active = true;
      this.interrupted = false;
      try {
        await this.openSession();
      } catch (error) {
        this.active = false;
        await this.stopMic().catch(noop);
        await releaseNativeAudioSession().catch(noop);
        throw error;
      }
    });
  }

  async stop(): Promise<void> {
    await this.runExclusive(async () => {
      await this.teardownAll();
      this.options.onCaptureEnd?.();
    });
  }

  async resumeListen(): Promise<void> {
    await this.runExclusive(async () => {
      if (!this.active || !isConnectionLive(this.connection)) {
        this.closeConnection();
        await this.stopMic();
        await this.stopBackgroundHold();
        this.active = true;
        this.interrupted = false;
        await this.openSession();
        return;
      }
      this.setPhase("listening");
      this.emitListenPhase("hearing");
      await this.restartMic();
    });
  }

  async pauseForPlayback(): Promise<void> {
    await this.runExclusive(async () => {
      await this.stopMic();
      await this.startBackgroundHold();
    });
  }

  async resetSession(): Promise<void> {
    await this.runExclusive(() => this.teardownAll());
  }

  markInterrupted(): void {
    this.interrupted = true;
    this.connection?.cancelResponse();
    void this.stopPlaybackPipeline().then(() => this.resumeListen());
  }

  destroy(): void {
    void this.runExclusive(() => this.teardownAll());
  }
}
