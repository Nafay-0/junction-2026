import { PRODUCT_NAME } from "./brand";

/**
 * The word mark: a pilot light and the name in the heavy condensed cut.
 *
 * The pilot light is the indicator lamp on a control panel that says a system is on and supervised: a lime lamp in
 * a square petrol-deep bezel. It is the shop's own sign, drawn in the system's square geometry and its one action
 * colour. The quartered crash-test target is not part of the word mark: it belongs to the gate alone.
 *
 *   tone "petrol"  the name in petrol on paper or mist (the store, the phone pages)
 *   tone "paper"   the name in paper on petrol-deep (the operations rail, the wall); the bezel gets a paper hairline
 */
export function Wordmark({ tone = "petrol", size = 30, className = "" }: { tone?: "petrol" | "paper"; size?: number; className?: string }) {
  const lamp = Math.round(size * 0.46);
  const bezel = Math.max(2, Math.round(size * 0.1));
  return (
    <span className={`inline-flex items-center leading-none ${className}`} style={{ gap: Math.round(size * 0.24) }}>
      <PilotLight size={lamp} bezel={bezel} onDark={tone === "paper"} />
      <span className={`display whitespace-nowrap ${tone === "paper" ? "text-paper" : "text-petrol"}`} style={{ fontSize: size, letterSpacing: "-0.012em", lineHeight: 0.9 }}>
        {PRODUCT_NAME}
      </span>
    </span>
  );
}

/** The lamp alone: favicon-sized uses, or where the name is already written beside it. */
export function PilotLight({ size = 14, bezel = 2, onDark = false }: { size?: number | string; bezel?: number; onDark?: boolean }) {
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 bg-lime"
      style={{
        width: size,
        height: size,
        boxShadow: `0 0 0 ${bezel}px var(--color-petrol-deep)${onDark ? ", 0 0 0 " + (bezel + 1) + "px rgb(255 255 255 / 0.35)" : ""}`,
        marginInline: bezel,
      }}
    />
  );
}
