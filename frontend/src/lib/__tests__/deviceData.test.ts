import { firstCardKey, isFirstCard } from "../../components/save/firstCard";
import { createMemoryStore } from "../../test/memoryStore";
import { forgetDeviceData } from "../deviceData";
import { RECENT_KEY } from "../recent";

test("forgetting the device data also forgets the first-card flag, so it is asked again", async () => {
  const store = createMemoryStore({ [RECENT_KEY]: JSON.stringify(["momo"]) });
  expect(await isFirstCard(store, "u1", async () => 1)).toBe(true);
  expect(await isFirstCard(store, "u1", async () => 1)).toBe(false);

  await forgetDeviceData("u1", store);

  expect(await store.getItem(firstCardKey("u1"))).toBe("");
  expect(await store.getItem(RECENT_KEY)).toBe("[]");
  expect(await isFirstCard(store, "u1", async () => 1)).toBe(true);
});

test("without a signed-in person it still clears what it can", async () => {
  const store = createMemoryStore({ [RECENT_KEY]: JSON.stringify(["momo"]) });
  await forgetDeviceData(null, store);
  expect(await store.getItem(RECENT_KEY)).toBe("[]");
});
