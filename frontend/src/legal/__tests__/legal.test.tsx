import { fireEvent, screen } from "@testing-library/react-native";

import { renderWithProviders } from "../../test/render";
import { LEGAL_DOCS } from "../documents";
import { LegalScreen } from "../LegalScreen";
import { parseMarkdown } from "../markdown";

// Jest runs in Node; the app's TypeScript config has no Node types, so type just what is used.
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("fs") as { readFileSync(file: string, encoding: "utf8"): string };
const path = require("path") as { join(...parts: string[]): string };
/* eslint-enable @typescript-eslint/no-require-imports */
declare const __dirname: string;

let mockCanGoBack = true;
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => mockCanGoBack };
let mockParams: Record<string, string> = {};
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockCanGoBack = true;
});

test("the bundled documents match legal/*.md (run scripts/build-legal.js after editing)", () => {
  for (const doc of ["privacy", "terms"] as const) {
    const md = fs.readFileSync(path.join(__dirname, "..", "..", "..", "legal", `${doc}.md`), "utf8").replace(/\r\n/g, "\n");
    expect(LEGAL_DOCS[doc].markdown).toBe(md);
  }
});

test("the privacy policy describes the export as an in-app JSON file, not an email", () => {
  const exportLine = LEGAL_DOCS.privacy.markdown.split("\n").find((l) => l.includes("**Export.**")) ?? "";
  expect(exportLine).toContain("JSON");
  expect(exportLine).not.toMatch(/email|sends you|markdown/i);
});

test("the privacy policy names what is stored, every processor, and how to delete", () => {
  const text = LEGAL_DOCS.privacy.markdown;
  for (const word of ["email", "links", "notes", "card", "Supabase", "OpenRouter", "Groq", "OpenAI", "Delete account"]) {
    expect(text).toContain(word);
  }
});

test("markdown parses into headings, paragraphs and bullets with bold runs", () => {
  const blocks = parseMarkdown("# Title\n\nPara one\ncontinues.\n\n## Part\n\n- **Bold.** rest\n- two\n");
  expect(blocks).toEqual([
    { kind: "h1", text: [{ text: "Title", bold: false }] },
    { kind: "p", text: [{ text: "Para one continues.", bold: false }] },
    { kind: "h2", text: [{ text: "Part", bold: false }] },
    { kind: "li", text: [{ text: "Bold.", bold: true }, { text: " rest", bold: false }] },
    { kind: "li", text: [{ text: "two", bold: false }] },
  ]);
});

test("the legal screen renders the requested document", async () => {
  mockParams = { doc: "terms" };
  await renderWithProviders(<LegalScreen />, { auth: { status: "signed-out" } });
  expect(screen.getByText("Terms of Service")).toBeTruthy();
  expect(screen.getByText("Acceptable use")).toBeTruthy();
});

test("an unknown document falls back to the privacy policy; back with no history goes home", async () => {
  mockParams = { doc: "nope" };
  mockCanGoBack = false;
  await renderWithProviders(<LegalScreen />);
  expect(screen.getByText("Privacy Policy")).toBeTruthy();
  await fireEvent.press(screen.getByLabelText("Back"));
  expect(mockRouter.replace).toHaveBeenCalledWith("/");
});
