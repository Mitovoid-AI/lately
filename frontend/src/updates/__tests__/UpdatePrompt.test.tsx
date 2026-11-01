import { act, fireEvent, render, screen } from "@testing-library/react-native";

import { downloadApk, openInstaller } from "../apk";
import { findNewerRelease, updateSource, type ApkRelease } from "../release";
import { UpdatePrompt } from "../UpdatePrompt";

jest.mock("../release", () => ({ updateSource: jest.fn(), findNewerRelease: jest.fn() }));
jest.mock("../apk", () => ({ downloadApk: jest.fn(), openInstaller: jest.fn() }));

const RELEASE: ApkRelease = {
  build: 12,
  tag: "apk-12",
  url: "https://github.com/Mitovoid-AI/lately/releases/download/apk-12/lately.apk",
  bytes: 56_000_000,
  publishedAt: "2026-11-01T10:00:00Z",
};
const mockSource = updateSource as jest.Mock;
const mockFind = findNewerRelease as jest.Mock;
const mockDownload = downloadApk as jest.Mock;
const mockInstall = openInstaller as jest.Mock;

/** A download the test finishes by hand, after reporting halfway. */
function pendingDownload() {
  const control: { finish: (uri: string) => void; fail: () => void; signal?: AbortSignal } = {
    finish: () => {},
    fail: () => {},
  };
  mockDownload.mockImplementation((_release, onProgress: (f: number) => void, signal: AbortSignal) => {
    control.signal = signal;
    onProgress(0.5);
    return new Promise<string>((resolve, reject) => {
      control.finish = resolve;
      control.fail = () => reject(new Error("socket closed"));
    });
  });
  return control;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSource.mockReturnValue({ repo: "Mitovoid-AI/lately", installedBuild: 9 });
  mockFind.mockResolvedValue(RELEASE);
  mockInstall.mockResolvedValue(undefined);
});

test("builds that don't update themselves never ask GitHub and show nothing", async () => {
  mockSource.mockReturnValue(null);
  await render(<UpdatePrompt />);
  expect(mockFind).not.toHaveBeenCalled();
  expect(screen.queryByText("Update available")).toBeNull();
});

test("no newer build, no prompt", async () => {
  mockFind.mockResolvedValue(null);
  await render(<UpdatePrompt />);
  expect(mockFind).toHaveBeenCalledWith("Mitovoid-AI/lately", 9);
  expect(screen.queryByText("Update available")).toBeNull();
});

test("offer, download with progress, then hand the APK to the installer", async () => {
  const download = pendingDownload();
  await render(<UpdatePrompt />);
  expect(await screen.findByText("Update available")).toBeTruthy();
  expect(screen.getByText("Test build 12 is out (56 MB). You have build 9.")).toBeTruthy();

  await fireEvent.press(screen.getByText("Update now"));
  expect(mockDownload).toHaveBeenCalledWith(RELEASE, expect.any(Function), expect.any(Object));
  expect(screen.getByText("Downloading build 12")).toBeTruthy();
  expect(screen.getByText("28 of 56 MB · 50%")).toBeTruthy();
  expect(screen.getByRole("progressbar").props.accessibilityValue).toEqual({ min: 0, max: 100, now: 50 });

  await act(async () => download.finish("file:///cache/lately-apk-12.apk"));
  expect(screen.getByText("Ready to install")).toBeTruthy();
  await fireEvent.press(screen.getByText("Install"));
  expect(mockInstall).toHaveBeenCalledWith("file:///cache/lately-apk-12.apk");
});

test("Cancel stops the download and goes back to the offer", async () => {
  const download = pendingDownload();
  await render(<UpdatePrompt />);
  await fireEvent.press(await screen.findByText("Update now"));
  await fireEvent.press(screen.getByText("Cancel"));
  expect(download.signal?.aborted).toBe(true);
  expect(screen.getByText("Update available")).toBeTruthy();
});

test("a failed download can be retried", async () => {
  const download = pendingDownload();
  await render(<UpdatePrompt />);
  await fireEvent.press(await screen.findByText("Update now"));
  await act(async () => download.fail());
  expect(screen.getByText("The download didn't finish")).toBeTruthy();
  await fireEvent.press(screen.getByText("Try again"));
  expect(mockDownload).toHaveBeenCalledTimes(2);
});

test("if the installer can't open, Try again reopens it with the same file", async () => {
  const download = pendingDownload();
  mockInstall.mockRejectedValueOnce(new Error("No activity found"));
  await render(<UpdatePrompt />);
  await fireEvent.press(await screen.findByText("Update now"));
  await act(async () => download.finish("file:///cache/lately-apk-12.apk"));
  await fireEvent.press(screen.getByText("Install"));
  expect(screen.getByText("Couldn't open the installer")).toBeTruthy();
  await fireEvent.press(screen.getByText("Try again"));
  expect(mockInstall).toHaveBeenLastCalledWith("file:///cache/lately-apk-12.apk");
  expect(mockDownload).toHaveBeenCalledTimes(1);
});

test("Later hides the offer", async () => {
  await render(<UpdatePrompt />);
  await fireEvent.press(await screen.findByText("Later"));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 300)); // the exit fade
  });
  expect(screen.queryByText("Update available")).toBeNull();
});
