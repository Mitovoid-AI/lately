test("the root layout exports an error boundary", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  expect(require("../_layout").ErrorBoundary).toBeDefined();
});
