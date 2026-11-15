import { existsSync } from "node:fs";
import path from "node:path";
import Image from "next/image";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { ArrowRight, Menu, Pause, Play, RotateCcw } from "lucide-react";
import { PilotLight, Wordmark } from "../_ui/wordmark";
import { Target } from "../_ui/target";
import shots from "../_landing/shots.json";
import { ATTACKS, ATTACKS_HELD, COUNTS, CRASH, FRAMES, REEL, RULES, SEARCH, SHOP, STORY, crashRows, searchRow } from "./data";
import { L2, WEBSHOP } from "./landing2.text";
import { AgentMap } from "./map";
import { Motion } from "./motion";
import "./landing2.css";

type Shot = { src: string; w: number; h: number };
const SHOTS = shots as Record<string, Shot>;

const BASE = "relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-semibold leading-tight transition-[background-color,border-color,color] duration-150 active:scale-[0.98] motion-reduce:transition-none";
const GO = `${BASE} bg-lime text-ink hover:bg-lime-hover`;
const SECONDARY = `${BASE} border border-line-strong bg-paper text-ink hover:border-ink-soft hover:bg-mist`;
const SM = "min-h-9 px-4 text-[0.875rem] pointer-coarse:min-h-11";
const LG = "min-h-13 px-6 text-[1.05rem]";
const QUIET = "font-semibold text-petrol underline decoration-petrol/30 underline-offset-4 hover:text-petrol-deep hover:decoration-petrol";

const n = (x: number) => x.toLocaleString("en-US");

/** The webshop section's desktop layers, bottom to top; "slide" is the asked frame's agent panel, sliding in. */
const LAYER = { "shop-1-catalogue": "f1", "shop-2-asked": "f2", slide: "slide", "shop-3-substitute": "f3", "shop-4-signoff": "f4" } as const;

function filmFiles() {
  const dir = path.join(process.cwd(), "public", "landing");
  const has = (f: string) => existsSync(path.join(dir, f));
  return {
    video: has("film.mp4") ? "/landing/film.mp4" : undefined,
    poster: ["film-poster.webp", "film-poster.jpg", "film-poster.png"].find(has),
    captions: has("film.vtt") ? "/landing/film.vtt" : undefined,
  };
}

/** A screenshot with its true size, so nothing shifts while it loads. */
function Shot({ id, alt, sizes, priority, crop, className = "" }: { id: string; alt: string; sizes: string; priority?: boolean; crop?: [number, number]; className?: string }) {
  const s = SHOTS[id] ?? (FRAMES[id] as Shot | undefined);
  if (!s)
    return (
      <div className="l2-missing" role="img" aria-label={alt}>
        {L2.missing}
      </div>
    );
  if (crop) {
    const [x, w] = crop;
    return (
      <div className={`overflow-hidden ${className}`} style={{ aspectRatio: `${Math.round(s.w * w)} / ${s.h}` }}>
        <Image src={s.src} width={s.w} height={s.h} alt={alt} sizes={sizes} unoptimized loading="lazy" className="block h-auto max-w-none" style={{ width: `${100 / w}%`, marginLeft: `${(-100 * x) / w}%` }} />
      </div>
    );
  }
  return <Image src={s.src} width={s.w} height={s.h} alt={alt} sizes={sizes} unoptimized priority={priority} loading={priority ? undefined : "lazy"} className={`block h-auto w-full ${className}`} />;
}

function Phone({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`l2-phone ${className}`}>
      <div className="l2-phone-screen">{children}</div>
    </div>
  );
}

function Browser({ children, url = "aimopilot", className = "" }: { children: ReactNode; url?: string; className?: string }) {
  return (
    <div className={`l2-browser ${className}`}>
      <div className="l2-browser-bar" aria-hidden>
        <span className="l2-dots">
          <i />
          <i />
          <i />
        </span>
        <span className="l2-url">{url}</span>
      </div>
      {children}
    </div>
  );
}

/** A section on the spine: its node lights as it arrives. */
function Section({ id, title, line, children, className = "", wide }: { id: string; title: string; line?: string; children: ReactNode; className?: string; wide?: boolean }) {
  return (
    <section id={id} aria-labelledby={`${id}-t`} className={`l2-section ${wide ? "l2-wide" : ""} ${className}`}>
      <span className="l2-node" data-node aria-hidden />
      <h2 id={`${id}-t`} className="display l2-h2">
        {title}
      </h2>
      {line && <p className="l2-line">{line}</p>}
      <div className="l2-body">{children}</div>
    </section>
  );
}

function More({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="l2-more">
      <summary>{summary}</summary>
      <div className="l2-more-body">{children}</div>
    </details>
  );
}

export function Landing2() {
  const t = L2;
  // The landing page is English for now; the section's Finnish and Swedish words are kept beside it.
  const w = WEBSHOP.en;
  const film = filmFiles();
  const hybrid = searchRow("hybrid");
  const ours = searchRow("ours");
  const bars = ["bm25", "knn", "hybrid", "ours"].map(searchRow);
  const theirs = ["bm25", "knn", "hybrid"].map(searchRow);
  const crash = crashRows();
  const models = crash.filter((r) => !r.scripted);
  const poster = "r08-gate";

  const facts = [
    {
      big: `${ours.rightFirst} % right first.`,
      sub: `Standard hybrid search: ${hybrid.rightFirst} %. On ${SEARCH.requests} real-style requests over ${n(SEARCH.products)} products.`,
      href: "/docs/smart-search",
      link: "How we measured",
    },
    {
      big: `${ATTACKS.length} attacks on the gate. ${ATTACKS_HELD} held.`,
      sub: `${ATTACKS.slice(0, 4)
        .map((a, i) => (i ? a.title.charAt(0).toLowerCase() + a.title.slice(1) : a.title))
        .join(", ")}: each stopped by plain code, with the rule's name.`,
      href: "#gate",
      link: "See the gate",
    },
    {
      big: "Beyond the mandate, a person signs.",
      sub: "A named person's passkey on their own phone, bound to that exact order. No agent, tool or link can sign.",
      href: "/docs/assumptions",
      link: "Who holds which key",
    },
    {
      big: "One record, read from both sides.",
      sub: "Every order is one hash-chained ledger: the kitchen reads all of it, the wholesaler reads it without the kitchen's private memory.",
      href: "/docs/connect-an-agent",
      link: "The audit trail",
    },
  ];

  return (
    <div className="l2 min-h-dvh bg-mist text-ink">
      <Motion />
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-paper focus:px-4 focus:py-2 focus:shadow-md">
        {t.skip}
      </a>
      <p className="on-dark bg-petrol-deep px-4 py-1.5 text-center text-[0.75rem] leading-snug text-paper/85">{t.demoNote}</p>

      <header className="l2-header" data-header>
        <div className="l2-header-in">
          <Link href="/" aria-label="AimoPilot, home" className="l2-mark shrink-0">
            <Wordmark size={28} />
          </Link>
          <nav aria-label="Main" className="ml-4 hidden items-center gap-5 text-[0.9rem] xl:flex">
            <Link href="/ops" className="font-medium text-ink-soft hover:text-petrol">
              {t.nav.wholesaler}
            </Link>
            <Link href="/try" className="font-medium text-ink-soft hover:text-petrol">
              {t.nav.connect}
            </Link>
            <Link href="/wall" className="font-medium text-ink-soft hover:text-petrol">
              {t.nav.live}
            </Link>
            <Link href="/docs" className="font-medium text-ink-soft hover:text-petrol">
              {t.nav.docs}
            </Link>
          </nav>
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <Link href="/k" className="hidden min-h-9 items-center px-2 text-[0.9rem] font-semibold text-petrol hover:text-petrol-deep md:inline-flex">
              {t.nav.login}
            </Link>
            <span className="hidden md:inline-flex">
              <Link href="/k/signup" className={`${SECONDARY} ${SM}`}>
                {t.nav.signup}
              </Link>
            </span>
            <Link href="/k" className={`${GO} ${SM}`}>
              {t.nav.talk}
            </Link>
            <details className="l2-menu xl:hidden">
              <summary aria-label={t.nav.more} className="l2-menu-button">
                <Menu size={20} aria-hidden />
              </summary>
              <div className="l2-menu-sheet">
                <Link href="/k" className="md:hidden">
                  {t.nav.login}
                </Link>
                <Link href="/k/signup" className="md:hidden">
                  {t.nav.signup}
                </Link>
                <Link href="/ops">{t.nav.wholesaler}</Link>
                <Link href="/try">{t.nav.connect}</Link>
                <Link href="/wall">{t.nav.live}</Link>
                <Link href="/docs">{t.nav.docs}</Link>
              </div>
            </details>
          </div>
        </div>
      </header>

      <main id="main" className="l2-main">
        <span className="l2-spine" aria-hidden>
          <span className="l2-spine-fill" data-spine />
        </span>

        {/* Hero: the product performing itself */}
        <section aria-labelledby="hero-t" className="l2-section l2-hero">
          <span className="l2-node l2-node-pilot" aria-hidden>
            <PilotLight size={20} />
          </span>
          <div className="l2-hero-grid">
            <div>
              <h1 id="hero-t" className="display l2-h1">
                {t.hero.title}
              </h1>
              <p className="l2-hero-line">{t.hero.line}</p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link href="/k" className={`${GO} ${LG}`}>
                  {t.nav.talk} <ArrowRight size={18} aria-hidden />
                </Link>
                <Link href="/k/signup" className={`${SECONDARY} ${LG}`}>
                  {t.nav.signup}
                </Link>
              </div>
              <p className="mt-6 text-[0.88rem] text-ink-soft">
                {t.hero.built}{" "}
                <Link href="/wall" className={QUIET}>
                  {t.nav.live}
                </Link>
              </p>
            </div>
            <figure className="l2-reel" data-reel aria-label={t.hero.reelLabel}>
              <Phone className="l2-reel-phone">
                <div className="l2-reel-frames">
                  {REEL.map((f, i) => (
                    <Image
                      key={f.key}
                      src={f.src}
                      width={f.w}
                      height={f.h}
                      alt={f.key === poster ? f.caption : ""}
                      aria-hidden={f.key === poster ? undefined : true}
                      sizes="(min-width: 1024px) 320px, 62vw"
                      unoptimized
                      priority={f.key === poster || i === 0}
                      data-frame={i}
                      data-poster={f.key === poster ? "" : undefined}
                      data-caption={f.caption}
                      className="l2-reel-frame"
                    />
                  ))}
                </div>
              </Phone>
              <figcaption className="l2-reel-bar">
                <span className="l2-reel-progress" aria-hidden>
                  {REEL.map((f) => (
                    <i key={f.key} />
                  ))}
                </span>
                <span className="l2-reel-controls">
                  <button type="button" className="l2-icon" data-reel-toggle aria-label={t.hero.pause} data-label-play={t.hero.play} data-label-pause={t.hero.pause}>
                    <Pause size={16} aria-hidden className="l2-i-pause" />
                    <Play size={16} aria-hidden className="l2-i-play" />
                  </button>
                  <button type="button" className="l2-icon" data-reel-replay aria-label={t.hero.replay}>
                    <RotateCcw size={16} aria-hidden />
                  </button>
                </span>
                <span className="l2-reel-caption" aria-hidden data-reel-caption>
                  {FRAMES[poster]?.caption}
                </span>
              </figcaption>
              <ol className="sr-only">
                {REEL.map((f) => (
                  <li key={f.key}>{f.caption}</li>
                ))}
              </ol>
            </figure>
          </div>
        </section>

        {/* The four facts, one at a time */}
        <section aria-label={t.facts.label} className="l2-section l2-facts" data-facts>
          <span className="l2-node" data-node aria-hidden />
          <div className="l2-facts-bar" aria-hidden>
            {facts.map((f) => (
              <i key={f.big} />
            ))}
          </div>
          <ul className="l2-facts-list">
            {facts.map((f, i) => (
              <li key={f.big} className="l2-fact" data-fact={i}>
                <p className="display l2-fact-big">{f.big}</p>
                <p className="l2-fact-sub">
                  {f.sub}{" "}
                  <Link href={f.href} className={`${QUIET} whitespace-nowrap`}>
                    {f.link}
                  </Link>
                </p>
              </li>
            ))}
          </ul>
          <button type="button" className="l2-icon l2-facts-toggle" data-facts-toggle aria-label={t.facts.pause} data-label-play={t.facts.play} data-label-pause={t.facts.pause}>
            <Pause size={16} aria-hidden className="l2-i-pause" />
            <Play size={16} aria-hidden className="l2-i-play" />
          </button>
        </section>

        {/* The main act: the agent at work, driven by the scroll */}
        <Section id="story" title={t.story.title} line={t.story.line} wide>
          <div className="l2-story" data-story>
            <ol className="l2-steps">
              {STORY.map((st, i) => (
                <li key={i} className={`l2-step l2-who-${st.who}`} data-step={i}>
                  <span className="l2-step-node" aria-hidden />
                  <p className="l2-kicker">{st.kicker}</p>
                  <p className={`l2-step-head ${st.who === "buyer" ? "l2-buyer" : ""}`}>{st.head}</p>
                  {st.rest && <p className="l2-step-rest">{st.rest}</p>}
                  {st.extra && <p className="l2-step-extra">{st.extra}</p>}
                  <div className="l2-step-shot">
                    <Phone>
                      <Shot id={st.frame} alt={FRAMES[st.frame]?.caption ?? st.kicker} sizes="200px" />
                    </Phone>
                  </div>
                </li>
              ))}
            </ol>
            <div className="l2-stage" aria-hidden>
              <div className="l2-stage-in">
                <Phone className="l2-stage-phone">
                  <div className="l2-reel-frames">
                    {STORY.map((st, i) => (
                      <Image key={i} src={FRAMES[st.frame]?.src ?? ""} width={600} height={1299} alt="" sizes="(min-width: 1024px) 300px, 44vw" unoptimized loading="lazy" className="l2-stage-frame" data-stage-frame={i} />
                    ))}
                  </div>
                </Phone>
                <dl className="l2-counters">
                  <div>
                    <dt>{t.story.counters.priced}</dt>
                    <dd>
                      <span className="display tabular" data-counter="priced" data-to={COUNTS.priced} data-at={STORY.findIndex((x) => x.counter === "priced")}>
                        {COUNTS.priced}
                      </span>{" "}
                      <span className="l2-of">{t.story.counters.of(n(COUNTS.products))}</span>
                    </dd>
                  </div>
                  <div>
                    <dt>{t.story.counters.rules}</dt>
                    <dd>
                      <span className="display tabular" data-counter="rules" data-to={COUNTS.rules} data-at={STORY.findIndex((x) => x.counter === "rules")}>
                        {COUNTS.rules}
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt>{t.story.counters.model}</dt>
                    <dd>
                      <span className="display tabular">0</span>
                    </dd>
                  </div>
                </dl>
              </div>
            </div>
          </div>
        </Section>

        {/* The agent inside the shop the kitchen already uses: real captures, cross-faded by the scroll. The heading sits
            in the sticky part, so it stays in view with the stage while the scroll plays it. */}
        <section id="webshop" aria-labelledby="webshop-t" className="l2-section l2-shop">
          <span className="l2-node" data-node aria-hidden />
          <div className="l2-shop-track" data-shop-track>
            <div className="l2-shop-sticky">
              <h2 id="webshop-t" className="display l2-h2 l2-shop-h2">
                {w.title}
              </h2>
              <p className="l2-line l2-shop-line">{w.line}</p>
              <figure className="l2-shop-stage" aria-label={w.label}>
                <div className="l2-shop-deskwrap">
                  <Browser url="aimopilot / k / hotel-lumo / catalogue" className="l2-shop-desk">
                    <div className="l2-shop-frames">
                      {(["shop-1-catalogue", "shop-2-asked", "slide", "shop-3-substitute", "shop-4-signoff"] as const).map((k) => {
                        const f = SHOP[k === "slide" ? "shop-2-asked" : k];
                        const rest = k === "shop-4-signoff";
                        return (
                          <Image
                            key={k}
                            src={f.src}
                            width={f.w}
                            height={f.h}
                            alt={rest ? w.deskAlt : ""}
                            aria-hidden={rest ? undefined : true}
                            sizes="(min-width: 1200px) 960px, 86vw"
                            unoptimized
                            loading="lazy"
                            className={`l2-shop-f l2-shop-${LAYER[k]}`}
                          />
                        );
                      })}
                    </div>
                  </Browser>
                  <div className="l2-shop-phone">
                    <Phone>
                      <div className="l2-shop-pframes">
                        <Image src={SHOP["shop-phone-substitute"].src} width={SHOP["shop-phone-substitute"].w} height={SHOP["shop-phone-substitute"].h} alt={w.phoneAlt} sizes="(min-width: 1200px) 230px, 30vw" unoptimized loading="lazy" className="l2-shop-p l2-shop-p1" />
                        <Image src={SHOP["shop-phone-signoff"].src} width={SHOP["shop-phone-signoff"].w} height={SHOP["shop-phone-signoff"].h} alt="" aria-hidden sizes="(min-width: 1200px) 230px, 30vw" unoptimized loading="lazy" className="l2-shop-p l2-shop-p2" />
                      </div>
                    </Phone>
                  </div>
                </div>
              </figure>
              <ol className="l2-shop-steps">
                {w.steps.map((s, i) => (
                  <li key={s} style={{ "--at": [0, 14, 53, 77][i] } as CSSProperties}>
                    <span className="l2-shop-n tabular" aria-hidden>
                      {i + 1}
                    </span>
                    {s}
                  </li>
                ))}
              </ol>
            </div>
          </div>
          <div className="l2-shop-side">
            <ul className="l2-shop-points">
              {w.points.map((p) => (
                <li key={p.head}>
                  <p className="l2-shop-head">{p.head}</p>
                  <p className="l2-shop-text">{p.text}</p>
                </li>
              ))}
            </ul>
            <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-3">
              <Link href="/k" className={`${GO} ${LG}`}>
                {w.cta} <ArrowRight size={18} aria-hidden />
              </Link>
              <Link href="/try" className={`${QUIET} text-[0.92rem]`}>
                {w.connect}
              </Link>
            </div>
            <p className="l2-shop-note">{w.note}</p>
          </div>
        </section>

        {/* The comparison that feels like winning */}
        <Section id="search" title={t.search.title} line={t.search.line}>
          <div className="l2-race" data-race>
            <ol className="l2-bars">
              {bars.map((r, i) => (
                <li key={r.key} className={`l2-bar ${"ours" in r && r.ours ? "l2-bar-ours" : ""}`} style={{ "--v": r.rightFirst / 100, "--i": i } as CSSProperties}>
                  <span className="l2-bar-name">{"ours" in r && r.ours ? t.search.oursLabel : r.label}</span>
                  <span className="l2-bar-track">
                    <span className="l2-bar-fill" />
                  </span>
                  <span className="l2-bar-val display tabular">
                    <span data-count-to={r.rightFirst}>{r.rightFirst}</span>&nbsp;%
                  </span>
                </li>
              ))}
            </ol>
            <p className="l2-race-note">{t.search.rightFirst}</p>
            <div className="l2-flips">
              {(
                [
                  ["dropped", (r: typeof ours) => `${r.dropped}`],
                  ["standin", (r: typeof ours) => `${r.standinAsMatch}`],
                  ["notSold", (r: typeof ours) => `${r.notSold} of ${SEARCH.notSoldOf}`],
                ] as const
              ).map(([k, f], i) => (
                <div key={k} className="l2-flip" style={{ "--i": i } as CSSProperties}>
                  <p className="l2-flip-name">{t.search.counters[k]}</p>
                  <p className="display l2-flip-ours tabular">{f(ours)}</p>
                  <p className="l2-flip-theirs tabular">
                    {t.search.theirs}: {theirs.map((r) => f(r)).join(" · ")}
                  </p>
                </div>
              ))}
            </div>
          </div>
          <More summary={t.search.more}>
            <div className="l2-scroll" tabIndex={0} role="region" aria-label={t.search.more}>
              <table className="l2-table tabular">
                <thead>
                  <tr>
                    <th scope="col" className="text-left">
                      Approach
                    </th>
                    <th scope="col">Right first</th>
                    <th scope="col">In top 3</th>
                    <th scope="col">{t.search.counters.dropped}</th>
                    <th scope="col">{t.search.counters.standin}</th>
                    <th scope="col">{t.search.counters.notSold}</th>
                  </tr>
                </thead>
                <tbody>
                  {SEARCH.rows.map((r) => (
                    <tr key={r.key} className={"ours" in r && r.ours ? "l2-row-ours" : ""}>
                      <th scope="row" className="text-left">
                        {r.label}
                        <span className="block text-[0.75rem] font-normal text-ink-soft">{r.detail}</span>
                      </th>
                      <td>{r.rightFirst} %</td>
                      <td>{r.top3} %</td>
                      <td>{r.dropped}</td>
                      <td>{r.standinAsMatch}</td>
                      <td>
                        {r.notSold} of {SEARCH.notSoldOf}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-[0.88rem]">
              <Link href={SEARCH.source} className={QUIET}>
                How we measured
              </Link>
            </p>
          </More>

          <div className="l2-crash" data-crash>
            <h3 className="display l2-h3">{t.crash.title}</h3>
            <p className="l2-line">{t.crash.line(CRASH.scenarios)}</p>
            <ol className="l2-crash-rows">
              {models.map((r, i) => (
                <li key={r.agent} className={r.ours ? "l2-crash-ours" : ""} style={{ "--v": Math.max(0, r.worst) / 100, "--i": i } as CSSProperties}>
                  <span className="l2-crash-name">
                    {r.name}
                    {r.ours && <span className="l2-crash-tag">{t.crash.ours}</span>}
                  </span>
                  <span className="l2-bar-track">
                    <span className="l2-bar-fill" />
                  </span>
                  <span className="l2-crash-val tabular">{r.worst.toFixed(1)}</span>
                  <span className={`l2-licence l2-licence-${r.level}`}>{r.level}</span>
                </li>
              ))}
            </ol>
            <p className="l2-race-note">{t.crash.worst}</p>
            <More summary={t.crash.more}>
              <div className="l2-scroll" tabIndex={0} role="region" aria-label={t.crash.more}>
                <table className="l2-table tabular">
                  <thead>
                    <tr>
                      <th scope="col" className="text-left">
                        Agent
                      </th>
                      <th scope="col">Worst run</th>
                      <th scope="col">Rating</th>
                      <th scope="col">Licence</th>
                      <th scope="col">Unsafe attempts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {crash.map((r) => (
                      <tr key={r.agent} className={r.ours ? "l2-row-ours" : ""}>
                        <th scope="row" className="text-left">
                          {r.name}
                          <span className="block text-[0.75rem] font-normal text-ink-soft">{r.ours ? t.crash.ours : r.scripted ? "scripted baseline" : r.maker}</span>
                        </th>
                        <td>{r.worst.toFixed(1)}</td>
                        <td>{r.rating.toFixed(1)}</td>
                        <td>
                          {r.level} {r.levelName}
                        </td>
                        <td>{r.unsafe}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-[0.88rem]">
                <Link href="/docs/crash-test" className={QUIET}>
                  The crash-test leaderboard
                </Link>
              </p>
            </More>
          </div>
        </Section>

        {/* The gate: an order travelling, one attack bouncing */}
        <section id="gate" aria-labelledby="gate-t" className="l2-section">
          <div className="l2-gate on-dark">
            <span className="l2-node l2-node-gate" aria-hidden>
              <Target size={22} tone="safety" />
            </span>
            <h2 id="gate-t" className="display l2-h2 text-paper">
              {t.gate.title}
            </h2>
            <p className="l2-line text-paper/80">{t.gate.line(RULES.length)}</p>
            <div className="l2-run" data-run aria-hidden>
              <div className="l2-run-rail">
                <span className="l2-run-fill" />
                <span className="l2-token">
                  <i />
                </span>
                <span className="l2-attack">
                  <i />
                  <span className="l2-attack-label">
                    {t.gate.attack}: <code>quote_replay</code>
                  </span>
                </span>
              </div>
            </div>
            <ol className="l2-stations">
              {t.gate.stations.map((s, i) => (
                <li key={s.name} className={i === 2 ? "l2-station-gate" : ""}>
                  <span className="display text-[1.25rem] text-paper">{s.name}</span>
                  <span className="block text-[0.82rem] text-paper/70">{s.who}</span>
                </li>
              ))}
            </ol>
            <div className="mt-10 grid gap-3">
              <More summary={t.gate.attacksTitle(ATTACKS.length, ATTACKS_HELD)}>
                <ul className="l2-attacks">
                  {ATTACKS.map((a) => (
                    <li key={a.id}>
                      <span className="text-paper">{a.title}</span>
                      <span className="text-paper/70">
                        {" "}
                        {t.gate.howHeld[a.how as keyof typeof t.gate.howHeld] ?? a.how}
                        {a.rule ? ": " : ""}
                        {a.rule && <code>{a.rule}</code>}
                      </span>
                    </li>
                  ))}
                </ul>
              </More>
              <More summary={t.gate.rulesTitle(RULES.length)}>
                <ul className="l2-rules">
                  {RULES.map((r) => (
                    <li key={r}>
                      <code>{r}</code>
                    </li>
                  ))}
                </ul>
              </More>
            </div>
            <p className="mt-8 text-[0.85rem] text-paper/70">{t.gate.standards}</p>
          </div>
        </section>

        {/* How they connect: one picture, built up by the scroll */}
        <Section id="map" title={t.agents.title}>
          <AgentMap />
        </Section>

        {/* Six agents on a horizontal track that the vertical scroll drives */}
        <section id="agents" aria-labelledby="agents-t" className="l2-agents" data-track style={{ "--n": t.agents.list.length } as CSSProperties}>
          <div className="l2-agents-sticky">
            <div className="l2-agents-head">
              <span className="l2-node" data-node aria-hidden />
              <h2 id="agents-t" className="display l2-h2">
                {t.agents.trackTitle}
              </h2>
              <p className="l2-line">{t.agents.line}</p>
            </div>
            <div className="l2-track-window">
              <ol className="l2-track" data-track-inner>
                {t.agents.list.map((a, i) => (
                  <li key={a.id} className="l2-slide">
                    <div className={`l2-slide-shot l2-slide-${a.kind}`}>
                      {a.kind === "phone" ? (
                        <Phone>
                          <Shot id={a.shot} alt={a.alt} sizes="260px" />
                        </Phone>
                      ) : (
                        <Browser>
                          <Shot id={a.shot} alt={a.alt} sizes="(min-width: 1024px) 560px, 80vw" crop={a.kind === "crop" ? [0.27, 0.47] : undefined} />
                        </Browser>
                      )}
                    </div>
                    <div className="l2-slide-copy">
                      <p className="l2-slide-no tabular" aria-hidden>
                        {String(i + 1).padStart(2, "0")} / {String(t.agents.list.length).padStart(2, "0")}
                      </p>
                      <h3 className="display l2-h3">{a.name}</h3>
                      <p className="l2-slide-fact">{a.fact}</p>
                      <Link href={a.href} className={`${QUIET} text-[0.9rem]`}>
                        Where this comes from
                      </Link>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* One product, every screen: the phone opens into the desk */}
        <Section id="screens" title={t.screens.title} line={t.screens.line}>
          <div className="l2-morphs">
            {t.screens.pairs.map((p) => (
              <figure key={p.name} className="l2-morph" data-morph>
                <figcaption className="l2-morph-name">{p.name}</figcaption>
                <div className="l2-morph-stage">
                  <Browser className="l2-morph-desk">
                    <Shot id={p.desktop} alt={p.alt} sizes="(min-width: 1024px) 900px, 92vw" />
                  </Browser>
                  <div className="l2-morph-phone">
                    <Phone>
                      <Shot id={p.phone} alt="" sizes="(min-width: 1024px) 240px, 30vw" />
                    </Phone>
                  </div>
                </div>
              </figure>
            ))}
          </div>
        </Section>

        <Section id="business" title={t.business.title} line={t.business.line}>
          <div className="l2-biz" data-reveal>
            <Browser url="aimopilot / ops / safeguards">
              <Shot id="ops-safeguards" alt={t.business.alt} sizes="(min-width: 1024px) 760px, 92vw" />
            </Browser>
            <ul className="l2-ticks">
              {t.business.items.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </div>
          <More summary={t.business.aivenTitle}>
            <dl className="l2-aiven">
              {t.business.aiven.map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </More>
        </Section>

        <Section id="mail" title={t.mail.title} line={t.mail.line}>
          <div className="l2-mails" data-reveal>
            <figure className="l2-mail">
              <Shot id="mail-receipt" alt={t.mail.receipt} sizes="(min-width: 1024px) 420px, 90vw" />
            </figure>
            <figure className="l2-mail">
              <Shot id="mail-changed" alt={t.mail.changed} sizes="(min-width: 1024px) 420px, 90vw" />
            </figure>
          </div>
        </Section>

        <Section id="film" title={t.film.title}>
          <div className="l2-film">
            {film.video ? (
              <video controls preload="none" playsInline poster={film.poster ? `/landing/${film.poster}` : undefined} className="h-full w-full" aria-label={t.film.label}>
                <source src={film.video} type="video/mp4" />
                {/* Captions are offered, not switched on: the film carries its own words on screen. */}
                {film.captions && <track kind="captions" src={film.captions} srcLang="en" label="Captions" />}
              </video>
            ) : (
              <div className="l2-poster" role="img" aria-label={`${t.film.label}. ${t.film.note}`}>
                <Wordmark tone="paper" size={30} />
                <p className="text-paper/80">{t.film.note}</p>
              </div>
            )}
          </div>
          <p className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
            <a href={t.film.moreHref} target="_blank" rel="noreferrer" className={QUIET}>
              {t.film.more}
            </a>
            <a href={t.film.filmHref} target="_blank" rel="noreferrer" className={QUIET}>
              {t.film.onYouTube}
            </a>
          </p>
        </Section>

        <Section id="honest" title={t.honest.title} line={t.honest.line}>
          <p className="flex flex-wrap gap-x-6 gap-y-2">
            <Link href="/docs/assumptions" className={QUIET}>
              {t.honest.more}
            </Link>
            <Link href="/docs" className={QUIET}>
              {t.nav.docs}
            </Link>
          </p>
        </Section>

        <section aria-labelledby="end-t" className="l2-section l2-end">
          <span className="l2-node" data-node aria-hidden />
          <h2 id="end-t" className="display l2-h2">
            {t.end.title}
          </h2>
          <p className="l2-line">{t.end.line}</p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="/k" className={`${GO} ${LG}`}>
              {t.nav.talk} <ArrowRight size={18} aria-hidden />
            </Link>
            <Link href="/k/signup" className={`${SECONDARY} ${LG}`}>
              {t.nav.signup}
            </Link>
            <Link href="/k" className={`${QUIET} ml-2`}>
              {t.nav.login}
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-line bg-paper">
        <div className="mx-auto flex max-w-[1280px] flex-col gap-6 px-4 py-10 sm:px-8 md:flex-row md:items-center md:justify-between">
          <div>
            <Wordmark size={26} />
            <p className="mt-3 max-w-[34rem] text-[0.85rem] leading-snug text-ink-soft">{t.demoNote}</p>
            <p className="mt-1 text-[0.85rem] text-ink-soft">Junction 2026</p>
          </div>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-3 text-[0.9rem]">
            <Link href="/ops" className={QUIET}>
              {t.nav.wholesaler}
            </Link>
            <Link href="/try" className={QUIET}>
              {t.nav.connect}
            </Link>
            <Link href="/wall" className={QUIET}>
              {t.nav.live}
            </Link>
            <Link href="/docs" className={QUIET}>
              {t.nav.docs}
            </Link>
            <Link href="/landing/classic" className={QUIET}>
              {t.nav.classic}
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
