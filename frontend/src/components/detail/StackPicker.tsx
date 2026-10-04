import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";

import type { Stack } from "../../api/contract";
import { useApi } from "../../api/index";
import { colors } from "../../theme/tokens";
import { Icon } from "../Icon";
import { NewStackForm } from "../NewStackForm";
import { Sheet } from "../Sheet";
import { StackCollage } from "../StackCollage";
import { useToast } from "../Toast";

/** "Add to stack" sheet opened from a card's bookmark. */
export function StackPicker({ visible, saveId, onClose }: { visible: boolean; saveId: string; onClose: () => void }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const stacks = useQuery({ queryKey: ["stacks"], queryFn: () => api.listStacks(), enabled: visible });

  async function add(stack: Stack) {
    try {
      await api.addToStack(stack.id, saveId);
      queryClient.invalidateQueries({ queryKey: ["stacks"] });
      queryClient.invalidateQueries({ queryKey: ["stack", stack.id] });
      toast.show(`Added to ${stack.name}`);
      setCreating(false);
      onClose();
    } catch {
      toast.show("Couldn't add it. Try again.");
    }
  }

  return (
    <Sheet
      visible={visible}
      onClose={() => {
        setCreating(false);
        onClose();
      }}
    >
      {creating ? (
        <NewStackForm onCreated={add} />
      ) : (
        <View>
          <Text className="font-display text-display-md text-ink">Add to stack</Text>
          {stacks.isLoading ? <ActivityIndicator className="my-6" color={colors.accent} /> : null}
          <ScrollView style={{ maxHeight: 360 }} className="mt-3">
            {(stacks.data ?? []).map((s) => (
              <Pressable key={s.id} accessibilityRole="button" onPress={() => add(s)} className="h-14 flex-row items-center active:opacity-80">
                <StackCollage covers={s.cover_urls} size={40} radius={8} />
                <Text className="ml-3 flex-1 font-sans-medium text-body text-ink">{s.name}</Text>
                <Text className="font-sans text-meta text-ink-2">{s.save_count}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <Pressable accessibilityRole="button" onPress={() => setCreating(true)} className="mt-1 h-14 flex-row items-center">
            <View className="h-10 w-10 items-center justify-center rounded-lg border border-dashed border-ink-3">
              <Icon name="add" size={20} color={colors.ink2} />
            </View>
            <Text className="ml-3 font-sans-semibold text-body text-accent">New stack</Text>
          </Pressable>
        </View>
      )}
    </Sheet>
  );
}
