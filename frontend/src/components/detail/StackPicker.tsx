import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";

import type { Stack } from "../../api/contract";
import { useApi } from "../../api/index";
import { haptic } from "../../lib/haptics";
import { DURATION } from "../../theme/motion";
import { colors } from "../../theme/tokens";
import { Icon } from "../Icon";
import { PressableScale } from "../motion/PressableScale";
import { Reveal } from "../motion/Reveal";
import { NewStackForm } from "../NewStackForm";
import { Sheet } from "../Sheet";
import { Skeleton } from "../Skeleton";
import { StackCollage } from "../StackCollage";
import { useToast } from "../Toast";

const MODE_IN = FadeIn.duration(DURATION.state);

/** "Add to stack" sheet opened from a card's bookmark. */
export function StackPicker({
  visible,
  saveId,
  onClose,
  onAdded,
}: {
  visible: boolean;
  saveId: string;
  onClose: () => void;
  /** Called after the save lands in a stack (the bookmark answers with a pop). */
  onAdded?: (stack: Stack) => void;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const stacks = useQuery({ queryKey: ["stacks"], queryFn: () => api.listStacks(), enabled: visible });

  // One add per opening: a second tap (even after the first landed, while the sheet is
  // closing) does nothing. Reopening the sheet re-arms it; a failure lets the user retry.
  const adding = useRef(false);
  useEffect(() => {
    if (visible) adding.current = false;
  }, [visible]);

  async function add(stack: Stack) {
    if (adding.current) return;
    adding.current = true;
    try {
      await api.addToStack(stack.id, saveId);
      haptic.success();
      queryClient.invalidateQueries({ queryKey: ["stacks"] });
      queryClient.invalidateQueries({ queryKey: ["stack", stack.id] });
      toast.show(`Added to ${stack.name}`);
      setCreating(false);
      onAdded?.(stack);
      onClose();
    } catch {
      haptic.error();
      toast.show("Couldn't add it. Try again.");
      adding.current = false;
    }
  }

  return (
    <Sheet
      visible={visible}
      fluid
      onClose={() => {
        setCreating(false);
        onClose();
      }}
    >
      {creating ? (
        <Animated.View key="create" entering={MODE_IN}>
          <NewStackForm onCreated={add} />
        </Animated.View>
      ) : (
        <View>
          <Text className="font-display text-display-md text-ink">Add to stack</Text>
          {stacks.isLoading ? (
            <View className="mt-3 gap-2">
              {[0, 1, 2].map((i) => (
                <View key={i} className="h-14 flex-row items-center">
                  <Skeleton style={{ width: 40, height: 40, borderRadius: 8 }} />
                  <Skeleton style={{ marginLeft: 12, height: 14, width: "45%", borderRadius: 7 }} />
                </View>
              ))}
            </View>
          ) : null}
          <ScrollView style={{ maxHeight: 360 }} className="mt-3">
            {(stacks.data ?? []).map((s, i) => (
              <Reveal key={s.id} index={i}>
                <PressableScale
                  accessibilityRole="button"
                  onPress={() => add(s)}
                  scaleTo={1}
                  highlightColor={colors.raised}
                  className="-mx-2 h-14 flex-row items-center rounded-xl px-2"
                >
                  <StackCollage covers={s.cover_urls} size={40} radius={8} />
                  <Text className="ml-3 flex-1 font-sans-medium text-body text-ink">{s.name}</Text>
                  <Text className="font-sans text-meta text-ink-2">{s.save_count}</Text>
                </PressableScale>
              </Reveal>
            ))}
          </ScrollView>
          <PressableScale
            accessibilityRole="button"
            onPress={() => setCreating(true)}
            scaleTo={1}
            highlightColor={colors.raised}
            className="-mx-2 mt-1 h-14 flex-row items-center rounded-xl px-2"
          >
            <View className="h-10 w-10 items-center justify-center rounded-lg border border-dashed border-ink-3">
              <Icon name="add" size={20} color={colors.ink2} />
            </View>
            <Text className="ml-3 font-sans-semibold text-body text-accent">New stack</Text>
          </PressableScale>
        </View>
      )}
    </Sheet>
  );
}
