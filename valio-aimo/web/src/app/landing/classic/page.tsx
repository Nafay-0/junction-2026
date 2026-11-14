import type { Metadata } from "next";
import { Landing } from "../../_landing/landing";
import { LANDING_TEXT } from "../../_landing/landing.text";

export const metadata: Metadata = {
  title: `${LANDING_TEXT.en.meta.title} (first version)`,
  description: LANDING_TEXT.en.meta.description,
  robots: { index: false },
};

/** The first version of the landing page, kept reachable while the second is chosen. */
export default function ClassicLanding() {
  return <Landing />;
}
