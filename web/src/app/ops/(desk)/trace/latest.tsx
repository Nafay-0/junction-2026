"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { buttonClass } from "../../../_ui/kit";
import { Empty, LoadError, Loading, PageHead, useOps } from "../../_ui/kit";

export function Latest() {
  const router = useRouter();
  const live = useOps<{ requestId: string | null }>("/ops-api/trace", { pollMs: 3000 });
  const id = live.data?.requestId;
  useEffect(() => {
    if (id) router.replace(`/ops/trace/${id}`);
  }, [id, router]);
  return (
    <>
      <PageHead title="Trace" purpose="Any request as a path through the gate, step by step, replayable." />
      <LoadError message={live.error} />
      {live.data && !id ? (
        <div className="mt-4">
          <Empty
            title="No request to trace yet"
            action={
              <Link className={buttonClass("secondary", "sm")} href="/k/kaari">
                Open Ravintola Kaari&apos;s shop
              </Link>
            }
          >
            When an agent asks for something, its trace appears here, station by station. The returning kitchen at /k/kaari is the quickest way to make one.
          </Empty>
        </div>
      ) : (
        <Loading />
      )}
    </>
  );
}
