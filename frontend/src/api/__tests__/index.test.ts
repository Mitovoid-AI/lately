import { ENDPOINTS, type LatelyApi } from "../contract";
import { createApi, LIVE_ENDPOINTS } from "../index";

function fakeApi(tag: string): LatelyApi {
  return new Proxy({} as LatelyApi, {
    get: (_t, name) => jest.fn(async () => `${tag}:${String(name)}`),
  });
}

test("every endpoint in the contract is live", () => {
  expect([...LIVE_ENDPOINTS].sort()).toEqual([...ENDPOINTS].sort());
  expect(ENDPOINTS).toEqual(
    expect.arrayContaining(["deleteSave", "retryEnrichment", "removeFromStack", "deleteStack", "deleteAccount"]),
  );
});

test("live mode sends every call to http", async () => {
  const api = createApi({ mode: "live", demo: fakeApi("demo"), http: fakeApi("http") });
  expect(await api.listSaves()).toBe("http:listSaves");
  expect(await api.getMe()).toBe("http:getMe");
  expect(await api.listStacks()).toBe("http:listStacks");
  expect(await api.getCurated()).toBe("http:getCurated");
});

test("a custom live set still sends the rest to demo", async () => {
  const api = createApi({ mode: "live", demo: fakeApi("demo"), http: fakeApi("http"), live: new Set(["getMe"]) });
  expect(await api.getMe()).toBe("http:getMe");
  expect(await api.listStacks()).toBe("demo:listStacks");
});

test("demo mode sends everything to demo", async () => {
  const api = createApi({ mode: "demo", demo: fakeApi("demo"), http: fakeApi("http") });
  expect(await api.listSaves()).toBe("demo:listSaves");
});
