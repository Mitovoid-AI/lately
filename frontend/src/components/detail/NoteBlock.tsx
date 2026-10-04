import { useState } from "react";
import { Pressable, Text, TextInput, View, type TextStyle } from "react-native";

import { colors } from "../../theme/tokens";
import { Button } from "../Button";
import { Icon } from "../Icon";

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
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await onSave(draft.trim());
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <View className="rounded-2xl border border-hairline bg-card p-4">
      <View className="flex-row items-center justify-between">
        <Text className="font-sans-semibold text-label text-ink">YOUR NOTE</Text>
        {editing ? null : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Edit note"
            onPress={() => {
              setDraft(note ?? "");
              setEditing(true);
            }}
            className="-m-2 h-10 w-10 items-center justify-center"
          >
            <Icon name="edit" size={18} color={colors.ink2} />
          </Pressable>
        )}
      </View>
      {editing ? (
        <View className="mt-3">
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Why did you save this?"
            placeholderTextColor={colors.ink3}
            autoFocus
            multiline
            maxLength={500}
            className="min-h-12 rounded-ctl border border-hairline bg-canvas px-3 py-3 font-sans text-body text-ink"
          />
          <View className="mt-3 flex-row gap-2">
            <Button title="Cancel" variant="secondary" onPress={() => setEditing(false)} className="flex-1" />
            <Button title="Save" onPress={save} disabled={!draft.trim()} loading={saving} className="flex-1" />
          </View>
        </View>
      ) : note ? (
        <Text className="mt-2 font-sans-italic text-body text-ink-2" style={textStyle}>{`“${note}”`}</Text>
      ) : (
        <Pressable accessibilityRole="button" onPress={() => setEditing(true)} className="mt-2">
          <Text className="font-sans-semibold text-body text-accent">Add a note</Text>
          <Text className="mt-0.5 font-sans text-meta text-ink-2">A note makes this easy to find later.</Text>
        </Pressable>
      )}
    </View>
  );
}
