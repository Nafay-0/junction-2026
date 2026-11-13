/**
 * What CI recorded about this build, as a small JSON the app serves at /build-record.json (web/public/).
 *
 *   pnpm build:record [--out public/build-record.json] [--gate crash-gate.json] [--sbom sbom.cdx.json]
 *                     [--trace network-trace.json] [--job-id <GitHub job id>]
 *
 * Without --job-id it finds this job's id through the GitHub API (GITHUB_TOKEN, matched by RUNNER_NAME).
 *
 * In GitHub Actions on a CRACI runner it names the commit, the workflow run and job, and where CRACI publishes that
 * job's CycloneDX SBOM and network trace (the CRACI API, docs.craci.com/api/reference: GET /v1preview1/sbom and
 * /v1preview1/network-trace with provider=github, repo, job_id; a CRACI API token is needed to read them, and they
 * exist once the job has finished). When the SBOM or trace was fetched (by a later job, with the token) it adds what
 * they contain: component count, the top-level components, the hosts the build reached. Outside CI it says so.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const opt = (n: string) => (argv.indexOf(`--${n}`) >= 0 ? argv[argv.indexOf(`--${n}`) + 1] : undefined);
const e = process.env;
const read = (f?: string) => (f && existsSync(f) ? readFileSync(f, "utf8") : undefined);

const repo = e.GITHUB_REPOSITORY;

/** This job's GitHub job id (the CRACI API's job_id): from --job-id, else the run's jobs list, matched by runner name. */
async function ownJobId(): Promise<string | undefined> {
  if (opt("job-id")) return opt("job-id");
  if (e.GITHUB_ACTIONS !== "true" || !e.GITHUB_TOKEN || !repo) return undefined;
  try {
    const r = await fetch(`${e.GITHUB_API_URL ?? "https://api.github.com"}/repos/${repo}/actions/runs/${e.GITHUB_RUN_ID}/attempts/${e.GITHUB_RUN_ATTEMPT ?? 1}/jobs?per_page=100`, { headers: { authorization: `Bearer ${e.GITHUB_TOKEN}`, accept: "application/vnd.github+json" } });
    const j = (await r.json()) as { jobs?: { id: number; runner_name?: string | null; status: string }[] };
    return String(j.jobs?.find((x) => x.runner_name === e.RUNNER_NAME && x.status !== "completed")?.id ?? "") || undefined;
  } catch {
    return undefined;
  }
}
const jobId = await ownJobId();
const api = (what: "sbom" | "network-trace") => (repo && jobId ? `https://api.craci.com/v1preview1/${what}?provider=github&repo=${encodeURIComponent(repo)}&job_id=${jobId}` : null);

function sbomSummary(text?: string) {
  if (!text) return null;
  try {
    const s = JSON.parse(text) as { specVersion?: string; components?: { name?: string; version?: string; type?: string; purl?: string }[]; metadata?: { timestamp?: string } };
    const comps = s.components ?? [];
    const byType: Record<string, number> = {};
    for (const c of comps) byType[c.type ?? "unknown"] = (byType[c.type ?? "unknown"] ?? 0) + 1;
    return {
      format: `CycloneDX ${s.specVersion ?? ""}`.trim(),
      sha256: createHash("sha256").update(text).digest("hex"),
      components: comps.length,
      byType,
      sample: comps.slice(0, 15).map((c) => c.purl ?? `${c.name}@${c.version}`),
      recordedAt: s.metadata?.timestamp ?? null,
    };
  } catch {
    return { error: "the SBOM was not valid JSON" };
  }
}

function traceSummary(text?: string) {
  if (!text) return null;
  try {
    const t = JSON.parse(text) as { observations?: { protocol?: string; host?: string; serverName?: string; url?: string; query?: string; decision?: string }[] };
    const obs = t.observations ?? [];
    const hosts = new Set<string>();
    for (const o of obs) {
      const h = o.host ?? o.serverName ?? o.query ?? (o.url ? (() => { try { return new URL(o.url!).host; } catch { return undefined; } })() : undefined);
      if (h) hosts.add(h);
    }
    return { observations: obs.length, hosts: [...hosts].sort().slice(0, 40) };
  } catch {
    return { error: "the network trace was not valid JSON" };
  }
}

const inCi = e.GITHUB_ACTIONS === "true";
const gate = read(opt("gate"));
const record = {
  schema: "dock-build-record/1",
  builtAt: new Date().toISOString(),
  source: inCi ? "github-actions" : "local",
  repository: repo ?? null,
  commit: e.GITHUB_SHA ?? null,
  ref: e.GITHUB_REF_NAME ?? null,
  run: inCi ? { id: e.GITHUB_RUN_ID, attempt: Number(e.GITHUB_RUN_ATTEMPT ?? 1), workflow: e.GITHUB_WORKFLOW, url: `${e.GITHUB_SERVER_URL}/${repo}/actions/runs/${e.GITHUB_RUN_ID}` } : null,
  runner: inCi ? { name: e.RUNNER_NAME ?? null, os: e.RUNNER_OS ?? null, label: "craci" } : null,
  craci: {
    jobId: jobId ?? null,
    sbom: { location: api("sbom"), format: "CycloneDX 1.7 (application/vnd.cyclonedx+json)", needs: "a CRACI API token (organisation admin: Settings > API tokens); available once the job is finished", fetched: sbomSummary(read(opt("sbom"))) },
    networkTrace: { location: api("network-trace"), fetched: traceSummary(read(opt("trace"))) },
    docs: "https://docs.craci.com/api/reference/",
  },
  crashGate: gate ? JSON.parse(gate) : null,
  note: inCi ? undefined : "Built outside CI: no CRACI record exists for this build.",
};
const out = opt("out") ?? path.join("public", "build-record.json");
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(record, null, 2) + "\n");
console.log(`Build record: ${out}${record.craci.sbom.location ? ` (SBOM at ${record.craci.sbom.location}${record.craci.sbom.fetched ? ", fetched" : ""})` : ""}`);
