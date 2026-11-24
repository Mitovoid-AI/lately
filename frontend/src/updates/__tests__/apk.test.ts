import { File } from "expo-file-system";

import { deleteOldApks } from "../apk";

// The cache directory as a list of entries; `deleted` records what was removed.
const mockCache: { entries: unknown[]; deleted: string[]; unreadable: boolean } = { entries: [], deleted: [], unreadable: false };

jest.mock("expo-file-system", () => ({
  Paths: { cache: { uri: "file:///cache/" } },
  File: class {
    name: string;
    constructor(fileName: string) {
      this.name = fileName;
    }
    delete() {
      mockCache.deleted.push(this.name);
    }
  },
  Directory: class {
    list() {
      if (mockCache.unreadable) throw new Error("not readable");
      return mockCache.entries;
    }
  },
}));
jest.mock("expo-file-system/legacy", () => ({ getContentUriAsync: jest.fn() }));
jest.mock("expo-intent-launcher", () => ({ startActivityAsync: jest.fn() }));

const files = (...names: string[]) => names.map((n) => new (File as unknown as new (name: string) => unknown)(n));

beforeEach(() => {
  mockCache.deleted = [];
  mockCache.unreadable = false;
});

test("at launch, update files for the installed build and older ones are deleted", () => {
  mockCache.entries = files("lately-apk-9.apk", "lately-apk-11.apk", "lately-apk-11-2.apk", "lately-export-20261010.json");
  deleteOldApks(11);
  expect(mockCache.deleted).toEqual(["lately-apk-9.apk", "lately-apk-11.apk", "lately-apk-11-2.apk"]);
});

test("the newest newer build is kept (it may be waiting in the installer); older newer ones go", () => {
  mockCache.entries = files("lately-apk-12.apk", "lately-apk-13.apk", "lately-apk-13-2.apk", "lately-apk-10.apk", "other.apk");
  deleteOldApks(11);
  expect(mockCache.deleted).toEqual(["lately-apk-12.apk", "lately-apk-10.apk"]);
});

test("an unreadable cache is not an error", () => {
  mockCache.unreadable = true;
  expect(() => deleteOldApks(11)).not.toThrow();
  expect(mockCache.deleted).toEqual([]);
});
