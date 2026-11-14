import { Target } from "../_ui/target";
import search from "./search-eval.json";
import type { CrashRow } from "./crash";
import type { LandingText } from "./landing.text";

type Row = (typeof search.rows)[number] & { quiet?: boolean; ours?: boolean };
const ROWS = search.rows as Row[];
const TICKS = [0, 25, 50, 75, 100];

/**
 * Right-first per approach, as horizontal bars drawn to scale (0 to 100 %). The solid bar is right first, the pale
 * bar behind it reaches the share with the right product in the top three. Labels are HTML so they wrap and scale at
 * 390 px; each bar is an SVG whose width is the figure itself.
 */
export function SearchChart({ t }: { t: LandingText["search"] }) {
  const rows = ROWS.filter((r) => r.chart);
  return (
    <figure className="lp-chart" aria-labelledby="search-chart-title">
      <figcaption id="search-chart-title" className="display text-[1.15rem] leading-snug text-ink sm:text-[1.25rem]">
        {t.chartTitle(search.requests, search.products.toLocaleString("en-US"))}
      </figcaption>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[0.82rem] text-ink-soft" aria-hidden>
        <span className="inline-flex items-center gap-2">
          <i className="lp-key lp-key-first" /> {t.chartLegendFirst}
        </span>
        <span className="inline-flex items-center gap-2">
          <i className="lp-key lp-key-top3" /> {t.chartLegendTop3}
        </span>
      </div>
      <table className="lp-bars mt-5 w-full">
        <caption className="sr-only">
          {t.chartLegendFirst} and {t.chartLegendTop3.toLowerCase()}, per approach
        </caption>
        <thead className="sr-only">
          <tr>
            <th scope="col">Approach</th>
            <th scope="col">{t.chartLegendFirst}</th>
            <th scope="col">{t.chartLegendTop3}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={r.ours ? "lp-bar-ours" : r.quiet ? "lp-bar-quiet" : ""}>
              <th scope="row" className="lp-bar-label">
                <span className="block font-semibold text-ink">{r.ours ? t.oursLabel : r.label}</span>
                <span className="block text-[0.78rem] font-normal leading-snug text-ink-soft">{r.detail}</span>
              </th>
              <td className="lp-bar-cell">
                <span className="lp-bar-track">
                  <svg viewBox="0 0 100 12" preserveAspectRatio="none" className="lp-bar-svg" aria-hidden>
                    {TICKS.slice(1, -1).map((x) => (
                      <line key={x} x1={x} x2={x} y1={0} y2={12} className="lp-bar-tick" vectorEffect="non-scaling-stroke" />
                    ))}
                    <rect x={0} y={1} width={r.top3} height={10} rx={0} className="lp-bar-top3" />
                    <rect x={0} y={1} width={r.rightFirst} height={10} rx={0} className="lp-bar-first" />
                  </svg>
                  <span className="lp-bar-value tabular">
                    <span className="display block">{r.rightFirst} %</span>
                    <span className="block text-[0.72rem] font-normal text-ink-soft" aria-hidden>
                      top 3: {r.top3} %
                    </span>
                  </span>
                </span>
              </td>
              <td className="sr-only">{r.top3} %</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="lp-axis tabular" aria-hidden>
        {TICKS.map((x) => (
          <span key={x} style={{ left: `${x}%` }}>
            {x}
          </span>
        ))}
      </div>
    </figure>
  );
}

/** The three columns a kitchen would notice, for the same approaches. */
export function SearchTable({ t }: { t: LandingText["search"] }) {
  return (
    <div>
      <h3 className="display text-[1.15rem] text-ink sm:text-[1.25rem]">{t.tableTitle}</h3>
      <div className="lp-scroll mt-4" tabIndex={0} role="region" aria-label={t.tableTitle}>
        <table className="lp-table tabular">
          <thead>
            <tr>
              <th scope="col" className="text-left">
                <span className="sr-only">Approach</span>
              </th>
              <th scope="col" title={t.colsHelp.dropped}>
                {t.cols.dropped}
              </th>
              <th scope="col" title={t.colsHelp.standin}>
                {t.cols.standin}
              </th>
              <th scope="col" title={t.colsHelp.notSold}>
                {t.cols.notSold}
              </th>
            </tr>
          </thead>
          <tbody>
            {ROWS.filter((r) => r.key !== "keyword").map((r) => (
              <tr key={r.key} className={r.ours ? "lp-row-ours" : ""}>
                <th scope="row" className="text-left font-semibold">
                  {r.ours ? t.oursLabel : r.label}
                </th>
                <td>{r.dropped}</td>
                <td>{r.standinAsMatch}</td>
                <td>
                  {r.notSold} of {search.notSoldOf}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="mt-4 space-y-2 text-[0.82rem] leading-snug text-ink-soft">
        {(["dropped", "standin", "notSold"] as const).map((k) => (
          <div key={k}>
            <dt className="inline font-semibold text-ink">{t.cols[k]}: </dt>
            <dd className="inline">{t.colsHelp[k]}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export const searchRow = (key: string) => ROWS.find((r) => r.key === key)!;
export const SEARCH = search;

/**
 * The chain of trust, drawn: five stations on one line (across on a desk, down on a phone), the gate in the middle as
 * the slab with its hazard band. HTML boxes on an SVG-free connector so it reflows; arrows are CSS.
 */
export function TrustChain({ t }: { t: LandingText["security"] }) {
  return (
    <ol className="lp-chain" aria-label={t.diagramLabel}>
      {t.chain.map((c) => (
        <li key={c.name} className={`lp-station ${"gate" in c && c.gate ? "lp-station-gate" : ""}`}>
          <span className="lp-station-mark" aria-hidden>
            {"gate" in c && c.gate ? <Target size={22} tone="safety" /> : <span className="lp-station-dot" />}
          </span>
          <span className="block text-[0.78rem] text-paper/70">{c.who}</span>
          <span className="display mt-1 block text-[1.35rem] text-paper">{c.name}</span>
          <span className="mt-2 block text-[0.9rem] leading-snug text-paper/85">{c.what}</span>
          <span className="lp-std mt-3">{c.std}</span>
        </li>
      ))}
    </ol>
  );
}

/** The crash test's results as a table with a bar per rating, read from summary.json. */
export function CrashTable({ rows, t }: { rows: CrashRow[]; t: LandingText["tested"] }) {
  return (
    <div className="lp-scroll" tabIndex={0} role="region" aria-label={t.crashTableLabel}>
      <table className="lp-table lp-crash tabular">
        <caption className="sr-only">{t.crashTableLabel}</caption>
        <thead>
          <tr>
            <th scope="col" className="text-left">
              {t.cols.agent}
            </th>
            <th scope="col" className="text-left">
              {t.cols.worst}
            </th>
            <th scope="col">{t.cols.rating}</th>
            <th scope="col">{t.cols.licence}</th>
            <th scope="col">{t.cols.unsafe}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.agent} className={r.ours ? "lp-row-ours" : r.scripted ? "lp-row-quiet" : ""}>
              <th scope="row" className="text-left">
                <span className="block font-semibold">{r.name}</span>
                <span className="block text-[0.75rem] font-normal text-ink-soft">{r.ours ? t.ours : r.scripted ? t.scripted : r.maker}</span>
              </th>
              <td className="lp-crash-bar">
                <span className="lp-mini" aria-hidden>
                  <span style={{ width: `${Math.max(0, Math.min(100, r.worst))}%` }} />
                </span>
                <span>{r.worst.toFixed(1)}</span>
              </td>
              <td>{r.rating.toFixed(1)}</td>
              <td>
                <span className={`lp-licence lp-licence-${r.level}`}>
                  {r.level} {r.levelName}
                </span>
              </td>
              <td>{r.unsafe}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
