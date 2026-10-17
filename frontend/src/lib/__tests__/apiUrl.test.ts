import { resolveApiUrl } from "../apiUrl";

describe("resolveApiUrl", () => {
  it("points a localhost API at the machine Metro served the app from", () => {
    expect(resolveApiUrl("http://localhost:8001", "192.168.1.5:8081")).toBe("http://192.168.1.5:8001");
    expect(resolveApiUrl("http://127.0.0.1:8001/", "10.240.117.155:8081")).toBe("http://10.240.117.155:8001");
    expect(resolveApiUrl("http://0.0.0.0:8001", "192.168.1.5")).toBe("http://192.168.1.5:8001");
  });

  it("keeps the path and drops a trailing slash", () => {
    expect(resolveApiUrl("http://localhost:8001/api/", "192.168.1.5:8081")).toBe("http://192.168.1.5:8001/api");
  });

  it("leaves a real API host alone", () => {
    expect(resolveApiUrl("https://api.lately.app", "192.168.1.5:8081")).toBe("https://api.lately.app");
    expect(resolveApiUrl("http://192.168.1.9:8001", "192.168.1.5:8081")).toBe("http://192.168.1.9:8001");
  });

  it("leaves localhost alone when the dev host is unknown or is this machine", () => {
    expect(resolveApiUrl("http://localhost:8001", undefined)).toBe("http://localhost:8001");
    expect(resolveApiUrl("http://localhost:8001", null)).toBe("http://localhost:8001");
    expect(resolveApiUrl("http://localhost:8001", "localhost:8081")).toBe("http://localhost:8001");
    expect(resolveApiUrl("http://localhost:8001", "127.0.0.1:8081")).toBe("http://localhost:8001");
  });

  it("handles a tunnel host with no port", () => {
    expect(resolveApiUrl("http://localhost:8001", "abc-anonymous-8081.exp.direct")).toBe(
      "http://abc-anonymous-8081.exp.direct:8001",
    );
  });

  it("returns an unparseable value unchanged", () => {
    expect(resolveApiUrl("not a url", "192.168.1.5:8081")).toBe("not a url");
  });
});
