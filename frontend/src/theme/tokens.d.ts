export interface Palette {
  canvas: string;
  card: string;
  raised: string;
  hairline: string;
  ink: string;
  ink2: string;
  ink3: string;
  accent: string;
  onAccent: string;
  accentPressed: string;
  success: string;
  danger: string;
  dangerSoft: string;
  dangerPressed: string;
  accentText: string;
  warm: string;
  onMedia: string;
  onMediaMuted: string;
  scrim: string;
  scrimLight: string;
  mediaHairline: string;
  backdrop: string;
  focusRing: string;
  onAccentDot: string;
  google: string;
}

export interface Shadows {
  card: string;
  raised: string;
  overlay: string;
  accent: string;
}

export declare const palettes: { light: Palette; dark: Palette };
export declare const shadowSets: { light: Shadows; dark: Shadows };
export declare const sheens: { light: string; dark: string };
export declare const scrims: { tile: { light: string; dark: string } };
export declare function cssName(token: string): string;
export declare function cssVariables(palette: Palette): Record<string, string>;
