import { shareExportFile } from "../exportFile";

const mockFiles: { uri: string; created: unknown; written: string | null }[] = [];

jest.mock("expo-file-system", () => ({
  Paths: { cache: { uri: "file:///cache/" } },
  File: class {
    uri: string;
    constructor(dir: { uri: string }, name: string) {
      this.uri = `${dir.uri}${name}`;
      mockFiles.push({ uri: this.uri, created: null, written: null });
    }
    create(o: unknown) {
      mockFiles[mockFiles.length - 1].created = o;
    }
    write(s: string) {
      mockFiles[mockFiles.length - 1].written = s;
    }
  },
}));

const mockShareAsync = jest.fn(async (_uri: string, _o?: unknown) => {});
const mockAvailable = jest.fn(async () => true);
jest.mock("expo-sharing", () => ({
  isAvailableAsync: () => mockAvailable(),
  shareAsync: (uri: string, o?: unknown) => mockShareAsync(uri, o),
}));

beforeEach(() => {
  mockFiles.length = 0;
  jest.clearAllMocks();
});

test("writes the JSON to the cache directory and opens the share sheet", async () => {
  await shareExportFile("lately-export-20261010.json", '{"saves":[]}');
  expect(mockFiles).toEqual([
    { uri: "file:///cache/lately-export-20261010.json", created: { overwrite: true }, written: '{"saves":[]}' },
  ]);
  expect(mockShareAsync).toHaveBeenCalledWith(
    "file:///cache/lately-export-20261010.json",
    expect.objectContaining({ mimeType: "application/json" }),
  );
});

test("throws when the device cannot share files", async () => {
  mockAvailable.mockResolvedValueOnce(false);
  await expect(shareExportFile("a.json", "{}")).rejects.toThrow();
  expect(mockShareAsync).not.toHaveBeenCalled();
});
