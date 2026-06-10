import { useCallback, useEffect, useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  fetchSpeakers,
  resetSpeakerSession,
  updateSpeakerProfile,
  type SpeakerProfile,
} from "./api";

interface SpeakerSettingsModalProps {
  visible: boolean;
  sessionKey: string;
  wakeWordEnabled: boolean;
  wakeWordAvailable: boolean;
  wakeWordLabel: string;
  buildStamp: string;
  shortcutListenUrl: string;
  onClose: () => void;
  onToggleWakeWord: (enabled: boolean) => void;
}

export function SpeakerSettingsModal({
  visible,
  sessionKey,
  wakeWordEnabled,
  wakeWordAvailable,
  wakeWordLabel,
  buildStamp,
  shortcutListenUrl,
  onClose,
  onToggleWakeWord,
}: SpeakerSettingsModalProps) {
  const [speakers, setSpeakers] = useState<SpeakerProfile[]>([]);
  const [draftNames, setDraftNames] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchSpeakers();
      setSpeakers(data.speakers);
      setDraftNames(
        Object.fromEntries(data.speakers.map((s) => [s.slug, s.displayName])),
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not load speakers");
    }
  }, []);

  useEffect(() => {
    if (visible) {
      setNotice(null);
      void load();
    }
  }, [visible, load]);

  const saveSpeaker = async (slug: string, role: "owner" | "guest") => {
    const displayName = draftNames[slug]?.trim();
    if (!displayName) return;
    try {
      await updateSpeakerProfile({ slug, displayName, role });
      setNotice(`Saved ${displayName}`);
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Save failed");
    }
  };

  const resetMaps = async () => {
    try {
      const result = await resetSpeakerSession(sessionKey);
      setNotice(`Cleared ${result.cleared} voice ID map(s) for this session`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Reset failed");
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Speakers & wake</Text>
          <Text style={styles.help}>
            Grok STT assigns speaker IDs per session. ID 0 → owner, ID 1 → guest by
            default. Reset maps if someone was misidentified.
          </Text>

          {speakers.map((speaker) => (
            <View key={speaker.slug} style={styles.row}>
              <View style={styles.rowMeta}>
                <Text style={styles.role}>{speaker.role}</Text>
                <Text style={styles.slug}>{speaker.slug}</Text>
              </View>
              <TextInput
                style={styles.input}
                value={draftNames[speaker.slug] ?? speaker.displayName}
                onChangeText={(text) =>
                  setDraftNames((prev) => ({ ...prev, [speaker.slug]: text }))
                }
                placeholder="Display name"
                placeholderTextColor="#5b6675"
              />
              <Pressable
                style={styles.saveBtn}
                onPress={() => void saveSpeaker(speaker.slug, speaker.role)}
              >
                <Text style={styles.saveBtnText}>Save</Text>
              </Pressable>
            </View>
          ))}

          <Pressable style={styles.secondaryBtn} onPress={() => void resetMaps()}>
            <Text style={styles.secondaryBtnText}>Reset voice ID maps (this session)</Text>
          </Pressable>

          <Text style={styles.help}>
            Wake listens in the background while the app is idle. Say the keyword to start a voice
            turn without tapping the mic. Without a Picovoice key, Atlas uses on-device speech
            recognition and listens for &quot;Hey Atlas&quot;.
          </Text>

          <View style={styles.wakeRow}>
            <Text style={styles.wakeLabel}>Wake word ({wakeWordLabel})</Text>
            <Pressable
              style={[styles.wakeToggle, wakeWordEnabled && styles.wakeToggleOn]}
              onPress={() => onToggleWakeWord(!wakeWordEnabled)}
              disabled={!wakeWordAvailable}
            >
              <Text style={styles.wakeToggleText}>
                {!wakeWordAvailable ? "Unavailable" : wakeWordEnabled ? "On" : "Off"}
              </Text>
            </Pressable>
          </View>

          <Text style={styles.help}>
            Siri shortcut (requires unlock when phone is locked): Shortcuts → Open URL →{" "}
            <Text style={styles.mono}>{shortcutListenUrl}</Text>. Prefer wake word below when
            the app is open. See docs/SHORTCUTS.md.
          </Text>

          {notice && <Text style={styles.notice}>{notice}</Text>}

          <Text style={styles.buildStamp}>Build {buildStamp}</Text>

          <Pressable style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeBtnText}>Done</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#141a24",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    gap: 12,
  },
  title: { color: "#e8edf4", fontSize: 18, fontWeight: "600" },
  help: { color: "#8b95a5", fontSize: 13, lineHeight: 18 },
  mono: { color: "#c5d0de", fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
  row: { gap: 8 },
  rowMeta: { flexDirection: "row", gap: 8, alignItems: "center" },
  role: {
    color: "#f59e0b",
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  slug: { color: "#5b6675", fontSize: 12 },
  input: {
    backgroundColor: "#0d121b",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "#e8edf4",
    borderWidth: 1,
    borderColor: "#243044",
  },
  saveBtn: {
    alignSelf: "flex-start",
    backgroundColor: "#1f6feb",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  saveBtnText: { color: "#fff", fontWeight: "600" },
  secondaryBtn: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#243044",
    padding: 12,
  },
  secondaryBtnText: { color: "#c5d0de", textAlign: "center" },
  wakeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 4,
  },
  wakeLabel: { color: "#c5d0de", flex: 1, paddingRight: 12 },
  wakeToggle: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#243044",
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  wakeToggleOn: { backgroundColor: "#3b2f12", borderColor: "#f59e0b" },
  wakeToggleText: { color: "#e8edf4", fontWeight: "600" },
  notice: { color: "#93c5fd", fontSize: 13 },
  buildStamp: { color: "#5b6675", fontSize: 11, textAlign: "center" },
  closeBtn: {
    marginTop: 4,
    backgroundColor: "#1f6feb",
    borderRadius: 10,
    paddingVertical: 12,
  },
  closeBtnText: { color: "#fff", textAlign: "center", fontWeight: "600" },
});
