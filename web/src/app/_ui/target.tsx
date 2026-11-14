/**
 * The quartered crash-test target: the gate's mark (not the product's: that is the pilot light in `wordmark.tsx`). Two opposite quarters filled, two open, in a ring.
 *
 *   tone "safety"  yellow and ink: only where a person decides or the gate refuses
 *   tone "ink"     ink on light surfaces
 *   tone "chalk"   chalk on the dark wall
 *   tone "hollow"  ring only: a stage not reached yet
 */
type Tone = "safety" | "ink" | "chalk" | "hollow";

const FILL: Record<Tone, { a: string; b: string; ring: string }> = {
  safety: { a: "var(--color-safety)", b: "var(--color-ink)", ring: "var(--color-ink)" },
  ink: { a: "var(--color-ink)", b: "transparent", ring: "var(--color-ink)" },
  chalk: { a: "var(--color-chalk)", b: "transparent", ring: "var(--color-chalk)" },
  hollow: { a: "transparent", b: "transparent", ring: "currentColor" },
};

export function Target({ size = 24, tone = "ink", spin = false, className = "", title }: { size?: number; tone?: Tone; spin?: boolean; className?: string; title?: string }) {
  const f = FILL[tone];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      className={`${spin ? "spin" : ""} ${className}`}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <path d="M20 20 L20 3 A17 17 0 0 1 37 20 Z" fill={f.a} />
      <path d="M20 20 L20 37 A17 17 0 0 1 3 20 Z" fill={f.a} />
      <path d="M20 20 L37 20 A17 17 0 0 1 20 37 Z" fill={f.b} />
      <path d="M20 20 L3 20 A17 17 0 0 1 20 3 Z" fill={f.b} />
      <circle cx="20" cy="20" r="17" fill="none" stroke={f.ring} strokeWidth="3" />
      <path d="M20 1.5 V38.5 M1.5 20 H38.5" stroke={f.ring} strokeWidth="1.5" />
    </svg>
  );
}
