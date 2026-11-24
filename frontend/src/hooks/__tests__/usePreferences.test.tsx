import type { QueryClient } from "@tanstack/react-query";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { Pressable, Text } from "react-native";

import { ApiError, type Preferences } from "../../api/contract";
import { demoApi, renderWithProviders } from "../../test/render";
import { usePreferences, useReadingStyle } from "../usePreferences";

function Probe() {
  const { update, loaded, failed } = usePreferences();
  const style = useReadingStyle();
  return (
    <>
      <Text>{`${style.fontFamily} ${style.fontSize}/${style.lineHeight}`}</Text>
      <Text>{loaded ? "loaded" : failed ? "failed" : "loading"}</Text>
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

/** PATCH /me/preferences calls that fail only when the test says so. */
function failingLater(api: ReturnType<typeof demoApi>, times: number) {
  const fails: (() => void)[] = [];
  const spy = jest.spyOn(api, "updatePreferences");
  for (let i = 0; i < times; i++) {
    spy.mockImplementationOnce(
      () => new Promise<Preferences>((_, reject) => fails.push(() => reject(new ApiError("NETWORK", 0)))),
    );
  }
  return fails;
}

/** What the preferences cache holds right now (what every screen reading them shows next). */
const cached = (client: QueryClient) => client.getQueryData<Preferences>(["prefs"]);

test("a change that fails is rolled back and said; the change after it still stands", async () => {
  const api = demoApi();
  const fails = failingLater(api, 1);
  const { client } = await renderWithProviders(<Probe />, { api });
  expect(await screen.findByText("loaded")).toBeTruthy();
  await fireEvent.press(screen.getByText("lora"));
  await fireEvent.press(screen.getByText("eighteen"));
  expect(await screen.findByText("Lora_400Regular 18/27")).toBeTruthy();
  await act(async () => fails[0]());
  expect(await screen.findByText("Couldn't save that change. Try again.")).toBeTruthy();
  await waitFor(() => expect(client.isMutating()).toBe(0));
  // The font change failed (undone); the size change went through (kept).
  expect(cached(client)).toMatchObject({ reading_font: "newsreader", text_size: 18 });
  expect(await screen.findByText("Newsreader_400Regular 18/27")).toBeTruthy();
  expect(await api.getPreferences()).toMatchObject({ reading_font: "newsreader", text_size: 18 });
});

test("two failures in a row go back to what the server last confirmed, not to the first failed choice", async () => {
  const api = demoApi();
  const fails = failingLater(api, 2);
  const { client } = await renderWithProviders(<Probe />, { api });
  expect(await screen.findByText("loaded")).toBeTruthy();
  await fireEvent.press(screen.getByText("lora"));
  await fireEvent.press(screen.getByText("eighteen"));
  await act(async () => fails[0]());
  // The first failure takes back only its own change; the second is still on its way.
  expect(cached(client)).toMatchObject({ reading_font: "newsreader", text_size: 18 });
  await waitFor(() => expect(fails).toHaveLength(2));
  await act(async () => fails[1]());
  await waitFor(() => expect(client.isMutating()).toBe(0));
  expect(cached(client)).toMatchObject({ reading_font: "newsreader", text_size: 16 });
  expect(await screen.findByText("Newsreader_400Regular 16/24")).toBeTruthy();
});

test("replies only land once nothing newer is waiting", async () => {
  const api = demoApi();
  const real = api.updatePreferences.bind(api);
  const replies: (() => void)[] = [];
  const updatePreferences = jest
    .spyOn(api, "updatePreferences")
    .mockImplementation((p) => new Promise<Preferences>((resolve) => replies.push(() => resolve(real(p)))));
  const { client } = await renderWithProviders(<Probe />, { api });
  expect(await screen.findByText("loaded")).toBeTruthy();
  await fireEvent.press(screen.getByText("lora"));
  await fireEvent.press(screen.getByText("eighteen"));
  expect(cached(client)).toMatchObject({ reading_font: "lora", text_size: 18 });
  // Sent one at a time, in order.
  expect(updatePreferences).toHaveBeenCalledTimes(1);
  await act(async () => replies[0]());
  // The first reply knows nothing of the size change: the cache keeps it.
  expect(cached(client)).toMatchObject({ reading_font: "lora", text_size: 18 });
  await waitFor(() => expect(replies).toHaveLength(2));
  expect(updatePreferences.mock.calls.map((c) => c[0])).toEqual([{ reading_font: "lora" }, { text_size: 18 }]);
  await act(async () => replies[1]());
  await waitFor(() => expect(client.isMutating()).toBe(0));
  expect(cached(client)).toMatchObject({ reading_font: "lora", text_size: 18 });
  expect(await screen.findByText("Lora_400Regular 18/27")).toBeTruthy();
});

test("until the preferences load, nothing can be changed (so no default is saved as if chosen)", async () => {
  const base = demoApi();
  const updatePreferences = jest.spyOn(base, "updatePreferences");
  const getPreferences = jest
    .fn<Promise<Preferences>, []>()
    .mockRejectedValueOnce(new ApiError("NETWORK", 0))
    .mockImplementation(() => base.getPreferences());
  const { client } = await renderWithProviders(<Probe />, { api: { ...base, getPreferences } });
  expect(await screen.findByText("failed")).toBeTruthy();
  await fireEvent.press(screen.getByText("lora"));
  expect(updatePreferences).not.toHaveBeenCalled();
  expect(screen.getByText("Newsreader_400Regular 16/24")).toBeTruthy();
  expect(screen.getByText("failed")).toBeTruthy();
  await act(async () => {
    await client.refetchQueries({ queryKey: ["prefs"] });
  });
  expect(await screen.findByText("loaded")).toBeTruthy();
});
