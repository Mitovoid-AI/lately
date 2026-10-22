import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { useState } from "react";
import { AccessibilityInfo, Pressable, Text } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ToastLayer, toastDuration, ToastProvider, TOAST_LONG_MS, TOAST_MS, useToast } from "../Toast";

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

function Probe({ message }: { message: string }) {
  const toast = useToast();
  return (
    <Pressable onPress={() => toast.show(message)}>
      <Text>show</Text>
    </Pressable>
  );
}

function Host({ message, overlay = false }: { message: string; overlay?: boolean }) {
  const [open, setOpen] = useState(overlay);
  return (
    <SafeAreaProvider initialMetrics={METRICS}>
      <ToastProvider>
        <Probe message={message} />
        <Pressable onPress={() => setOpen(false)}>
          <Text>close overlay</Text>
        </Pressable>
        {open ? <ToastLayer /> : null}
      </ToastProvider>
    </SafeAreaProvider>
  );
}

afterEach(() => jest.useRealTimers());

test("a plain confirmation lasts 2.5 s; a problem or a long line lasts 4.5 s", () => {
  expect(toastDuration("Link copied")).toBe(TOAST_MS);
  expect(toastDuration("Deleted")).toBe(TOAST_MS);
  expect(toastDuration("Couldn't save your note. Try again.")).toBe(TOAST_LONG_MS);
  expect(toastDuration("We can't find that")).toBe(TOAST_LONG_MS);
  expect(toastDuration("Added to a stack with quite a long name")).toBe(TOAST_LONG_MS);
  expect(TOAST_MS).toBe(2500);
  expect(TOAST_LONG_MS).toBe(4500);
});

test("a toast is spoken: it is announced the moment it shows", async () => {
  const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
  await render(<Host message="Link copied" />);
  await fireEvent.press(screen.getByText("show"));
  expect(announce).toHaveBeenCalledWith("Link copied");
  expect(screen.getByText("Link copied")).toBeTruthy();
  announce.mockRestore();
});

test("a problem stays up past 2.5 s and is gone by 4.5 s", async () => {
  jest.useFakeTimers({ advanceTimers: true });
  await render(<Host message="Couldn't add it. Try again." />);
  await fireEvent.press(screen.getByText("show"));
  await act(async () => {
    jest.advanceTimersByTime(TOAST_MS + 100);
  });
  expect(screen.getByText("Couldn't add it. Try again.")).toBeTruthy();
  await act(async () => {
    jest.advanceTimersByTime(TOAST_LONG_MS - TOAST_MS);
  });
  expect(screen.queryByText("Couldn't add it. Try again.")).toBeNull();
});

test("a plain confirmation is gone after 2.5 s", async () => {
  jest.useFakeTimers({ advanceTimers: true });
  await render(<Host message="Link copied" />);
  await fireEvent.press(screen.getByText("show"));
  expect(screen.getByText("Link copied")).toBeTruthy();
  await act(async () => {
    jest.advanceTimersByTime(TOAST_MS + 100);
  });
  expect(screen.queryByText("Link copied")).toBeNull();
});

test("a toast raised while a sheet or dialog is open shows once, in that modal's layer", async () => {
  await render(<Host message="Couldn't delete. Try again." overlay />);
  await fireEvent.press(screen.getByText("show"));
  expect(screen.getAllByText("Couldn't delete. Try again.")).toHaveLength(1);
  // Once the modal is gone the provider's own toast takes over, still one.
  await fireEvent.press(screen.getByText("close overlay"));
  expect(screen.getAllByText("Couldn't delete. Try again.")).toHaveLength(1);
});
