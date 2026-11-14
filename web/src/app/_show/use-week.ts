"use client";

import { useEffect, useRef, useState } from "react";
import { api, type ApiError } from "../_client/api";
import type { Recording, WeekRun } from "@/server/show/types";

const over = (r?: WeekRun) => !!r && (r.state === "finished" || r.state === "cancelled" || r.state === "failed");

/**
 * A live week, kept current by long-polling the director: each request returns as soon as the run changes, so a
 * sign-off on the phone reaches the screen within the round trip of one request.
 */
export function useLiveWeek(runId: string | undefined, initial?: WeekRun): { run?: WeekRun; error?: ApiError } {
  const [run, setRun] = useState<WeekRun | undefined>(initial);
  const [error, setError] = useState<ApiError>();
  const version = useRef(initial?.version ?? -1);
  useEffect(() => {
    if (!runId) return;
    let alive = true;
    let fails = 0;
    version.current = initial?.runId === runId ? initial.version : -1;
    (async () => {
      while (alive) {
        const r = await api<{ run: WeekRun }>("GET", `/ui-api/show/week/${runId}?after=${version.current}`);
        if (!alive) return;
        if (r.ok) {
          fails = 0;
          setError(undefined);
          if (r.data.run.version !== version.current) {
            version.current = r.data.run.version;
            setRun(r.data.run);
          }
          if (over(r.data.run)) return;
        } else {
          fails += 1;
          setError(r.error);
          if (r.status === 404 || r.status === 401) return;
          await new Promise((res) => setTimeout(res, Math.min(4000, 400 * fails)));
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [runId, initial]);
  return { run, error };
}

/**
 * Plays a recording through the same screen: each frame at the moment it happened on the day. The offset maps the
 * wall clock onto the recorded one, so countdowns count as they did.
 */
export function useRecording<T extends { startedAt?: string }>(rec: Recording<T> | undefined, playing: boolean, speed = 1): { data?: T; offset: number; done: boolean } {
  const [i, setI] = useState(0);
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    if (!rec || !playing) return;
    setI(0);
    const t0 = Date.now();
    const recordedStart = rec.frames[0]?.data.startedAt ? Date.parse(rec.frames[0].data.startedAt) : t0;
    setOffset(recordedStart - t0);
    const timers = rec.frames.map((f, k) => setTimeout(() => setI(k), f.t / speed));
    return () => timers.forEach(clearTimeout);
  }, [rec, playing, speed]);
  if (!rec || !playing) return { offset: 0, done: false };
  return { data: rec.frames[Math.min(i, rec.frames.length - 1)]?.data, offset, done: i >= rec.frames.length - 1 };
}
