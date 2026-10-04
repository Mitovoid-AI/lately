import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import type { KeyValueStore } from "../../lib/storage";
import { createMemoryStore } from "../../test/memoryStore";
import { AuthProvider, useAuth } from "../AuthProvider";

function wrapperFor(store: KeyValueStore) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AuthProvider mode="demo" storage={store}>
        {children}
      </AuthProvider>
    );
  };
}

test("demo sign-in, sign-out, and the session survives a restart", async () => {
  const store = createMemoryStore();
  const { result } = await renderHook(() => useAuth(), { wrapper: wrapperFor(store) });
  await waitFor(() => expect(result.current.status).toBe("signed-out"));

  await act(() => result.current.signInDemo());
  expect(result.current.status).toBe("signed-in");
  expect(result.current.user?.name).toBe("Aanya Sharma");

  const restarted = await renderHook(() => useAuth(), { wrapper: wrapperFor(store) });
  await waitFor(() => expect(restarted.result.current.status).toBe("signed-in"));

  await act(() => result.current.signOut());
  expect(result.current.status).toBe("signed-out");
});
