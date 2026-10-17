import Ionicons from "@expo/vector-icons/Ionicons";
import type { ComponentProps } from "react";
import { Platform } from "react-native";

import { useTheme } from "../theme/ThemeProvider";

type Glyph = ComponentProps<typeof Ionicons>["name"];

/**
 * The app's one icon family: Ionicons (thin outline glyphs, filled twins for active states),
 * shipped as a font by @expo/vector-icons, so no native module and no SVG cost per icon.
 * Screens name icons by role (the names the Stitch design used); this table picks the glyph,
 * so the whole set is tuned here. Back and overflow follow each platform's convention.
 */
const GLYPHS = {
  add: "add",
  "add-circle": "add-circle",
  "add-circle-outline": "add-circle-outline",
  "arrow-back": Platform.OS === "ios" ? "chevron-back" : "arrow-back",
  "auto-awesome": "sparkles-outline",
  "auto-stories": "book-outline",
  "auto-stories-filled": "book",
  bolt: "flash-outline",
  bookmark: "bookmark",
  "bookmark-border": "bookmark-outline",
  "brightness-medium": "contrast-outline",
  "chat-bubble-outline": "chatbubble-outline",
  check: "checkmark",
  "check-circle": "checkmark-circle",
  "check-circle-outline": "checkmark-circle-outline",
  checkroom: "shirt-outline",
  "chevron-right": "chevron-forward",
  circle: "ellipse",
  close: "close",
  "cloud-download": "cloud-download-outline",
  "cloud-off": "cloud-offline-outline",
  "cloud-upload": "cloud-upload-outline",
  code: "code-slash-outline",
  "dark-mode": "moon-outline",
  "delete-forever": "trash",
  "delete-outline": "trash-outline",
  description: "document-text-outline",
  edit: "pencil-outline",
  "edit-note": "create-outline",
  "error-outline": "alert-circle-outline",
  "expand-more": "chevron-down",
  favorite: "heart",
  "favorite-border": "heart-outline",
  "folder-open": "folder-open-outline",
  "folder-special": "albums-outline",
  "folder-special-filled": "albums",
  gavel: "document-outline",
  google: "logo-google",
  "grid-view": "grid-outline",
  "grid-view-filled": "grid",
  hiking: "barbell-outline",
  history: "time-outline",
  home: "home-outline",
  "image-not-supported": "image-outline",
  "info-outline": "information-circle-outline",
  instagram: "logo-instagram",
  "ios-share": "share-outline",
  "light-mode": "sunny-outline",
  link: "link-outline",
  "link-off": "unlink-outline",
  "local-cafe": "cafe-outline",
  "lock-outline": "lock-closed-outline",
  logout: "log-out-outline",
  "mail-outline": "mail-outline",
  "menu-book": "book-outline",
  "more-vert": Platform.OS === "ios" ? "ellipsis-horizontal" : "ellipsis-vertical",
  movie: "film-outline",
  "north-east": "arrow-up-outline",
  "notifications-none": "notifications-outline",
  "offline-pin": "cloud-done-outline",
  "open-in-new": "open-outline",
  "photo-camera": "camera",
  place: "location-outline",
  "play-arrow": "play",
  "play-circle-outline": "play-circle-outline",
  "privacy-tip": "shield-checkmark-outline",
  "radio-button-unchecked": "ellipse-outline",
  refresh: "refresh-outline",
  "remove-circle-outline": "remove-circle-outline",
  restaurant: "restaurant-outline",
  schedule: "time-outline",
  search: "search-outline",
  "search-off": "search-outline",
  share: Platform.OS === "ios" ? "share-outline" : "share-social-outline",
  shield: "shield-outline",
  "smart-display": "videocam-outline",
  tune: "options-outline",
  verified: "ribbon-outline",
  "volume-up": "volume-high-outline",
  work: "briefcase-outline",
} as const satisfies Record<string, Glyph>;

export type IconName = keyof typeof GLYPHS;

export function Icon({ name, size = 22, color }: { name: IconName; size?: number; color?: string }) {
  const { colors } = useTheme();
  return <Ionicons name={GLYPHS[name]} size={size} color={color ?? colors.ink2} />;
}
