import { screen } from "@testing-library/react-native";
import { Text } from "react-native";

import { ApiError, type InstagramLink } from "../../../api/contract";
import { demoApi, renderWithProviders } from "../../../test/render";
import { useInstagramGate } from "../useInstagramGate";

function Probe() {
  return <Text testID="gate">{useInstagramGate()}</Text>;
}

const link = (over: Partial<InstagramLink> = {}): InstagramLink => ({
  enabled: true,
  handle: "latelyinsta02",
  linked: false,
  linked_at: null,
  code: null,
  code_expires_at: null,
  ...over,
});

/** Renders the gate against a server answer; findByText waits for the settled value. */
async function render(answer: () => Promise<InstagramLink>, mode: "live" | "demo" = "live") {
  const api = demoApi();
  jest.spyOn(api, "getInstagramLink").mockImplementation(answer);
  await renderWithProviders(<Probe />, { api, auth: { mode } });
}

test("a live account that hasn't connected Instagram must connect first", async () => {
  await render(async () => link());
  expect(await screen.findByText("connect")).toBeTruthy();
});

test("a connected account goes straight in", async () => {
  await render(async () => link({ linked: true, linked_at: "2026-11-27T09:00:00Z" }));
  expect(await screen.findByText("open")).toBeTruthy();
});

test("with the feature switched off nobody is asked", async () => {
  await render(async () => link({ enabled: false }));
  expect(await screen.findByText("open")).toBeTruthy();
});

test("a failed check lets the person in rather than locking them out", async () => {
  await render(async () => {
    throw new ApiError("SERVER", 500);
  });
  expect(await screen.findByText("open")).toBeTruthy();
});

test("demo mode is never gated", async () => {
  await render(async () => link(), "demo");
  expect(await screen.findByText("open")).toBeTruthy();
});

test("while the server hasn't answered, it's 'checking'", async () => {
  await render(() => new Promise<InstagramLink>(() => {}));
  expect(screen.getByTestId("gate").props.children).toBe("checking");
});
