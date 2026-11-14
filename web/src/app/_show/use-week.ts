"use client";

import { useEffect, useRef, useState } from "react";
import { api, type ApiError } from "../_client/api";
import type { Recording, WeekRun } from "@/server/show/types";

const over = (r?: WeekRun) => !!r && (r.state === "finished" || r.state === "cancelled" || r.state === "failed");

/**
 * A live week, kept current by long-polling the director: each request returns as soon as the run changes, so a
 * sign-off on the phone reaches the screen within the round trip of one request.
 */
export function useLiveWeek(runId: string | undefined, initial?: WeekRun, urlOf: (runId: string, after: number) => string = (id, after) => `/ui-api/show/week/${id}?after=${after}`): { run?: WeekRun; error?: ApiError } {
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
        const r = await api<{ run: WeekRun }>("GET", urlOf(runId, version.current));
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
    // urlOf is a pure address builder; a new function each render must not restart the poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, initial]);
  return { run, error };
}

/**
 * Plays a recording through the same screen: each frame at the moment it happened on the day. The offset maps the
 * wall clock onto the recorded one, so countdowns count as they did.
 */
export function useRecording<T extends { startedAt?: string }>(rec: Recording<T> | undefined, playing: boolean, speed = 1): { data?: T; offset: number; done: boolean } {
  const [pos, setPos] = useState<{ rec?: Recording<T>; i: number; offset: number }>({ i: 0, offset: 0 });
  useEffect(() => {
    if (!rec || !playing) return;
    const t0 = Date.now();
    const recordedStart = rec.frames[0]?.data.startedAt ? Date.parse(rec.frames[0].data.startedAt) : t0;
    const tick = () => {
      setPos({ rec, i: frameIndexAt(rec.frames, (Date.now() - t0) * speed), offset: recordedStart - t0 });
    };
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, 200);
    return () => (clearTimeout(first), clearInterval(t));
  }, [rec, playing, speed]);
  if (!rec || !playing || pos.rec !== rec) return { data: rec && playing ? rec.frames[0]?.data : undefined, offset: 0, done: false };
  return { data: rec.frames[pos.i]?.data, offset: pos.offset, done: pos.i >= rec.frames.length - 1 };
}

/** The frame on screen `elapsed` ms into a recording: the last one whose time has come. */
export function frameIndexAt(frames: { t: number }[], elapsed: number): number {
  let i = 0;
  while (i + 1 < frames.length && frames[i + 1].t <= elapsed) i++;
  return i;
}
