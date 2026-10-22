import { ActivityIndicator, Text, View } from "react-native";

import type { ReelStatus, SaveStage } from "../../api/contract";
import { trackerNote, trackerSteps, type StepState } from "../../lib/saveOutcome";
import { useTheme } from "../../theme/ThemeProvider";
import { Button } from "../Button";
import { Icon } from "../Icon";
import { Reveal } from "../motion/Reveal";

const INDICATOR = 24;

const STATE_WORD: Record<StepState, string> = { done: "done", active: "in progress", todo: "up next" };
const LABEL_TONE: Record<StepState, string> = { done: "text-ink-2", active: "text-ink", todo: "text-ink-3" };

/** One step's marker: a marigold check when done, a spinner while it runs, an empty ring until then. */
function Marker({ state }: { state: StepState }) {
  const { colors } = useTheme();
  if (state === "done") {
    return (
      <View style={{ width: INDICATOR, height: INDICATOR, borderRadius: INDICATOR / 2, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" }}>
        <Icon name="check" size={14} color={colors.onAccent} />
      </View>
    );
  }
  if (state === "active") {
    return (
      <View style={{ width: INDICATOR, height: INDICATOR, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator size="small" color={colors.accentText} style={{ transform: [{ scale: 0.8 }] }} />
      </View>
    );
  }
  return <View style={{ width: INDICATOR, height: INDICATOR, borderRadius: INDICATOR / 2, borderWidth: 1.5, borderColor: colors.ink3 }} />;
}

/**
 * The named-step progress of a card being made: Got the reel, Listening to it, Finding places and
 * steps, Card ready. It reads the server's real stage, so a step is only marked when the work is
 * really at it. One honest line sits under the steps (a rough time early on, plain words later) and
 * never a percentage. When the card is ready the line becomes the news and "Open card" appears.
 */
export function SaveTracker({
  status,
  stage,
  slow = false,
  unreachable = false,
  first = false,
  onOpenCard,
}: {
  status: ReelStatus;
  stage: SaveStage | null | undefined;
  slow?: boolean;
  unreachable?: boolean;
  /** The first card this person has ever saved: the line says so. */
  first?: boolean;
  onOpenCard: () => void;
}) {
  const { colors } = useTheme();
  const steps = trackerSteps(status, stage);
  const ready = status !== "pending";
  const note = trackerNote({ status, stage, slow, unreachable, first });

  return (
    <View className="mt-4 rounded-ctl border border-hairline px-4 py-3">
      {steps.map((step, i) => (
        <View key={step.key}>
          {i > 0 ? (
            // The line joining the previous marker to this one fills in as the work gets there.
            <View
              style={{
                marginLeft: INDICATOR / 2 - 1,
                width: 2,
                height: 8,
                borderRadius: 1,
                backgroundColor: step.state === "todo" ? colors.hairline : colors.accent,
              }}
            />
          ) : null}
          <View
            accessible
            accessibilityLabel={`${step.label}, ${STATE_WORD[step.state]}`}
            className="flex-row items-center"
            style={{ minHeight: 28 }}
          >
            <Marker state={step.state} />
            <Text className={`ml-3 flex-1 font-sans-medium text-body ${LABEL_TONE[step.state]}`}>{step.label}</Text>
          </View>
        </View>
      ))}
      {/* Announced as it changes, so a screen reader hears "Almost there" and "Your card is ready". */}
      <Text accessibilityLiveRegion="polite" className="mt-3 font-sans text-meta text-ink-2">
        {note}
      </Text>
      {ready ? (
        <Reveal>
          <Button title="Open card" onPress={onOpenCard} size="lg" className="mt-3" />
        </Reveal>
      ) : null}
    </View>
  );
}
