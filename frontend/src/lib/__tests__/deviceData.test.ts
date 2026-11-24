import { firstCardKey, isFirstCard } from "../../components/save/firstCard";
import { createMemoryStore } from "../../test/memoryStore";
import { forgetDeviceData } from "../deviceData";
import { deleteExportFiles } from "../exportFile";
import { RECENT_KEY } from "../recent";

jest.mock("../exportFile", () => ({ deleteExportFiles: jest.fn() }));

beforeEach(() => jest.clearAllMocks());

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

test("archive files written for the share sheet are deleted too", async () => {
  await forgetDeviceData("u1", createMemoryStore());
  expect(deleteExportFiles).toHaveBeenCalledTimes(1);
});
