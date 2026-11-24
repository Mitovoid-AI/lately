import { File } from "expo-file-system";

import { deleteExportFiles, shareExportFile } from "../exportFile";

const mockFiles: { uri: string; created: unknown; written: string | null }[] = [];
// What the cache directory lists, and the files deleted from it.
const mockCache: { entries: unknown[]; deleted: string[]; unreadable: boolean } = { entries: [], deleted: [], unreadable: false };

jest.mock("expo-file-system", () => ({
  Paths: { cache: { uri: "file:///cache/" } },
  File: class {
    uri: string;
    constructor(dir: { uri: string }, name: string) {
      this.uri = `${dir.uri}${name}`;
      mockFiles.push({ uri: this.uri, created: null, written: null });
    }
    get name() {
      return this.uri.slice(this.uri.lastIndexOf("/") + 1);
    }
    create(o: unknown) {
      mockFiles[mockFiles.length - 1].created = o;
    }
    write(s: string) {
      mockFiles[mockFiles.length - 1].written = s;
    }
    delete() {
      mockCache.deleted.push(this.uri);
    }
  },
  Directory: class {
    list() {
      if (mockCache.unreadable) throw new Error("not readable");
      return mockCache.entries;
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

describe("deleteExportFiles", () => {
  const cache = { uri: "file:///cache/" };
  beforeEach(() => {
    mockCache.deleted = [];
    mockCache.unreadable = false;
    mockCache.entries = [
      new File(cache as never, "lately-export-20261010.json"),
      new File(cache as never, "lately-export.json"),
      new File(cache as never, "lately-apk-12.apk"),
      new File(cache as never, "other.json"),
      { name: "lately-export-dir.json", list: () => [] }, // a directory, not a file
    ];
  });

  test("deletes every archive the app wrote, and nothing else in the cache", () => {
    deleteExportFiles();
    expect(mockCache.deleted).toEqual(["file:///cache/lately-export-20261010.json", "file:///cache/lately-export.json"]);
  });

  test("an unreadable cache is not an error (sign-out must go on)", () => {
    mockCache.unreadable = true;
    expect(() => deleteExportFiles()).not.toThrow();
    expect(mockCache.deleted).toEqual([]);
  });
});
