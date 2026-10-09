import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";

type Router = { push: (href: string) => void };

/**
 * expo-router's `Link` for screen tests: pressing the (asChild) child pushes `href` on the
 * test's mock router. `Link.AppleZoom` / `Link.AppleZoomTarget` render their child as is.
 * Pass a getter so jest.mock factories can reference a `mockRouter` declared later.
 */
export function mockLink(router: () => Router) {
  function Link({ href, children }: { href: string; children?: ReactNode }) {
    if (!isValidElement(children)) return null;
    return cloneElement(children as ReactElement<{ onPress?: () => void }>, { onPress: () => router().push(href) });
  }
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return Object.assign(Link, { AppleZoom: Pass, AppleZoomTarget: Pass });
}
