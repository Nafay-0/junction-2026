/**
 * Build the shared runtime when the server starts, not on the first request: on a deployed server that is when
 * the catalogue index is fetched from PostgreSQL (a second or two), and a failure shows in the start-up log.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getRuntime } = await import("./server/runtime");
  const t0 = Date.now();
  getRuntime().then(
    (rt) => {
      console.log(JSON.stringify({ level: "info", at: new Date().toISOString(), component: "startup", msg: "runtime ready", catalog: rt.catalogSource.kind, ms: Date.now() - t0 }));
      // The sample activity (server/alive): played in the background when the store is empty of recent activity.
      void import("./server/alive/start").then((m) => m.startSampleActivity(rt)).catch((err) => console.error(JSON.stringify({ level: "error", component: "sample", msg: String(err) })));
    },
    (err) => console.error(JSON.stringify({ level: "error", at: new Date().toISOString(), component: "startup", msg: "runtime failed to start", error: String(err) })),
  );
}
