import { useRef, useState } from "react";
import { StyleSheet, Text, View, type TextStyle } from "react-native";
import Animated, { FadeIn, LinearTransition } from "react-native-reanimated";

import { DURATION, EASE_OUT } from "../../theme/motion";
import { useTheme } from "../../theme/ThemeProvider";
import { Button } from "../Button";
import { IconButton } from "../motion/IconButton";
import { PressableScale } from "../motion/PressableScale";
import { TextField } from "../TextField";
import { useToast } from "../Toast";
import { haptic } from "../../lib/haptics";

// The card eases to its new height while the next mode dissolves in.
const RESIZE = LinearTransition.duration(240).easing(EASE_OUT);
const MODE_IN = FadeIn.duration(DURATION.state);

/** "Your note" card: shows the note in quotes, edits in place. */
export function NoteBlock({
  note,
  onSave,
  textStyle,
}: {
  note: string | null;
  onSave: (note: string) => Promise<void>;
  textStyle?: TextStyle;
}) {
  const { colors } = useTheme();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note ?? "");
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);
  const toast = useToast();

  function edit() {
    setDraft(note ?? "");
    setTouched(true);
    setEditing(true);
  }

  const inFlight = useRef(false);
  async function save() {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    try {
      await onSave(draft.trim());
      setEditing(false);
    } catch {
      // Stay in edit mode with the draft intact so nothing typed is lost.
      haptic.error();
      toast.show("Couldn't save your note. Try again.");
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  const entering = touched ? MODE_IN : undefined;

  return (
    <Animated.View layout={RESIZE} style={[styles.card, { borderColor: colors.hairline, backgroundColor: colors.card }]}>
      <View className="flex-row items-center justify-between">
        <Text className="font-sans-semibold text-label text-ink">YOUR NOTE</Text>
        {editing ? null : (
          <View className="-m-3">
            <IconButton icon="edit" size={18} label="Edit note" onPress={edit} />
          </View>
        )}
      </View>
      {editing ? (
        <Animated.View key="edit" entering={entering} style={styles.editing}>
          <TextField
            value={draft}
            onChangeText={setDraft}
            placeholder="Why did you save this?"
            autoFocus
            multiline
            maxLength={500}
          />
          <View className="mt-3 flex-row gap-2">
            <Button title="Cancel" variant="secondary" onPress={() => setEditing(false)} className="flex-1" />
            <Button title="Save" onPress={save} disabled={!draft.trim()} loading={saving} className="flex-1" />
          </View>
        </Animated.View>
      ) : note ? (
        <Animated.View key="note" entering={entering}>
          <Text className="mt-2 font-sans-italic text-body text-ink-2" style={textStyle}>{`“${note}”`}</Text>
        </Animated.View>
      ) : (
        <Animated.View key="empty" entering={entering}>
          <PressableScale accessibilityRole="button" onPress={edit} scaleTo={0.98} containerClassName="mt-2 self-start">
            <Text className="font-sans-semibold text-body text-accent-text">Add a note</Text>
            <Text className="mt-0.5 font-sans text-meta text-ink-2">A note makes this easy to find later.</Text>
          </PressableScale>
        </Animated.View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    overflow: "hidden",
  },
  editing: { marginTop: 12 },
});
