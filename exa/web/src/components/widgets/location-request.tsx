"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, CornerDownLeft, LoaderCircle, LocateFixed, MapPin, MapPinOff, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatAccuracy, locate, permissionState, type PermissionState } from "@/lib/location";
import type { ExactLocation, LocationAnswer, LocationRequestInput } from "@/lib/widgets/types";

type Phase = "idle" | "locating" | "blocked" | "failed";

/**
 * The agent asks for the user's exact location. Accepting calls the browser's Geolocation API,
 * which shows the browser's own permission prompt the first time. If access was allowed before,
 * the card resolves itself without a click. If it is blocked or refused, the user can carry on
 * with an approximate place or type one.
 */
export function LocationRequest({
  input,
  answer,
  approximatePlace,
  saved,
  onResult,
  loading,
}: {
  input: LocationRequestInput;
  /** Set once answered: renders the read-only result. */
  answer?: LocationAnswer;
  /** The place we would otherwise assume, for example "Helsinki, Finland". */
  approximatePlace: string;
  /** An exact location already saved in this browser, if any. */
  saved?: ExactLocation | null;
  onResult?: (answer: LocationAnswer) => void;
  /** The request is still streaming in. */
  loading?: boolean;
}) {
  const [phase, setPhase] = React.useState<Phase>("idle");
  const [failure, setFailure] = React.useState<string>("");
  const [typing, setTyping] = React.useState(false);
  const [place, setPlace] = React.useState("");
  const [local, setLocal] = React.useState<LocationAnswer | null>(null);
  const started = React.useRef(false);
  const final = answer ?? local;

  const finish = React.useCallback(
    (result: LocationAnswer) => {
      setLocal(result);
      onResult?.(result);
    },
    [onResult],
  );

  const share = React.useCallback(async () => {
    setPhase("locating");
    const result = await locate();
    if (result.ok) {
      finish({ status: "granted", ...result.location });
      return;
    }
    if (result.reason === "denied") {
      // Either the user just said no, or the browser has it blocked for this site.
      setPhase("blocked");
      return;
    }
    setFailure(
      result.reason === "timeout"
        ? "Your device took too long to find its position."
        : result.reason === "insecure"
          ? "Browsers only share location on a secure (https) page."
          : result.reason === "unsupported"
            ? "This browser cannot share a location."
            : "Your device could not work out where it is.",
    );
    setPhase("failed");
  }, [finish]);

  // If the browser already allows it, do not make the user click again.
  React.useEffect(() => {
    if (final || loading || started.current || !onResult) return;
    started.current = true;
    let cancelled = false;
    void permissionState().then((state: PermissionState) => {
      if (cancelled) return;
      if (state === "granted") void share();
      else if (state === "denied") setPhase("blocked");
    });
    return () => {
      cancelled = true;
    };
  }, [final, loading, onResult, share]);

  if (final) return <Answered answer={final} approximatePlace={approximatePlace} />;

  const useApproximate = () => finish({ status: phase === "blocked" ? "denied" : phase === "failed" ? "unavailable" : "declined", place: approximatePlace || undefined });
  const submitPlace = () => {
    const typed = place.trim();
    if (typed) finish({ status: phase === "blocked" ? "denied" : "declined", place: typed });
  };

  return (
    <section className="w-full animate-rise overflow-hidden rounded-2xl border border-border bg-card shadow-card" aria-live="polite">
      <div className="flex items-start gap-3 px-4 pt-4 sm:px-5">
        <span className={cn("mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl", phase === "blocked" || phase === "failed" ? "bg-muted text-muted-foreground" : "bg-brand-soft text-brand")}>
          {phase === "locating" ? <LoaderCircle className="size-[1.1rem] animate-spin" /> : phase === "blocked" || phase === "failed" ? <MapPinOff className="size-[1.1rem]" /> : <LocateFixed className="size-[1.1rem]" />}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[0.95rem] leading-6 font-medium tracking-tight">
            {phase === "locating" ? "Waiting for your browser" : phase === "blocked" ? "Location is blocked for this site" : phase === "failed" ? "Could not get your location" : "Share your exact location?"}
          </h3>
          <p className="mt-0.5 text-[0.85rem] leading-relaxed text-muted-foreground">
            {phase === "locating" ? (
              "If your browser asks, choose Allow. This usually takes a second or two."
            ) : phase === "blocked" ? (
              <>
                Your browser refused, or location was turned off for this site earlier. To allow it, open the site settings from the icon at the left of the address bar, set Location to Allow, then try again. Or carry on without it.
              </>
            ) : phase === "failed" ? (
              failure
            ) : (
              <>
                {input.reason ? `I'd use it ${input.reason.replace(/^to\s+/i, "to ").replace(/\.$/, "")}.` : "It lets me find what is actually close to you."} Your browser will ask for permission.
              </>
            )}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-4 pt-3.5 pb-4 sm:px-5">
        {phase !== "locating" ? (
          <button
            type="button"
            onClick={() => void share()}
            disabled={loading}
            className="flex h-9 items-center gap-2 rounded-full bg-primary px-4 text-[0.85rem] font-medium text-primary-foreground transition-[transform,opacity] hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
          >
            <LocateFixed className="size-4" />
            {phase === "idle" ? "Share location" : "Try again"}
          </button>
        ) : null}
        <button
          type="button"
          onClick={useApproximate}
          disabled={loading}
          className="flex h-9 items-center gap-2 rounded-full border border-border bg-card px-4 text-[0.85rem] font-medium transition-colors hover:bg-muted disabled:opacity-50"
        >
          <MapPin className="size-4 text-muted-foreground" />
          {approximatePlace ? `Use ${approximatePlace.split(",")[0]} instead` : "Continue without it"}
        </button>
        <button
          type="button"
          onClick={() => setTyping((v) => !v)}
          className="h-9 rounded-full px-3 text-[0.85rem] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          Type a place
        </button>
      </div>

      <AnimatePresence initial={false}>
        {typing ? (
          <motion.form
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            onSubmit={(e) => {
              e.preventDefault();
              submitPlace();
            }}
            className="overflow-hidden"
          >
            <div className="flex items-center gap-2 px-4 pb-4 sm:px-5">
              <input
                autoFocus
                value={place}
                onChange={(e) => setPlace(e.target.value)}
                placeholder="A neighbourhood, address or city"
                aria-label="A place to use instead"
                className="h-10 min-w-0 flex-1 rounded-xl border border-input bg-background px-3 text-base outline-none focus:border-ring focus:ring-3 focus:ring-ring/20 sm:text-[0.9rem]"
              />
              <button
                type="submit"
                disabled={!place.trim()}
                aria-label="Use this place"
                className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-30"
              >
                <CornerDownLeft className="size-4" />
              </button>
            </div>
          </motion.form>
        ) : null}
      </AnimatePresence>

      <p className="flex items-center gap-1.5 border-t border-border/70 bg-surface/60 px-4 py-2 text-[0.72rem] text-muted-foreground sm:px-5">
        <ShieldCheck className="size-3.5 shrink-0" />
        {saved ? "A location is already saved in this browser; sharing again refreshes it." : "Kept in this browser and sent only with your messages. You can turn it off from the location button below."}
      </p>
    </section>
  );
}

function Answered({ answer, approximatePlace }: { answer: LocationAnswer; approximatePlace: string }) {
  const granted = answer.status === "granted";
  const fallback = !granted ? answer.place || approximatePlace : "";
  return (
    <div className="flex w-full animate-fade items-center gap-3 rounded-2xl border border-border bg-surface/70 px-4 py-3">
      <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-full", granted ? "bg-brand text-primary-foreground" : "bg-muted text-muted-foreground")}>
        {granted ? <Check className="size-4" strokeWidth={2.5} /> : <MapPinOff className="size-3.5" />}
      </span>
      <div className="min-w-0 text-[0.85rem] leading-snug">
        {granted ? (
          <>
            <span className="font-medium">Using your location</span>
            <span className="text-muted-foreground">
              {answer.label ? `: ${answer.label}` : `: ${answer.lat.toFixed(4)}, ${answer.lng.toFixed(4)}`}
              {answer.accuracyM ? ` (${formatAccuracy(answer.accuracyM)})` : ""}
            </span>
          </>
        ) : (
          <>
            <span className="font-medium">{answer.status === "denied" ? "Location not allowed" : answer.status === "unavailable" ? "Location unavailable" : "Location not shared"}</span>
            <span className="text-muted-foreground">{fallback ? `. Using ${fallback}.` : "."}</span>
          </>
        )}
      </div>
    </div>
  );
}
