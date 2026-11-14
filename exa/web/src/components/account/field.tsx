"use client";

import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

const box =
  "h-11 w-full min-w-0 rounded-xl border border-input bg-card px-3.5 text-[0.95rem] shadow-card outline-none transition-[border-color,box-shadow] placeholder:text-subtle focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20 disabled:opacity-60 aria-invalid:border-destructive/60 aria-invalid:ring-3 aria-invalid:ring-destructive/15";

/** A labelled text field, in the app's own look. The label is a real label: a click on it focuses the field. */
export function Field({
  label,
  hint,
  className,
  inputClassName,
  trailing,
  ...props
}: React.ComponentProps<"input"> & {
  label: string;
  /** A line under the field: what is expected, or what is wrong. */
  hint?: React.ReactNode;
  /** Something inside the field's right edge, such as the show-password button. */
  trailing?: React.ReactNode;
  /** For the field itself (`className` is for the whole block, label and hint included). */
  inputClassName?: string;
}) {
  const id = React.useId();
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-[0.8rem] font-medium text-foreground/85">
        {label}
      </label>
      <div className="relative">
        <input id={id} aria-describedby={hint ? `${id}-hint` : undefined} className={cn(box, trailing ? "pr-11" : undefined, inputClassName)} {...props} />
        {trailing ? <div className="absolute inset-y-0 right-1.5 flex items-center">{trailing}</div> : null}
      </div>
      {hint ? (
        <p id={`${id}-hint`} className="text-[0.76rem] leading-snug text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** A password field with a button to look at what was typed. */
export function PasswordField({ label = "Password", ...props }: Omit<React.ComponentProps<typeof Field>, "label" | "type" | "trailing"> & { label?: string }) {
  const [shown, setShown] = React.useState(false);
  return (
    <Field
      label={label}
      type={shown ? "text" : "password"}
      trailing={
        <button
          type="button"
          onClick={() => setShown((v) => !v)}
          aria-label={shown ? "Hide the password" : "Show the password"}
          aria-pressed={shown}
          className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      }
      {...props}
    />
  );
}
