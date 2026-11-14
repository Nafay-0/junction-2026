import { ImageResponse } from "next/og";
import { LOGO } from "@/lib/brand";

/*
 * The icon a phone shows when the app is added to its home screen. Generated from the same
 * shapes as the logo, so it cannot drift. It fills the whole square: the phone rounds the corners.
 */

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: LOGO.tile }}>
        <svg width="180" height="180" viewBox="0 0 32 32">
          {LOGO.facets.map((facet) => (
            <path key={facet.d} d={facet.d} fill={LOGO.ink} opacity={facet.opacity} />
          ))}
          <path d={LOGO.table} fill={LOGO.ink} />
        </svg>
      </div>
    ),
    size,
  );
}
