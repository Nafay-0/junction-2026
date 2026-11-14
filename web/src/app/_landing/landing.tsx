import { existsSync } from "node:fs";
import path from "node:path";
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, ArrowUpRight, Menu } from "lucide-react";
import { RULES } from "@/core/policy";
import { PilotLight, Wordmark } from "../_ui/wordmark";
import { Target } from "../_ui/target";
import { CrashTable, SEARCH, SearchChart, SearchTable, TrustChain, searchRow } from "./charts";
import { CRASH, crashRows } from "./crash";
import { Browser, Duo, Mail, Phone } from "./frames";
import { LANDING_TEXT, type Source } from "./landing.text";
import "./landing.css";

/** The number of browser tests (`playwright test --list`), counted when the page was last changed. */
const BROWSER_TESTS = 370;

const LINK_BASE =
  "relative inline-flex items-center justify-center gap-2 rounded-full font-semibold leading-tight transition-[background-color,border-color,color] duration-150 active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100";
const GO = `${LINK_BASE} bg-lime text-ink shadow-xs hover:bg-lime-hover`;
const SECONDARY = `${LINK_BASE} border border-line-strong bg-paper text-ink hover:border-ink-soft hover:bg-mist`;
const SIZE = { sm: "min-h-9 px-4 text-[0.875rem] pointer-coarse:min-h-11", md: "min-h-11 px-5 text-[0.95rem]", lg: "min-h-13 px-6 text-[1.05rem]" };
const QUIET = "font-semibold text-petrol underline decoration-petrol/30 underline-offset-4 hover:text-petrol-deep hover:decoration-petrol";

/** Is the film there yet? Checked when the page is built: drop public/landing/film.mp4 (and a poster) and rebuild. */
function film() {
  const dir = path.join(process.cwd(), "public", "landing");
  const has = (f: string) => existsSync(path.join(dir, f));
  const video = has("film.mp4") ? "/landing/film.mp4" : undefined;
  const poster = ["film-poster.webp", "film-poster.jpg", "film-poster.png"].find(has);
  const captions = has("film.vtt") ? "/landing/film.vtt" : undefined;
  return { video, poster: poster ? `/landing/${poster}` : undefined, captions };
}

export function Landing() {
  const t = LANDING_TEXT.en;
  const f = film();
  const crash = crashRows();
  const hybrid = searchRow("hybrid");
  const rules = searchRow("hybrid_rules");
  const ours = searchRow("ours");
  const products = SEARCH.products.toLocaleString("en-US");

  return (
    <div className="lp min-h-dvh bg-mist text-ink">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-paper focus:px-4 focus:py-2 focus:shadow-md">
        {t.skip}
      </a>
      <p className="on-dark bg-petrol-deep px-4 py-1.5 text-center text-[0.75rem] leading-snug text-paper/85">{t.demoNote}</p>

      <Header t={t} />

      <main id="main" className="lp-main relative mx-auto max-w-[1280px] px-4 sm:px-8">
        <span className="lp-rail" aria-hidden />

        {/* 1. Hero */}
        <section aria-labelledby="hero-title" className="lp-section lp-hero">
          <span className="lp-node lp-node-pilot" aria-hidden>
            <PilotLight size={20} />
          </span>
          <div className="lp-hero-grid">
            <div className="lp-hero-copy">
              <h1 id="hero-title" className="display lp-h1 text-petrol-deep">
                {t.hero.title}
              </h1>
              <p className="mt-6 max-w-[38rem] text-[1.08rem] leading-relaxed text-ink-soft sm:text-[1.15rem]">{t.hero.promise}</p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link href="/k" className={`${GO} ${SIZE.lg}`}>
                  {t.nav.talk} <ArrowRight size={18} aria-hidden />
                </Link>
                <Link href="/k/signup" className={`${SECONDARY} ${SIZE.lg}`}>
                  {t.nav.signup}
                </Link>
              </div>
              <p className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-[0.9rem] text-ink-soft">
                <span>{t.hero.built}</span>
                <Link href="/wall" className={QUIET}>
                  {t.hero.watch}
                </Link>
              </p>
            </div>
            <div className="lp-hero-product">
              <Duo
                priority
                url={t.hero.url}
                desktop={{ id: "hero-desktop-store", alt: t.hero.desktopAlt }}
                phone={{ id: "hero-phone-thread", alt: t.hero.phoneAlt }}
              />
            </div>
          </div>
        </section>

        {/* 2. The film */}
        <Section id="film" title={t.film.title} lead={t.film.lead}>
          <div className="lp-film">
            {f.video ? (
              <video controls preload="none" playsInline poster={f.poster} className="h-full w-full" aria-label={t.film.label}>
                <source src={f.video} type="video/mp4" />
                {f.captions && <track kind="captions" src={f.captions} srcLang="en" label={t.film.captions} default />}
              </video>
            ) : (
              <div className="lp-poster" role="img" aria-label={`${t.film.label}: ${t.film.posterNote}`}>
                <div className="lp-poster-inner">
                  <Wordmark tone="paper" size={34} />
                  <p className="display mt-auto max-w-[18ch] text-[clamp(1.6rem,4.6vw,3.4rem)] leading-[1.05] text-paper">“{t.film.posterLine}”</p>
                  <p className="mt-5 inline-flex items-center gap-3 text-[0.95rem] text-paper/85">
                    <span className="lp-play" aria-hidden />
                    {t.film.posterNote}
                  </p>
                </div>
                <div className="lp-poster-phone" aria-hidden>
                  <Phone id="thread-waiting" alt="" sizes="(min-width: 1024px) 280px, 30vw" missing={t.shotMissing} />
                </div>
              </div>
            )}
          </div>
        </Section>

        {/* 3. The required flow */}
        <Section id="flow" title={t.flow.title} lead={t.flow.lead}>
          <ol className="lp-flow" aria-label={t.flow.carousel} tabIndex={0}>
            {t.flow.steps.map((s, i) => (
              <li key={s.name} className="lp-flow-step">
                <p className="flex items-baseline gap-2">
                  <span className="lp-step-no tabular" aria-hidden>
                    {i < 4 ? i + 1 : "✓"}
                  </span>
                  <span className="display text-[1.25rem] text-petrol-deep">{s.name}</span>
                </p>
                <p className="mt-2 min-h-[4.5em] text-[0.92rem] leading-snug text-ink-soft">{s.text}</p>
                <Phone id={s.shot} alt={s.alt} className="mt-4" sizes="(min-width: 1024px) 230px, 70vw" missing={t.shotMissing} />
              </li>
            ))}
          </ol>
        </Section>

        {/* 4. Every agent */}
        <Section id="agents" title={t.agents.title} lead={t.agents.lead}>
          <div className="space-y-20 sm:space-y-28">
            {t.agents.list.map((a, i) => (
              <article key={a.id} aria-labelledby={`agent-${a.id}`} className={`lp-agent ${i % 2 ? "lp-agent-flip" : ""}`}>
                <div className="lp-agent-copy">
                  <h3 id={`agent-${a.id}`} className="display text-[1.6rem] leading-tight text-petrol-deep sm:text-[1.9rem]">
                    {a.name}
                  </h3>
                  <p className="mt-3 text-[1rem] leading-relaxed text-ink">{a.what}</p>
                  <Fact source={a.source}>{a.fact}</Fact>
                </div>
                {a.shots.length > 0 && (
                  <div className="lp-agent-shots">
                    <AgentShots ids={a.shots} alts={a.alts} missing={t.shotMissing} crop={a.crop} />
                  </div>
                )}
                {a.asks && (
                  <div className="lp-ask" aria-label={a.asksTitle}>
                    <p className="text-[0.82rem] font-semibold text-ink-soft">{a.asksTitle}</p>
                    <ul className="mt-3 space-y-2">
                      {a.asks.map((q) => (
                        <li key={q} className="lp-ask-q">
                          {q}
                        </li>
                      ))}
                    </ul>
                    <div className="lp-ask-refused mt-4">
                      <code>{a.refused}</code>
                      <p className="mt-2 text-[0.85rem] leading-snug">{a.refusedWhy}</p>
                    </div>
                    <p className="mt-4 text-[0.82rem] text-ink-soft">{t.agents.noShot}</p>
                  </div>
                )}
              </article>
            ))}
          </div>

          <div className="mt-24">
            <h3 className="display text-[1.5rem] text-petrol-deep sm:text-[1.75rem]">{t.agents.scenariosTitle}</h3>
            <p className="mt-2 text-ink-soft">{t.agents.scenariosLead}</p>
            <ul className="lp-scenarios mt-6">
              {t.agents.scenarios.map((s) => (
                <li key={s.name}>
                  <h4 className="font-semibold text-ink">{s.name}</h4>
                  <p className="mt-1 text-[0.92rem] leading-snug text-ink-soft">{s.outcome}</p>
                  <Link href={s.href} className={`mt-2 inline-flex items-center gap-1 text-[0.9rem] ${QUIET}`}>
                    {t.agents.tryIt}: {s.href === "/k" ? `“${s.say}”` : s.say}
                    <ArrowUpRight size={15} aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </Section>

        {/* 5. Never trust the model: the one dark feature */}
        <section id="security" aria-labelledby="security-title" className="lp-section">
          <div className="lp-gate on-dark">
            <span className="lp-node lp-node-gate" aria-hidden>
              <Target size={22} tone="safety" />
            </span>
            <h2 id="security-title" className="display lp-h2 text-paper">
              {t.security.title}
            </h2>
            <p className="mt-4 max-w-[44rem] text-[1.05rem] leading-relaxed text-paper/85">{t.security.lead(RULES.length)}</p>

            <div className="mt-10">
              <TrustChain t={t.security} />
            </div>

            <div className="mt-12 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
              <div>
                <h3 className="display text-[1.2rem] text-paper">{t.security.rulesTitle(RULES.length)}</h3>
                <ul className="lp-rules mt-4">
                  {RULES.map((r) => (
                    <li key={r}>
                      <code>{r}</code>
                    </li>
                  ))}
                </ul>
              </div>
              <ul className="lp-facts">
                {t.security.facts.map((x) => (
                  <li key={x.title}>
                    <h3 className="font-semibold text-paper">{x.title}</h3>
                    <p className="mt-1 text-[0.92rem] leading-snug text-paper/80">{x.text}</p>
                  </li>
                ))}
              </ul>
            </div>

            <div className="mt-12">
              <Browser id="gate-refused" alt={t.security.refusedAlt} url="aimopilot / present / now try to break it" missing={t.shotMissing} />
            </div>

            <h3 className="display mt-12 text-[1.2rem] text-paper">{t.security.standardsTitle}</h3>
            <ul className="lp-standards mt-4">
              {t.security.standards.map((s) => (
                <li key={s.name}>
                  <span className="font-semibold text-paper">{s.name}</span>
                  <span className="block text-[0.82rem] leading-snug text-paper/75">{s.what}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* 6. You can see it think */}
        <Section id="thinking" title={t.thinking.title} lead={t.thinking.lead}>
          <div className="lp-think">
            <figure>
              <Phone id="steps-open" alt={t.thinking.stepsAlt} sizes="(min-width: 1024px) 300px, 70vw" missing={t.shotMissing} />
              <figcaption className="mt-3 text-[0.88rem] text-ink-soft">{t.thinking.stepsCaption}</figcaption>
            </figure>
            <figure>
              <Browser id="trace" alt={t.thinking.traceAlt} url="aimopilot / ops / trace" missing={t.shotMissing} />
              <figcaption className="mt-3 text-[0.88rem] text-ink-soft">{t.thinking.traceCaption}</figcaption>
            </figure>
          </div>
        </Section>

        {/* 7. Search */}
        <Section id="search" title={t.search.title} lead={t.search.lead}>
          <div className="lp-search">
            <div className="card p-5 sm:p-7">
              <SearchChart t={t.search} />
            </div>
            <div>
              <SearchTable t={t.search} />
            </div>
          </div>
          <ul className="lp-points mt-10">
            {t.search
              .facts({ first: hybrid.rightFirst, dropped: hybrid.dropped }, { dropped: rules.dropped }, { first: ours.rightFirst, notSold: ours.notSold, of: SEARCH.notSoldOf })
              .map((x) => (
                <li key={x}>{x}</li>
              ))}
          </ul>
          <p className="mt-6 max-w-[46rem] text-[0.9rem] leading-relaxed text-ink-soft">
            {t.search.fair(SEARCH.requests, products)} {t.search.backends}{" "}
            <SourceLink source={{ label: "How we measured", href: SEARCH.source }} />
          </p>
        </Section>

        {/* 8. Tested */}
        <Section id="tested" title={t.tested.title} lead={t.tested.crashLead(CRASH.scenarios)}>
          <CrashTable rows={crash} t={t.tested} />
          <p className="mt-4 max-w-[46rem] text-[0.88rem] leading-relaxed text-ink-soft">
            {t.tested.levels} <SourceLink source={{ label: "The crash-test leaderboard", href: "/docs/crash-test" }} />
          </p>
          <dl className="lp-counts mt-12">
            {t.tested.more.map((m) => (
              <div key={m.text}>
                <dt className="display tabular text-[2.4rem] leading-none text-petrol-deep">{m.figure}</dt>
                <dd className="mt-2 text-[0.92rem] leading-snug text-ink-soft">{m.text}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-8 max-w-[46rem] text-[0.95rem] leading-relaxed text-ink">{t.tested.browser(BROWSER_TESTS)}</p>
        </Section>

        {/* 9. Run it like a business */}
        <Section id="business" title={t.business.title} lead={t.business.lead}>
          <div className="lp-biz">
            <Browser id="ops-agents" alt={t.business.agentsAlt} url="aimopilot / ops / agents" missing={t.shotMissing} />
            <ul className="lp-biz-list">
              {t.business.items.map((x) => (
                <li key={x.name}>
                  <h3 className="font-semibold text-ink">{x.name}</h3>
                  <p className="mt-1 text-[0.92rem] leading-snug text-ink-soft">{x.text}</p>
                </li>
              ))}
            </ul>
          </div>
          <div className="mt-10 lp-biz">
            <Browser id="ops-safeguards" alt={t.business.safeguardsAlt} url="aimopilot / ops / safeguards" missing={t.shotMissing} />
            <div>
              <h3 className="display text-[1.3rem] text-petrol-deep">{t.business.aivenTitle}</h3>
              <dl className="lp-aiven mt-4">
                {t.business.aiven.map((a) => (
                  <div key={a.name}>
                    <dt className="font-semibold text-ink">{a.name}</dt>
                    <dd className="text-[0.9rem] leading-snug text-ink-soft">{a.job}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
          <p className="mt-8">
            <Link href="/ops" className={`${SECONDARY} ${SIZE.md}`}>
              {t.nav.wholesaler} <ArrowRight size={17} aria-hidden />
            </Link>
          </p>
        </Section>

        {/* 10. On every screen */}
        <Section id="screens" title={t.screens.title} lead={t.screens.lead}>
          <div className="lp-pairs">
            {t.screens.pairs.map((p) => (
              <figure key={p.name} className="lp-pair">
                <figcaption className="display text-[1.3rem] text-petrol-deep">{p.name}</figcaption>
                <div className="lp-pair-shots">
                  <Phone id={p.phone} alt={p.phoneAlt} sizes="(min-width: 1024px) 160px, 40vw" missing={t.shotMissing} />
                  <Browser id={p.desktop} alt={p.desktopAlt} missing={t.shotMissing} sizes="(min-width: 1280px) 440px, 90vw" />
                </div>
              </figure>
            ))}
          </div>
        </Section>

        {/* 11. Mail */}
        <Section id="mail" title={t.mail.title} lead={t.mail.lead}>
          <div className="lp-mails">
            <Mail id="mail-receipt" alt={t.mail.receipt.alt} from={t.mail.from} subject={t.mail.receipt.subject} missing={t.shotMissing} />
            <Mail id="mail-changed" alt={t.mail.changed.alt} from={t.mail.from} subject={t.mail.changed.subject} missing={t.shotMissing} />
          </div>
          <p className="mt-6 text-[0.9rem]">
            <SourceLink source={{ label: "What is sent, when, and to whom", href: "/docs/mail" }} />
          </p>
        </Section>

        {/* 12. Honest */}
        <Section id="honest" title={t.honest.title} lead={t.honest.lead}>
          <div className="lp-honest">
            {(
              [
                [t.honest.realTitle, t.honest.real],
                [t.honest.mockedTitle, t.honest.mocked],
                [t.honest.nextTitle, t.honest.next],
              ] as const
            ).map(([title, items]) => (
              <div key={title}>
                <h3 className="display text-[1.2rem] text-petrol-deep">{title}</h3>
                <ul className="mt-3 space-y-3">
                  {items.map((x) => (
                    <li key={x} className="text-[0.95rem] leading-snug text-ink">
                      {x}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p className="mt-8 text-[0.95rem]">
            <Link href="/docs/assumptions" className={QUIET}>
              {t.honest.more}
            </Link>
            <span className="text-ink-soft"> · </span>
            <Link href="/docs" className={QUIET}>
              {t.footer.docs}
            </Link>
          </p>
        </Section>

        {/* 13. The end of the line */}
        <section aria-labelledby="end-title" className="lp-section lp-end">
          <span className="lp-node" aria-hidden />
          <h2 id="end-title" className="display lp-h2 text-petrol-deep">
            {t.footer.title}
          </h2>
          <p className="mt-4 max-w-[38rem] text-[1.08rem] leading-relaxed text-ink-soft">{t.footer.lead}</p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="/k" className={`${GO} ${SIZE.lg}`}>
              {t.nav.talk} <ArrowRight size={18} aria-hidden />
            </Link>
            <Link href="/k/signup" className={`${SECONDARY} ${SIZE.lg}`}>
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
            <p className="mt-1 text-[0.85rem] text-ink-soft">{t.footer.event}</p>
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
          </nav>
        </div>
      </footer>
    </div>
  );
}

function Header({ t }: { t: (typeof LANDING_TEXT)["en"] }) {
  const quiet = [
    { href: "/ops", label: t.nav.wholesaler },
    { href: "/try", label: t.nav.connect },
    { href: "/wall", label: t.nav.live },
    { href: "/docs", label: t.nav.docs },
  ];
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-paper/92 backdrop-blur supports-[backdrop-filter]:bg-paper/80">
      <div className="mx-auto flex h-16 max-w-[1280px] items-center gap-4 px-4 sm:px-8">
        <Link href="/" aria-label="AimoPilot, home" className="shrink-0">
          <Wordmark size={28} />
        </Link>
        <nav aria-label={t.nav.label} className="ml-4 hidden items-center gap-5 text-[0.9rem] xl:flex">
          {quiet.map((q) => (
            <Link key={q.href} href={q.href} className="font-medium text-ink-soft hover:text-petrol">
              {q.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <Link href="/k" className="hidden min-h-9 items-center px-2 text-[0.9rem] font-semibold text-petrol hover:text-petrol-deep md:inline-flex">
            {t.nav.login}
          </Link>
          <span className="hidden md:inline-flex">
            <Link href="/k/signup" className={`${SECONDARY} ${SIZE.sm} whitespace-nowrap`}>
              {t.nav.signup}
            </Link>
          </span>
          <Link href="/k" className={`${GO} ${SIZE.sm} whitespace-nowrap`}>
            {t.nav.talk}
          </Link>
          <details className="lp-menu xl:hidden">
            <summary aria-label={t.nav.more} className="lp-menu-button">
              <Menu size={20} aria-hidden />
            </summary>
            <div className="lp-menu-sheet">
              <Link href="/k" className="md:hidden">
                {t.nav.login}
              </Link>
              <Link href="/k/signup" className="md:hidden">
                {t.nav.signup}
              </Link>
              {quiet.map((q) => (
                <Link key={q.href} href={q.href}>
                  {q.label}
                </Link>
              ))}
            </div>
          </details>
        </div>
      </div>
    </header>
  );
}

/** A section on the thread: its node on the line, the title, the lead, the content. */
function Section({ id, title, lead, children }: { id: string; title: string; lead?: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="lp-section">
      <span className="lp-node" aria-hidden />
      <h2 id={`${id}-title`} className="display lp-h2 text-petrol-deep">
        {title}
      </h2>
      {lead && <p className="mt-4 max-w-[44rem] text-[1.05rem] leading-relaxed text-ink-soft">{lead}</p>}
      <div className="mt-10 sm:mt-12">{children}</div>
    </section>
  );
}

/** A measured fact, with where it was measured. */
function Fact({ children, source }: { children: ReactNode; source: Source }) {
  return (
    <p className="lp-fact mt-5">
      <span className="block text-[0.95rem] leading-snug text-ink">{children}</span>
      <SourceLink source={source} className="mt-2 inline-flex text-[0.85rem]" />
    </p>
  );
}

function SourceLink({ source, className = "" }: { source: Source; className?: string }) {
  return (
    <Link href={source.href} className={`${QUIET} ${className}`}>
      {source.label}
    </Link>
  );
}

/** An agent's screenshots: a desktop with a phone on its corner, two phones side by side, or one screen. */
function AgentShots({ ids, alts, missing, crop }: { ids: readonly string[]; alts: readonly string[]; missing: string; crop?: readonly [number, number] }) {
  const kind = (id: string) => (id.startsWith("agent-home") || id.startsWith("agent-voice") || id.startsWith("agent-watch") || id.endsWith("-phone") ? "phone" : "desktop");
  if (ids.length === 2 && kind(ids[0]) === "phone" && kind(ids[1]) === "phone")
    return (
      <div className="lp-two-phones">
        <Phone id={ids[0]} alt={alts[0]} missing={missing} sizes="(min-width: 1024px) 260px, 44vw" />
        <Phone id={ids[1]} alt={alts[1]} missing={missing} sizes="(min-width: 1024px) 260px, 44vw" />
      </div>
    );
  if (ids.length === 2) {
    const d = kind(ids[0]) === "desktop" ? 0 : 1;
    return <Duo desktop={{ id: ids[d], alt: alts[d] }} phone={{ id: ids[1 - d], alt: alts[1 - d] }} />;
  }
  return <Browser id={ids[0]} alt={alts[0]} missing={missing} crop={crop} className={crop ? "mx-auto max-w-[27rem]" : ""} />;
}
