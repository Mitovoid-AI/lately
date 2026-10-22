/** The slice of a React Navigation `navigation` object this needs. */
export interface NavLike {
  getState?: () => { type?: string; index?: number } | undefined;
  getParent?: () => NavLike | undefined;
}

/**
 * True when a screen sits on top of other screens in the app's stack, so a Back button has
 * somewhere to go: Search opened from Curated's "See all", say. As a tab root (the usual case)
 * the nearest stack holds only the tabs, so it is false and the screen shows no Back.
 * It walks up to the nearest stack navigator and asks whether that stack is deeper than one.
 */
export function pushedOnStack(navigation: NavLike | undefined): boolean {
  let nav = navigation;
  while (nav) {
    const state = nav.getState?.();
    if (state?.type === "stack") return (state.index ?? 0) > 0;
    nav = nav.getParent?.();
  }
  return false;
}
