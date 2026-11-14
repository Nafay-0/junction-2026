"use client";

import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { useHydrated } from "@/lib/use-client";

/** Light or dark. The same switch as in the chat's top bar, for the screens that do not have that bar. */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const dark = useHydrated() && resolvedTheme === "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? "light" : "dark")}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      className={cn("flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground", className)}
    >
      {dark ? <Sun className="size-[1.05rem]" /> : <Moon className="size-[1.05rem]" />}
    </button>
  );
}
