import { checkForUpdatesNow, onUpdateOffer, type UpdateOffer } from "../offer";
import { checkForUpdate, updateSource, type ApkRelease } from "../release";

jest.mock("../release", () => ({ updateSource: jest.fn(), checkForUpdate: jest.fn() }));

const RELEASE: ApkRelease = { build: 12, tag: "apk-12", url: "https://example.test/lately.apk", bytes: 1, publishedAt: "" };
const mockSource = updateSource as jest.Mock;
const mockCheck = checkForUpdate as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockSource.mockReturnValue({ repo: "Mitovoid-AI/lately", installedBuild: 9 });
});

test("a newer build opens the update dialog (whoever listens gets the offer)", async () => {
  const seen: UpdateOffer[] = [];
  const off = onUpdateOffer((o) => seen.push(o));
  mockCheck.mockResolvedValue({ status: "newer", release: RELEASE });
  await expect(checkForUpdatesNow()).resolves.toBe("offered");
  expect(mockCheck).toHaveBeenCalledWith("Mitovoid-AI/lately", 9);
  expect(seen).toEqual([{ release: RELEASE, installedBuild: 9 }]);
  off();
});

test("nothing newer and no answer are told apart, and open nothing", async () => {
  const listener = jest.fn();
  const off = onUpdateOffer(listener);
  mockCheck.mockResolvedValueOnce({ status: "current" }).mockResolvedValueOnce({ status: "failed" });
  await expect(checkForUpdatesNow()).resolves.toBe("current");
  await expect(checkForUpdatesNow()).resolves.toBe("failed");
  expect(listener).not.toHaveBeenCalled();
  off();
});

test("a build that doesn't update itself never asks GitHub", async () => {
  mockSource.mockReturnValue(null);
  await expect(checkForUpdatesNow()).resolves.toBe("current");
  expect(mockCheck).not.toHaveBeenCalled();
});
