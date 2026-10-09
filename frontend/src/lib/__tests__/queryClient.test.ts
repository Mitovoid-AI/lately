import { ApiError } from "../../api/contract";
import { createAppQueryClient, refreshSaveViews } from "../queryClient";

test("a request that ends in UNAUTHORIZED signs the user out", async () => {
  const onUnauthorized = jest.fn();
  const client = createAppQueryClient(onUnauthorized);
  client.setDefaultOptions({ queries: { retry: false, gcTime: Infinity } });
  await client
    .fetchQuery({ queryKey: ["x"], queryFn: async () => Promise.reject(new ApiError("NETWORK", 0)) })
    .catch(() => {});
  expect(onUnauthorized).not.toHaveBeenCalled();
  await client
    .fetchQuery({ queryKey: ["y"], queryFn: async () => Promise.reject(new ApiError("UNAUTHORIZED", 401)) })
    .catch(() => {});
  expect(onUnauthorized).toHaveBeenCalledTimes(1);
});

test("refreshSaveViews marks every view of saves stale", async () => {
  const client = createAppQueryClient(() => {});
  client.setDefaultOptions({ queries: { gcTime: Infinity } });
  const keys = [["saves"], ["save", "s1"], ["me"], ["stacks"], ["stack", "st1"], ["curated"], ["search", "momo"]];
  for (const key of keys) client.setQueryData(key, { cached: true });
  await refreshSaveViews(client);
  for (const key of keys) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
});
