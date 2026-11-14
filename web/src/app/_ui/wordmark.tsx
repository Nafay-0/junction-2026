import { PRODUCT_NAME } from "./brand";

/**
 * The word mark: a pilot light and the name in the display face.
 *
 * The pilot light is the indicator lamp that says a system is on and supervised: a lime lamp in a petrol bezel, with
 * soft corners like every control in the system. The quartered crash-test target is not part of the word mark: it
 * belongs to the gate alone.
 *
 *   tone "petrol"  the name in petrol-deep on paper or mist (the store, the phone pages)
 *   tone "paper"   the name in paper on petrol-deep (the operations sidebar, the wall)
 */
export function Wordmark({ tone = "petrol", size = 30, className = "" }: { tone?: "petrol" | "paper"; size?: number; className?: string }) {
  const lamp = Math.round(size * 0.62);
  return (
    <span className={`inline-flex items-center leading-none ${className}`} style={{ gap: Math.round(size * 0.3) }}>
      <PilotLight size={lamp} onDark={tone === "paper"} />
      <span className={`display whitespace-nowrap ${tone === "paper" ? "text-paper" : "text-petrol-deep"}`} style={{ fontSize: Math.round(size * 0.8), fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1 }}>
        {PRODUCT_NAME}
      </span>
    </span>
  );
}

/** The lamp alone: favicon-sized uses, or where the name is already written beside it. */
export function PilotLight({ size = 14, onDark = false }: { size?: number | string; bezel?: number; onDark?: boolean }) {
  return (
    <span aria-hidden className={`inline-flex shrink-0 items-center justify-center ${onDark ? "bg-paper/15" : "bg-petrol-deep"}`} style={{ width: size, height: size, borderRadius: "32%" }}>
      <span className="bg-lime" style={{ width: "46%", height: "46%", borderRadius: "50%", boxShadow: "0 0 0 2px rgb(192 224 33 / 0.28)" }} />
    </span>
  );
}
