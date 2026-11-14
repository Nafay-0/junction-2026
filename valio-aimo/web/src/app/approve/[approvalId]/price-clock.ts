/**
 * How long the fixed price still holds, on the sign-off screen. Nothing about a sign-off trusts the phone's
 * clock: the server says when the price runs out and what time it is there (`serverNow`, with every view), and the
 * phone only measures how much time has passed since. A phone set an hour fast or slow shows the same countdown,
 * and the server, which re-checks the price at sign-off by its own clock, has the last word either way.
 */

/** The server's clock minus the phone's, measured when a view arrives. 0 when the server sent no time (an older server). */
export function clockOffset(serverNow: string | undefined, phoneNow: number): number {
  const t = serverNow ? Date.parse(serverNow) : NaN;
  return Number.isFinite(t) ? t - phoneNow : 0;
}

/** Milliseconds until the price runs out, by the server's clock. */
export function priceMsLeft(priceHeldUntil: string, phoneNow: number, offset: number): number {
  return Date.parse(priceHeldUntil) - (phoneNow + offset);
}
