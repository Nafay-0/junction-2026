import Image from "next/image";
import shots from "./shots.json";

/**
 * Screenshots in quiet CSS frames: a phone bezel, a browser bar, a mail card. The pictures are made by
 * `pnpm landing:shots` (scripts/landing-shots.ts), which writes public/landing/<key>.webp and shots.json with each
 * file's size, so every image has explicit dimensions and nothing shifts while it loads. A key the manifest does not
 * have yet shows a placeholder of the same shape.
 */
type Shot = { src: string; w: number; h: number; kind: string; caption?: string };
const SHOTS = shots as Record<string, Shot>;

export const hasShot = (key: string) => Boolean(SHOTS[key]);

function Picture({ id, alt, sizes, priority, missing, ratio, crop }: { id: string; alt: string; sizes: string; priority?: boolean; missing: string; ratio: string; crop?: readonly [number, number] }) {
  const s = SHOTS[id];
  if (!s)
    return (
      <div className="lp-missing" style={{ aspectRatio: ratio }} role="img" aria-label={alt}>
        <span>{missing}</span>
      </div>
    );
  if (crop) {
    // Show only a vertical band of a wide screenshot (a narrow column centred on a desk), at a readable size.
    const [x, w] = crop;
    return (
      <div className="overflow-hidden" style={{ aspectRatio: `${Math.round(s.w * w)} / ${s.h}` }}>
        <Image src={s.src} width={s.w} height={s.h} alt={alt} sizes={sizes} unoptimized loading="lazy" className="block h-auto max-w-none" style={{ width: `${100 / w}%`, marginLeft: `${(-100 * x) / w}%` }} />
      </div>
    );
  }
  return (
    <Image
      src={s.src}
      width={s.w}
      height={s.h}
      alt={alt}
      sizes={sizes}
      unoptimized
      priority={priority}
      loading={priority ? undefined : "lazy"}
      className="block h-auto w-full"
    />
  );
}

/** A phone: a quiet bezel, the screen's corners rounded inside it. Width comes from the parent or `className`. */
export function Phone({ id, alt, className = "", priority, sizes = "(min-width: 1024px) 300px, 70vw", missing = "Screenshot coming" }: { id: string; alt: string; className?: string; priority?: boolean; sizes?: string; missing?: string }) {
  return (
    <div className={`lp-phone ${className}`}>
      <div className="lp-phone-screen">
        <Picture id={id} alt={alt} sizes={sizes} priority={priority} missing={missing} ratio="390 / 844" />
      </div>
    </div>
  );
}

/** A desktop browser window: a slim bar with three dots and the page's address, then the page. */
export function Browser({ id, alt, url, className = "", priority, sizes = "(min-width: 1280px) 760px, 92vw", missing = "Screenshot coming", crop }: { id: string; alt: string; url?: string; className?: string; priority?: boolean; sizes?: string; missing?: string; crop?: readonly [number, number] }) {
  return (
    <div className={`lp-browser ${className}`}>
      <div className="lp-browser-bar" aria-hidden>
        <span className="lp-dots">
          <i />
          <i />
          <i />
        </span>
        <span className="lp-url">{url ?? "aimopilot"}</span>
      </div>
      <Picture id={id} alt={alt} sizes={sizes} priority={priority} missing={missing} ratio="1440 / 900" crop={crop} />
    </div>
  );
}

/** A received email: who it is from and its subject, then the mail as the client shows it. */
export function Mail({ id, alt, from, subject, missing = "Screenshot coming" }: { id: string; alt: string; from: string; subject: string; missing?: string }) {
  return (
    <figure className="lp-mail">
      <figcaption className="lp-mail-head">
        <span className="text-[0.78rem] text-ink-soft">{from}</span>
        <span className="block text-[0.95rem] font-semibold leading-snug text-ink">{subject}</span>
      </figcaption>
      <div className="lp-mail-body">
        <Picture id={id} alt={alt} sizes="(min-width: 1024px) 460px, 90vw" missing={missing} ratio="600 / 900" />
      </div>
    </figure>
  );
}

/** A desktop screen with a phone resting on its lower corner: the same product at both sizes. */
export function Duo({ desktop, phone, url, side = "right", priority }: { desktop: { id: string; alt: string }; phone: { id: string; alt: string }; url?: string; side?: "left" | "right"; priority?: boolean }) {
  return (
    <div className={`lp-duo lp-duo-${side}`}>
      <Browser id={desktop.id} alt={desktop.alt} url={url} priority={priority} />
      <Phone id={phone.id} alt={phone.alt} className="lp-duo-phone" priority={priority} sizes="(min-width: 1024px) 220px, 36vw" />
    </div>
  );
}
