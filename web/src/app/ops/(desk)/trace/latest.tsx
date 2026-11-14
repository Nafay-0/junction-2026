"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { buttonClass } from "../../../_ui/kit";
import { Empty, LoadError, Loading, PageHead, useOps } from "../../_ui/kit";
import { TRACE_TEXT } from "./trace.text";

export function Latest() {
  const router = useRouter();
  const live = useOps<{ requestId: string | null }>("/ops-api/trace", { pollMs: 3000 });
  const id = live.data?.requestId;
  useEffect(() => {
    if (id) router.replace(`/ops/trace/${id}`);
  }, [id, router]);
  return (
    <>
      <PageHead title={TRACE_TEXT.en.title} purpose={TRACE_TEXT.en.purpose} />
      <LoadError message={live.error} />
      {live.data && !id ? (
        <div className="mt-4">
          <Empty
            title={TRACE_TEXT.en.emptyTitle}
            action={
              <Link className={buttonClass("secondary", "sm")} href="/k/kaari">
                Open Ravintola Kaari&apos;s shop
              </Link>
            }
          >
            {TRACE_TEXT.en.empty}
          </Empty>
        </div>
      ) : (
        <Loading />
      )}
    </>
  );
}
