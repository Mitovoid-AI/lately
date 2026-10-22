/** The grid every list of saves shares (Home, Stacks, a stack): 16 pt gutters, 12 pt gaps. */
export const GRID_GAP = 12;
export const GRID_SIDE = 16;
/** The widest the grid gets; on a wider window it stays centred. */
export const GRID_MAX_WIDTH = 1280;
/** A tile is never narrower than this (160 pt) plus the gap that comes with it. */
const COLUMN_STEP = 160 + GRID_GAP;

/**
 * Columns and tile width for a window `width` pt wide: as many 160 pt-plus tiles as fit between
 * the gutters, two at the least (a phone) and five at the most. A 600 pt foldable or 7 inch
 * tablet gets three or four, not two stretched ones.
 */
export function gridLayout(width: number): { columns: number; itemWidth: number } {
  const usable = Math.min(width, GRID_MAX_WIDTH);
  const fit = Math.floor((usable - GRID_SIDE * 2 + GRID_GAP) / COLUMN_STEP);
  const columns = Math.min(5, Math.max(2, fit));
  const itemWidth = (usable - GRID_SIDE * 2 - GRID_GAP * (columns - 1)) / columns;
  return { columns, itemWidth };
}

/** A "Back for you" tile: 0.72 of a grid tile, never under 120 pt or over 176 pt. */
export function memoryTileWidth(itemWidth: number): number {
  return Math.min(176, Math.max(120, Math.round(itemWidth * 0.72)));
}
