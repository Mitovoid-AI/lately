/** "1 reel", "3 reels": a count with its noun, singular for exactly one. */
export function countOf(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
