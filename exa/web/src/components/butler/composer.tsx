"use client";

import * as React from "react";
import type { FileUIPart } from "ai";
import { ArrowUp, AudioLines, Check, ChevronDown, ImagePlus, LoaderCircle, LocateFixed, MapPin, Mic, Square, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useClientValue } from "@/lib/use-client";
import { voiceSupported } from "@/lib/voice/audio";
import { startDictation, type Dictation } from "@/lib/voice/dictation";
import { MODELS, getModel, type ModelInfo } from "@/lib/agent/models";
import { formatAccuracy, type LocateResult } from "@/lib/location";
import type { ExactLocation } from "@/lib/widgets/types";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const MAX_IMAGES = 3;
const MAX_EDGE = 1568;

/** Put what was just heard after what is already in the box. */
const join = (text: string, heard: string) => (!heard ? text : !text ? heard : /\s$/.test(text) ? text + heard : `${text} ${heard}`);

/** Shrink an image in the browser so a phone photo does not become a 10 MB request. */
async function toImagePart(file: File): Promise<FileUIPart> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return { type: "file", mediaType: "image/jpeg", filename: file.name.replace(/\.[^.]+$/, "") + ".jpg", url: canvas.toDataURL("image/jpeg", 0.85) };
}

export function Composer({
  onSend,
  onStop,
  busy,
  modelId,
  onModelChange,
  where,
  autoFocus,
  onTalk,
  inCall,
}: {
  onSend: (text: string, files: FileUIPart[]) => void;
  /** Start a live call: talk with the agent instead of typing. Left out where there is no call to start. */
  onTalk?: () => void;
  /** A live call is on: what is typed here is said in the call, and the microphone is the call's. */
  inCall?: boolean;
  onStop: () => void;
  /** True while the agent is working. */
  busy: boolean;
  modelId: string;
  onModelChange: (id: string) => void;
  /** Where the user is: an exact position if they shared one, otherwise a place name. */
  where: WhereProps;
  autoFocus?: boolean;
}) {
  const [text, setText] = React.useState("");
  const [images, setImages] = React.useState<FileUIPart[]>([]);
  const [dragging, setDragging] = React.useState(false);
  const textarea = React.useRef<HTMLTextAreaElement>(null);
  const fileInput = React.useRef<HTMLInputElement>(null);

  /* Voice input. Speak, and the words appear here as they are spoken; nothing is sent until the
     user presses Send. `interim` is what is being said right now: it changes until the speaker
     pauses, then joins the text. */
  const canVoice = useClientValue(voiceSupported, false) && !inCall;
  const [listening, setListening] = React.useState<"off" | "starting" | "on">("off");
  const [interim, setInterim] = React.useState("");
  const dictation = React.useRef<Dictation | null>(null);
  const shown = join(text, interim);

  const stopListening = React.useCallback(() => {
    dictation.current?.stop();
  }, []);
  const startListening = React.useCallback(() => {
    if (dictation.current || listening !== "off") return;
    setListening("starting");
    void startDictation({
      onInterim: setInterim,
      onFinal: (heard) => {
        setInterim("");
        setText((prev) => join(prev, heard.trim()));
      },
      onEnd: (problem) => {
        dictation.current = null;
        // Whatever was still being said when it stopped is kept.
        setInterim((last) => {
          if (last.trim()) setText((prev) => join(prev, last.trim()));
          return "";
        });
        setListening("off");
        if (problem) toast.error(problem);
      },
    }).then(
      (session) => {
        dictation.current = session;
        setListening("on");
      },
      (err: unknown) => {
        setListening("off");
        toast.error(err instanceof Error ? err.message : "Voice input could not start.");
      },
    );
  }, [listening]);
  // Leaving the conversation ends it.
  React.useEffect(() => () => dictation.current?.stop(), []);

  const resize = React.useCallback(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    // While words are arriving, keep the newest ones in view.
    if (dictation.current) el.scrollTop = el.scrollHeight;
  }, []);
  React.useEffect(resize, [shown, resize]);

  // The box can change width without the text changing (a hidden tab becoming visible, rotation,
  // a split view), which changes how the text wraps: measure again when that happens.
  React.useEffect(() => {
    const el = textarea.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth !== width) {
        width = el.clientWidth;
        resize();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [resize]);

  React.useEffect(() => {
    if (autoFocus && window.matchMedia("(pointer: fine)").matches) textarea.current?.focus();
  }, [autoFocus]);

  const addFiles = async (files: FileList | File[] | null) => {
    const picked = Array.from(files ?? []).filter((f) => f.type.startsWith("image/"));
    if (picked.length === 0) return;
    const room = MAX_IMAGES - images.length;
    const parts = await Promise.all(picked.slice(0, Math.max(0, room)).map(toImagePart)).catch(() => []);
    setImages((prev) => [...prev, ...parts].slice(0, MAX_IMAGES));
  };

  const canSend = !busy && (shown.trim().length > 0 || images.length > 0);
  const submit = () => {
    if (!canSend) return;
    stopListening();
    onSend(shown.trim(), images);
    setText("");
    setInterim("");
    setImages([]);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void addFiles(e.dataTransfer.files);
      }}
      className={cn(
        "relative rounded-[1.4rem] border bg-card shadow-float transition-[border-color,box-shadow] duration-200",
        "focus-within:border-ring/60 focus-within:ring-4 focus-within:ring-ring/10",
        dragging ? "border-brand ring-4 ring-brand/15" : "border-border",
      )}
    >
      {images.length > 0 ? (
        <div className="flex flex-wrap gap-2 px-3.5 pt-3.5">
          {images.map((img, i) => (
            <div key={i} className="group/img relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.url} alt={img.filename ?? "Attachment"} className="size-16 rounded-xl border border-border object-cover" />
              <button
                type="button"
                aria-label="Remove image"
                onClick={() => setImages((prev) => prev.filter((_, n) => n !== i))}
                className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-card transition-colors hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <textarea
        ref={textarea}
        value={shown}
        rows={1}
        // While a sentence is still being heard it is not the user's to edit: it would change under their hands.
        readOnly={interim.length > 0}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          } else if (e.key === "Escape" && listening !== "off") {
            e.preventDefault();
            stopListening();
          }
        }}
        onPaste={(e) => {
          const files = Array.from(e.clipboardData.files);
          if (files.some((f) => f.type.startsWith("image/"))) {
            e.preventDefault();
            void addFiles(files);
          }
        }}
        placeholder={inCall ? "Type something to say in the call" : listening === "off" ? "Hand me a task: plan it, find it, compare it, book it" : "Listening. Speak in any language"}
        aria-label="Message"
        className="block max-h-[200px] w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-base leading-relaxed outline-none placeholder:text-subtle sm:text-[0.95rem]"
      />

      <div className="flex items-center gap-1 px-2 pt-1 pb-2">
        <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(e) => void addFiles(e.target.files).then(() => (e.target.value = ""))} />
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={images.length >= MAX_IMAGES}
          aria-label="Attach an image"
          title="Attach an image to search with it"
          className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
        >
          <ImagePlus className="size-[1.1rem]" />
        </button>

        <ModelPicker modelId={modelId} onChange={onModelChange} />
        <PlaceChip {...where} />

        <div className="flex-1" />

        {canVoice ? (
          <button
            type="button"
            onClick={listening === "off" ? startListening : stopListening}
            disabled={listening === "starting"}
            aria-pressed={listening !== "off"}
            aria-label={listening === "off" ? "Speak instead of typing" : "Stop listening"}
            title={listening === "off" ? "Speak instead of typing: your words appear here" : "Stop listening"}
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-full transition-colors",
              listening === "off" ? "text-muted-foreground hover:bg-muted hover:text-foreground" : "bg-brand-soft text-brand",
            )}
          >
            {listening === "starting" ? (
              <LoaderCircle className="size-[1.05rem] animate-spin" />
            ) : listening === "on" ? (
              <span className="flex h-4 items-center gap-[3px]" aria-hidden>
                {[0, 1, 2, 3].map((i) => (
                  <span key={i} className="h-full w-[3px] origin-center rounded-full bg-current" style={{ animation: "voice-bar 0.9s ease-in-out infinite", animationDelay: `${i * 0.14}s` }} />
                ))}
              </span>
            ) : (
              <Mic className="size-[1.1rem]" />
            )}
          </button>
        ) : null}
        {canVoice && onTalk && !busy && listening === "off" ? (
          <button
            type="button"
            onClick={onTalk}
            aria-label="Talk: start a live call"
            title="Talk with it instead of typing"
            className="flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-border bg-card px-2.5 text-[0.82rem] font-medium transition-colors hover:border-ring/50 hover:bg-muted @min-[440px]/chat:px-3"
          >
            <AudioLines className="size-[1.05rem] text-brand" />
            <span className="hidden @min-[440px]/chat:inline">Talk</span>
          </button>
        ) : null}

        {busy ? (
          <button
            type="button"
            onClick={onStop}
            aria-label="Stop"
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-transform hover:scale-105 active:scale-95"
          >
            <Square className="size-3.5 fill-current" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!canSend}
            aria-label="Send"
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-[transform,opacity] hover:scale-105 active:scale-95 disabled:scale-100 disabled:opacity-30"
          >
            <ArrowUp className="size-[1.15rem]" strokeWidth={2.4} />
          </button>
        )}
      </div>
    </form>
  );
}

/** "Claude Opus 5.5" is "Opus 5.5" where room is short: the dot beside it already says which family. */
const shortModel = (label: string) => label.replace(/^Claude\s+/, "").replace(/^Gemini\s+\d+\s+/, "");

function ModelPicker({ modelId, onChange }: { modelId: string; onChange: (id: string) => void }) {
  const current = getModel(modelId);
  const groups: Array<[string, ModelInfo[]]> = [
    ["Claude, on AWS", MODELS.filter((m) => m.provider === "claude")],
    ["Gemini", MODELS.filter((m) => m.provider === "gemini")],
  ];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex h-9 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[0.8rem] whitespace-nowrap text-muted-foreground transition-colors hover:bg-muted hover:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground"
        aria-label={`Choose model. Now: ${current.label}`}
      >
        <span className={cn("size-1.5 shrink-0 rounded-full", current.provider === "claude" ? "bg-brass" : "bg-chart-3")} />
        {/* Never cut off mid-word: the short name in a narrow column, the full one where it fits. */}
        <span className="@min-[560px]/chat:hidden">{shortModel(current.label)}</span>
        <span className="hidden @min-[560px]/chat:inline">{current.label}</span>
        <ChevronDown className="size-3.5 shrink-0 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-72">
        {groups.map(([label, models], g) => (
          <React.Fragment key={label}>
            {g > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuLabel className="text-[0.7rem] font-medium tracking-wide text-subtle uppercase">{label}</DropdownMenuLabel>
            {models.map((m) => (
              <DropdownMenuItem key={m.id} onSelect={() => onChange(m.id)} className="flex items-start gap-2.5 py-2">
                <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">{m.id === current.id ? <Check className="size-4 text-brand" /> : null}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="font-medium">{m.label}</span>
                    <span className="nums shrink-0 text-[0.7rem] text-subtle">
                      ${m.price.input} / ${m.price.output}
                    </span>
                  </span>
                  <span className="block text-[0.75rem] leading-snug text-muted-foreground">{m.blurb}</span>
                </span>
              </DropdownMenuItem>
            ))}
          </React.Fragment>
        ))}
        <DropdownMenuSeparator />
        <p className="px-2 py-1.5 text-[0.7rem] leading-snug text-subtle">Prices are US dollars per million tokens, input / output. You can switch model mid-conversation.</p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export type WhereProps = {
  /** The place name used when no exact position is shared ("Helsinki, Finland"). */
  place: string;
  onPlaceChange: (place: string) => void;
  /** The exact position saved in this browser, if the user has shared one. */
  exact: ExactLocation | null;
  /** Ask the browser for the position (shows its permission prompt if needed) and save it. */
  onLocate: () => Promise<LocateResult>;
  /** Stop using the exact position. */
  onClearExact: () => void;
};

const LOCATE_PROBLEM: Record<Exclude<LocateResult, { ok: true }>["reason"], string> = {
  denied: "Your browser blocked it. Allow location for this site from the icon at the left of the address bar, then try again.",
  unavailable: "Your device could not work out where it is.",
  timeout: "That took too long. Try again.",
  unsupported: "This browser cannot share a location.",
  insecure: "Browsers only share location on a secure (https) page.",
};

function PlaceChip({ place, onPlaceChange, exact, onLocate, onClearExact }: WhereProps) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState(place);
  const [locating, setLocating] = React.useState(false);
  const [problem, setProblem] = React.useState("");
  // Always a name. Until the name of a freshly shared position has been looked up, say so in words.
  const label = exact ? (exact.label ?? "Your location") : place;
  // "Otaniemi, Espoo, Finland" is "Otaniemi" where room is short.
  const short = label.split(",")[0]?.trim() ?? "";

  const shareExact = async () => {
    setLocating(true);
    setProblem("");
    const result = await onLocate();
    setLocating(false);
    if (!result.ok) setProblem(LOCATE_PROBLEM[result.reason]);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setDraft(place);
          setProblem("");
        }
        setOpen(next);
      }}
    >
      <PopoverTrigger
        className="flex h-9 min-w-9 shrink-0 items-center justify-center gap-1.5 rounded-full px-2.5 text-[0.8rem] whitespace-nowrap text-muted-foreground transition-colors hover:bg-muted hover:text-foreground data-[state=open]:bg-muted"
        aria-label={exact ? `Your exact location: ${label}` : `Your location: ${label || "not set"}`}
        title={label || "Set location"}
      >
        {exact ? <LocateFixed className="size-3.5 shrink-0 text-brand" /> : <MapPin className="size-3.5 shrink-0" />}
        {/* The pin alone in a narrow column, then the first part of the name, then all of it. */}
        <span className="hidden max-w-[8rem] truncate @min-[400px]/chat:inline @min-[560px]/chat:hidden">{short || "Set location"}</span>
        <span className="hidden max-w-[11rem] truncate @min-[560px]/chat:inline">{label || "Set location"}</span>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-80 p-0">
        <div className="space-y-2.5 p-3.5">
          <p className="text-[0.8rem] font-medium">Where are you?</p>
          {exact ? (
            <div className="flex items-start gap-2.5 rounded-xl bg-brand-soft/60 p-2.5">
              <LocateFixed className="mt-0.5 size-4 shrink-0 text-brand" />
              <div className="min-w-0 flex-1 text-[0.8rem] leading-snug">
                <p className="font-medium">Using your exact location</p>
                <p className="truncate text-muted-foreground">
                  {exact.label ?? "Looking up the place name"}
                  {exact.accuracyM ? `, ${formatAccuracy(exact.accuracyM)}` : ""}
                </p>
                <div className="mt-1.5 flex gap-3">
                  <button type="button" onClick={() => void shareExact()} disabled={locating} className="font-medium text-brand hover:underline disabled:opacity-50">
                    {locating ? "Updating" : "Update"}
                  </button>
                  <button type="button" onClick={onClearExact} className="text-muted-foreground hover:text-foreground hover:underline">
                    Stop using it
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => void shareExact()}
              disabled={locating}
              className="flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-primary text-[0.8rem] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {locating ? <LoaderCircle className="size-4 animate-spin" /> : <LocateFixed className="size-4" />}
              {locating ? "Waiting for your browser" : "Use my exact location"}
            </button>
          )}
          {problem ? <p className="text-[0.75rem] leading-snug text-destructive">{problem}</p> : null}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onPlaceChange(draft.trim());
            setOpen(false);
          }}
          className="space-y-2 border-t border-border p-3.5"
        >
          <label htmlFor="place" className="block text-[0.75rem] text-muted-foreground">
            {exact ? "Fallback place, used if you stop sharing" : "Or name a place"}
          </label>
          <div className="flex gap-2">
            <input
              id="place"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Espoo, Finland"
              className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-[0.85rem] outline-none focus:border-ring focus:ring-3 focus:ring-ring/20"
            />
            <button type="submit" className="h-9 shrink-0 rounded-lg border border-border px-3 text-[0.8rem] font-medium transition-colors hover:bg-muted">
              Save
            </button>
          </div>
          <p className="text-[0.72rem] leading-snug text-muted-foreground">Used for anything local: places, weather, shops, prices. Kept in this browser and sent only with your messages.</p>
        </form>
      </PopoverContent>
    </Popover>
  );
}
