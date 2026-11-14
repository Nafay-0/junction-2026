import { cn } from "@/lib/utils";
import { LOGO } from "@/lib/brand";

/**
 * The mark: a baton changing hands, on the brand tile. It follows the theme (dark emerald with an
 * ivory baton in light mode, the reverse in dark mode). Decorative by default: pass `title` where
 * it stands alone, without the name beside it.
 */
export function Logo({
  size = 32,
  title,
  className,
}: {
  /** Width and height in pixels. */
  size?: number;
  /** Read out by screen readers. Leave it out when the name is written next to the mark. */
  title?: string;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={cn("shrink-0", className)}
    >
      <rect width="32" height="32" rx={LOGO.radius} className="fill-primary" />
      <path d={LOGO.near} className="fill-primary-foreground" />
      <path d={LOGO.far} className="fill-primary-foreground" opacity={LOGO.farOpacity} />
    </svg>
  );
}
