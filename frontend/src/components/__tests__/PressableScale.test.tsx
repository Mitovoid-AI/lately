import { Text } from "react-native";
import { render } from "@testing-library/react-native";

import { PressableScale } from "../motion/PressableScale";

type Node = { props?: { style?: unknown }; children?: (Node | string)[] | null };

/** Every flattened style object in the rendered tree. */
function styles(node: Node | Node[] | null): Record<string, unknown>[] {
  if (!node) return [];
  if (Array.isArray(node)) return node.flatMap(styles);
  const own = [node.props?.style].flat(Infinity).filter((s): s is Record<string, unknown> => !!s && typeof s === "object");
  const kids = (node.children ?? []).filter((c): c is Node => typeof c !== "string");
  return [...own, ...kids.flatMap(styles)];
}

const grows = (tree: Node | Node[] | null) => styles(tree).some((s) => s.flexGrow === 1);

test("a stretched touch target fills its box", async () => {
  const { toJSON } = await render(
    <PressableScale onPress={() => {}} containerClassName="flex-1">
      <Text>Open card</Text>
    </PressableScale>,
  );
  expect(grows(toJSON() as Node | Node[] | null)).toBe(true);
});

test("a self-aligned touch target stays the size of its content (Android grew it to the scroll height)", async () => {
  for (const align of ["self-start", "self-center", "self-end", "self-baseline"]) {
    const { toJSON, unmount } = await render(
      <PressableScale onPress={() => {}} containerClassName={`mt-2 ${align}`}>
        <Text>Add a note</Text>
      </PressableScale>,
    );
    expect(grows(toJSON() as Node | Node[] | null)).toBe(false);
    await unmount();
  }
});
