"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
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
          <Empty title="No request to trace yet">
            When an agent asks for something, its trace appears here. Try the returning kitchen at <Link className="underline" href="/k/kaari">/k/kaari</Link>.
          </Empty>
        </div>
      ) : (
        <Loading />
      )}
    </>
  );
}
