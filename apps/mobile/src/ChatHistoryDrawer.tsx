import { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  FlatList,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ChatSessionMeta, InboxListEntry } from "./api";

const DELETE_WIDTH = 76;

interface Props {
  visible: boolean;
  sessions: ChatSessionMeta[];
  inboxFiles?: InboxListEntry[];
  activeSessionId: string | null;
  onClose: () => void;
  onSelect: (sessionId: string) => void;
  onNewChat: () => void;
  onDelete: (sessionId: string) => void;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

interface SwipeableRowProps {
  active: boolean;
  title: string;
  when: string;
  isOpen: boolean;
  onPress: () => void;
  onDelete: () => void;
  onSwipeOpen: () => void;
}

function SwipeableSessionRow({
  active,
  title,
  when,
  isOpen,
  onPress,
  onDelete,
  onSwipeOpen,
}: SwipeableRowProps) {
  const translateX = useRef(new Animated.Value(0)).current;
  const openRef = useRef(false);

  const snapTo = useCallback(
    (open: boolean) => {
      openRef.current = open;
      Animated.spring(translateX, {
        toValue: open ? -DELETE_WIDTH : 0,
        useNativeDriver: true,
        bounciness: 0,
      }).start();
    },
    [translateX],
  );

  useEffect(() => {
    if (!isOpen && openRef.current) snapTo(false);
  }, [isOpen, snapTo]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > 6 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderGrant: () => {
        onSwipeOpen();
      },
      onPanResponderMove: (_, g) => {
        const base = openRef.current ? -DELETE_WIDTH : 0;
        const next = Math.min(0, Math.max(-DELETE_WIDTH, base + g.dx));
        translateX.setValue(next);
      },
      onPanResponderRelease: (_, g) => {
        const base = openRef.current ? -DELETE_WIDTH : 0;
        const projected = base + g.dx;
        const shouldOpen = projected < -DELETE_WIDTH * 0.4 || g.vx < -0.5;
        snapTo(shouldOpen);
        if (shouldOpen) onSwipeOpen();
      },
      onPanResponderTerminationRequest: () => false,
    }),
  ).current;

  const handleDelete = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    snapTo(false);
    onDelete();
  };

  return (
    <View style={styles.swipeWrap}>
      <Pressable style={styles.deleteAction} onPress={handleDelete}>
        <Text style={styles.deleteIcon}>🗑</Text>
      </Pressable>
      <Animated.View
        style={[styles.swipeForeground, { transform: [{ translateX }] }]}
        {...panResponder.panHandlers}
      >
        <Pressable
          style={[styles.row, active && styles.rowActive]}
          onPress={() => {
            if (openRef.current) {
              snapTo(false);
              return;
            }
            onPress();
          }}
        >
          <Text style={[styles.rowTitle, active && styles.rowTitleActive]} numberOfLines={2}>
            {title || "New chat"}
          </Text>
          <Text style={styles.rowMeta}>{when}</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

export function ChatHistoryDrawer({
  visible,
  sessions,
  inboxFiles = [],
  activeSessionId,
  onClose,
  onSelect,
  onNewChat,
  onDelete,
}: Props) {
  const insets = useSafeAreaInsets();
  const [openRowId, setOpenRowId] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) setOpenRowId(null);
  }, [visible]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.drawer, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.header}>
          <Text style={styles.title}>Chats</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={styles.close}>Done</Text>
          </Pressable>
        </View>

        <Pressable style={styles.newBtn} onPress={onNewChat}>
          <Text style={styles.newBtnText}>+ New conversation</Text>
        </Pressable>

        {inboxFiles.length > 0 ? (
          <View style={styles.inboxSection}>
            <Text style={styles.inboxHeading}>Atlas inbox</Text>
            {inboxFiles.slice(0, 6).map((file) => (
              <View key={file.path} style={styles.inboxRow}>
                <Text style={styles.inboxTitle} numberOfLines={2}>
                  {file.title}
                </Text>
                <Text style={styles.inboxMeta}>{formatWhen(file.writtenAt)}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <FlatList
          data={sessions}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          onScrollBeginDrag={() => setOpenRowId(null)}
          ListHeaderComponent={
            sessions.length > 0 ? (
              <Text style={styles.sectionHeading}>Recent chats</Text>
            ) : null
          }
          ListEmptyComponent={
            <Text style={styles.empty}>No saved chats yet — your turns are stored automatically.</Text>
          }
          renderItem={({ item }) => {
            const active = item.id === activeSessionId;
            return (
              <SwipeableSessionRow
                active={active}
                title={item.title || "New chat"}
                when={formatWhen(item.updated_at)}
                isOpen={openRowId === item.id}
                onSwipeOpen={() => setOpenRowId(item.id)}
                onPress={() => onSelect(item.id)}
                onDelete={() => onDelete(item.id)}
              />
            );
          }}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  drawer: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: "82%",
    maxWidth: 320,
    backgroundColor: "#121820",
    borderRightWidth: 1,
    borderRightColor: "#2a3344",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  title: {
    color: "#f4f6fa",
    fontSize: 20,
    fontWeight: "700",
  },
  close: {
    color: "#7eb6ff",
    fontSize: 16,
    fontWeight: "600",
  },
  newBtn: {
    marginHorizontal: 16,
    marginBottom: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: "#1e2a3d",
    borderWidth: 1,
    borderColor: "#334155",
  },
  newBtnText: {
    color: "#e8edf5",
    fontSize: 15,
    fontWeight: "600",
  },
  inboxSection: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: "#151c28",
    borderWidth: 1,
    borderColor: "#2a3344",
  },
  inboxHeading: {
    color: "#9ca8b8",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  inboxRow: {
    marginBottom: 8,
  },
  inboxTitle: {
    color: "#d8dee9",
    fontSize: 14,
    fontWeight: "500",
  },
  inboxMeta: {
    color: "#6b7280",
    fontSize: 11,
    marginTop: 2,
  },
  sectionHeading: {
    color: "#9ca8b8",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  list: {
    paddingHorizontal: 8,
    paddingBottom: 24,
  },
  empty: {
    color: "#8b95a5",
    fontSize: 14,
    lineHeight: 20,
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  swipeWrap: {
    marginBottom: 4,
    borderRadius: 10,
    overflow: "hidden",
  },
  deleteAction: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    width: DELETE_WIDTH,
    backgroundColor: "#dc2626",
    alignItems: "center",
    justifyContent: "center",
  },
  deleteIcon: {
    fontSize: 22,
  },
  swipeForeground: {
    backgroundColor: "#121820",
  },
  row: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  rowActive: {
    backgroundColor: "#1a2433",
  },
  rowTitle: {
    color: "#d8dee9",
    fontSize: 15,
    fontWeight: "500",
    marginBottom: 4,
  },
  rowTitleActive: {
    color: "#ffffff",
  },
  rowMeta: {
    color: "#6b7280",
    fontSize: 12,
  },
});
