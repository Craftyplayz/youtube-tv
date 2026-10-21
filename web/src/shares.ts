// Sets one Source to `percent` of the Channel and scales the others to fill the rest, keeping their proportions;
// Shares then add up to about 100, so each slider sits at its own percentage
export function rebalance<S extends { id: number; share: number }>(sources: S[], id: number, percent: number): S[] {
  const p = Math.min(Math.max(Math.round(percent), 1), 100 - (sources.length - 1)); // every other Source keeps at least 1
  const rest = sources.reduce((a, s) => s.id === id ? a : a + s.share, 0);
  return sources.map(s => ({ ...s, share: s.id === id ? p : Math.max(1, Math.round(s.share / rest * (100 - p))) }));
}
