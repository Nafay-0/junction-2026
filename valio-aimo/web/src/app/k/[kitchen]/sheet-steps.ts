/**
 * Packs per tap: one for a big pack, more for small packs ordered in quantity (ten 1 L cartons at a time once the
 * line holds twenty or more), so a step is a sensible amount for a kitchen. The number can always be typed.
 */
export function stepFor(packSize: number, unit: string, packs: number): number {
  if (unit.toLowerCase() === "pcs" || packSize >= 5 || packs < 20) return 1;
  return packSize <= 1 ? 10 : 5;
}
