import { fireEvent, screen } from "@testing-library/react-native";
import { Pressable, Text } from "react-native";

import { renderWithProviders } from "../../test/render";
import { usePreferences, useReadingStyle } from "../usePreferences";

function Probe() {
  const { update } = usePreferences();
  const style = useReadingStyle();
  return (
    <>
      <Text>{`${style.fontFamily} ${style.fontSize}/${style.lineHeight}`}</Text>
      <Pressable onPress={() => update({ reading_font: "lora" })}>
        <Text>lora</Text>
      </Pressable>
      <Pressable onPress={() => update({ text_size: 18 })}>
        <Text>eighteen</Text>
      </Pressable>
    </>
  );
}

test("reading style follows the preferences", async () => {
  await renderWithProviders(<Probe />);
  expect(await screen.findByText("Newsreader_400Regular 16/24")).toBeTruthy();
  await fireEvent.press(screen.getByText("lora"));
  expect(await screen.findByText("Lora_400Regular 16/24")).toBeTruthy();
  await fireEvent.press(screen.getByText("eighteen"));
  expect(await screen.findByText("Lora_400Regular 18/27")).toBeTruthy();
});
