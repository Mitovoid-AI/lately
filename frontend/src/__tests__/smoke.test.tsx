import { render, screen } from "@testing-library/react-native";
import { Text } from "react-native";

test("renders a NativeWind-styled Text", async () => {
  await render(<Text className="font-display text-display-lg text-ink">Lately</Text>);
  expect(screen.getByText("Lately")).toBeTruthy();
});
