import { fireEvent, screen, waitFor } from "@testing-library/react-native";

import { demoApi, renderWithProviders } from "../../test/render";
import { StackPicker } from "../detail/StackPicker";

test("choosing a stack adds the save and confirms", async () => {
  const api = demoApi();
  const addToStack = jest.spyOn(api, "addToStack");
  const onClose = jest.fn();
  await renderWithProviders(<StackPicker visible saveId="s-github" onClose={onClose} />, { api });
  expect(screen.getByText("Add to stack")).toBeTruthy();
  await fireEvent.press(await screen.findByText("Cafes to try"));
  await waitFor(() => expect(addToStack).toHaveBeenCalledWith("st-cafes", "s-github"));
  expect(await screen.findByText("Added to Cafes to try")).toBeTruthy();
  expect(onClose).toHaveBeenCalled();
});

test("a new stack can be made from the picker", async () => {
  const api = demoApi();
  const addToStack = jest.spyOn(api, "addToStack");
  await renderWithProviders(<StackPicker visible saveId="s-github" onClose={() => {}} />, { api });
  await screen.findByText("Cafes to try");
  await fireEvent.press(screen.getByText("New stack"));
  await fireEvent.changeText(screen.getByPlaceholderText("e.g. Cafes to try"), "Weekend");
  await fireEvent.press(screen.getByText("Create"));
  await waitFor(() => expect(addToStack).toHaveBeenCalledWith(expect.stringMatching(/^st-/), "s-github"));
  expect(await screen.findByText("Added to Weekend")).toBeTruthy();
});
