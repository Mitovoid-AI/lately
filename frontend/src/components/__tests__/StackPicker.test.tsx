import { fireEvent, screen, waitFor } from "@testing-library/react-native";

import { demoApi, renderWithProviders } from "../../test/render";
import { StackPicker } from "../detail/StackPicker";

test("choosing a stack adds the save and confirms", async () => {
  const api = demoApi();
  const addToStack = jest.spyOn(api, "addToStack");
  const onClose = jest.fn();
  await renderWithProviders(<StackPicker visible saveId="s-github" onClose={onClose} />, { api });
  expect(screen.getByText("Add to stack")).toBeTruthy();
  await fireEvent.press(await screen.findByText("Food and coffee"));
  await waitFor(() => expect(addToStack).toHaveBeenCalledWith("st-cafes", "s-github"));
  expect(await screen.findByText("Added to Food and coffee")).toBeTruthy();
  expect(onClose).toHaveBeenCalled();
});

test("a new stack can be made from the picker", async () => {
  const api = demoApi();
  const addToStack = jest.spyOn(api, "addToStack");
  await renderWithProviders(<StackPicker visible saveId="s-github" onClose={() => {}} />, { api });
  await screen.findByText("Food and coffee");
  await fireEvent.press(screen.getByText("New stack"));
  await fireEvent.changeText(screen.getByPlaceholderText("e.g. Cafes to try"), "Weekend");
  await fireEvent.press(screen.getByText("Create"));
  await waitFor(() => expect(addToStack).toHaveBeenCalledWith(expect.stringMatching(/^st-/), "s-github"));
  expect(await screen.findByText("Added to Weekend")).toBeTruthy();
});

test("a double tap adds once", async () => {
  const api = demoApi();
  const addToStack = jest.spyOn(api, "addToStack");
  await renderWithProviders(<StackPicker visible saveId="s-github" onClose={() => {}} />, { api });
  const row = await screen.findByText("Food and coffee");
  await fireEvent.press(row);
  await fireEvent.press(row);
  await waitFor(() => expect(addToStack).toHaveBeenCalledTimes(1));
});

test("a failed load of the stacks says so and Try again loads them", async () => {
  const base = demoApi();
  let failing = true;
  const api = {
    ...base,
    listStacks: jest.fn(async () => {
      if (failing) throw new Error("down");
      return base.listStacks();
    }),
  };
  await renderWithProviders(<StackPicker visible saveId="s-github" onClose={() => {}} />, { api });
  expect(await screen.findByText("Couldn't load your stacks")).toBeTruthy();
  failing = false;
  await fireEvent.press(screen.getByText("Try again"));
  expect(await screen.findByText("Food and coffee")).toBeTruthy();
  expect(screen.queryByText("Couldn't load your stacks")).toBeNull();
});

test("a stack row is named with its count for a screen reader", async () => {
  await renderWithProviders(<StackPicker visible saveId="s-github" onClose={() => {}} />);
  expect(await screen.findByLabelText("Food and coffee, 4 saves")).toBeTruthy();
});

test("a stack that can't be created says so under the field, and the field is named", async () => {
  const api = { ...demoApi(), createStack: jest.fn(async () => Promise.reject(new Error("down"))) };
  await renderWithProviders(<StackPicker visible saveId="s-github" onClose={() => {}} />, { api });
  await screen.findByText("Food and coffee");
  await fireEvent.press(screen.getByText("New stack"));
  await fireEvent.changeText(screen.getByLabelText("Stack name"), "Weekend");
  await fireEvent.press(screen.getByText("Create"));
  const alert = await screen.findByText("Couldn't create the stack. Try again.");
  expect(alert.props.accessibilityRole).toBe("alert");
  // Typing again clears it.
  await fireEvent.changeText(screen.getByLabelText("Stack name"), "Weekends");
  expect(screen.queryByText("Couldn't create the stack. Try again.")).toBeNull();
});
