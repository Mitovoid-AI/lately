/** The router calls back-navigation needs (expo-router's `useRouter()` satisfies it). */
interface BackRouter {
  canGoBack(): boolean;
  back(): void;
  replace(href: string): void;
}

/** Back, or — opened from a link, a share or after a refresh, with no history — to `fallback`. */
export function goBack(router: BackRouter, fallback: string = "/") {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}
