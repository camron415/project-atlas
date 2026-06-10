import type { ChatTurn } from "../api";
import type { ListenPhase } from "../useVoiceCapture";

export type VoicePhase = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "error";

export interface AnalystStatus {
  status: "running" | "done" | "error";
  jobId?: string;
  project?: string;
  error?: string;
}

export interface VoiceTurnDeps {
  getInstructions: () => string;
  getVoice: () => string;
  getHistory: () => ChatTurn[];
  getChatSessionId?: () => string | null;
  onAnalystStatus?: (status: AnalystStatus | null) => void;
  isDeep: (text: string) => boolean;
  isRefresh: (text: string) => boolean;
  isResearch: (text: string) => boolean;
  onUserMessage: (text: string) => void;
  onAtlasDelta: (text: string) => void;
  onAtlasComplete: (text: string) => void;
  onStatus: (status: "listening" | "thinking" | "speaking") => void;
  onDeepTurn: (
    text: string,
    history: ChatTurn[],
    interrupted: boolean,
    afterHold: boolean,
  ) => Promise<void>;
  onRefresh: () => Promise<void>;
  onMoment: () => Promise<void>;
  getLocationPrefix: () => Promise<string | null>;
}

export interface VoiceSessionOptions {
  onPartial: (text: string) => void;
  onListenPhase?: (phase: ListenPhase) => void;
  onError: (message: string) => void;
  onCaptureEnd?: () => void;
}

export interface RealtimeConfigure {
  instructions: string;
  voice: string;
  history?: ChatTurn[];
  chatSessionId?: string;
}

export type RealtimeEvent =
  | { type: "configured"; sessionId?: string }
  | { type: "speech_started" }
  | { type: "speech_stopped" }
  | { type: "user_transcript"; text: string; isFinal: boolean }
  | { type: "atlas_text_delta"; text: string }
  | { type: "audio_delta"; base64: string }
  | { type: "response_done" }
  | { type: "error"; message: string }
  | {
      type: "analyst_status";
      status: "running" | "done" | "error";
      jobId: string;
      project: string;
      error?: string;
    };
