import type { LatelyApi } from "../contract";
import { createApi, LIVE_ENDPOINTS } from "../index";

function fakeApi(tag: string): LatelyApi {
  return new Proxy({} as LatelyApi, {
    get: (_t, name) => jest.fn(async () => `${tag}:${String(name)}`),
  });
}

test("only the endpoints the backend has today are live", () => {
  expect([...LIVE_ENDPOINTS].sort()).toEqual(["createSave", "listSaves", "setNote"]);
});

test("live mode sends live endpoints to http and the rest to demo", async () => {
  const api = createApi({ mode: "live", demo: fakeApi("demo"), http: fakeApi("http") });
  expect(await api.listSaves()).toBe("http:listSaves");
  expect(await api.getMe()).toBe("demo:getMe");
});

test("demo mode sends everything to demo", async () => {
  const api = createApi({ mode: "demo", demo: fakeApi("demo"), http: fakeApi("http") });
  expect(await api.listSaves()).toBe("demo:listSaves");
});
