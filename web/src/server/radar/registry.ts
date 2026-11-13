import type { LedgerEntryType } from "@/core/ledger";
import { DockError } from "@/core/orders";
import { newId } from "@/core/util";
import type { Runtime } from "../runtime";
import { assortmentOf } from "./assortment";
import { DRILL_MARK, drillTitle } from "./drill";
import { buildFacts, hazardFromText } from "./facts";
import { decide, describeLots, displayName, matchNotice } from "./match";
import { ContextDev, Exa, PartnerError } from "./partners";
import { corroborate, discoverOnWeb, listingTarget, readListing, readPage, readRasff, type ListingItem, type PageRead, type ReaderDeps } from "./readers";
import { AUTO_HOLD_MAX_AGE_DAYS, BUDGET, SOURCES, sourceOf, type SourceConfig, type SourceId } from "./sources";
import { radarStore, type DrillNotice, type RadarStore } from "./store";
import { describePack } from "./text";
import type { Hold, Match, Notice, SourceState } from "./types";

/**
 * The radar's pipeline and its decisions: check a source, read new notices into facts, match them against the
 * assortment, and act. What code decides (match.ts `decide`): a confirmed match on a recent notice holds the product;
 * a possible match, or a confirmed one on an older notice, waits for a person. Staff confirm or dismiss a review and
 * lift a hold, always with a reason. Every hold, review, decision, lift and drill is a ledger entry ("control"),
 * with who and why; drills say DRILL in the entry and carry `drill: true`.
 */

const CONTROL = "control" as LedgerEntryType;

const helsinkiDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Helsinki", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400_000);
const fiDay = (iso?: string) => (iso ? `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.${iso.slice(0, 4)}` : "undated");

export type RadarOptions = { now?: () => Date; deps?: Partial<ReaderDeps>; contextDev?: ContextDev; exa?: Exa };

export class RadarRegistry {
  readonly store: RadarStore;
  readonly deps: ReaderDeps;
  private readonly running = new Map<SourceId, Promise<SourceState>>();
  private timer?: ReturnType<typeof setInterval>;
  private lastMonitorPoll = 0;
  private lastDrillPoll = 0;
  private readonly now: () => Date;

  constructor(
    readonly rt: Pick<Runtime, "dock" | "catalog">,
    opts: RadarOptions = {},
  ) {
    this.store = radarStore(rt.dock);
    this.now = opts.now ?? (() => new Date());
    const spend = this.store.state.spend;
    this.deps = {
      cd: opts.contextDev ?? new ContextDev(spend),
      exa: opts.exa ?? new Exa(spend),
      now: this.now,
      drill: { publicBase: process.env.RADAR_PUBLIC_URL?.trim() || process.env.DOCK_PUBLIC_URL?.trim() || undefined },
      ...opts.deps,
    };
  }

  get state() {
    return this.store.state;
  }

  today(): string {
    return helsinkiDay(this.now());
  }

  private log(summary: string, data: Record<string, unknown>, actor = "radar") {
    this.rt.dock.ledger.append({ type: CONTROL, actor, summary, data });
  }

  // ---------- checking sources ----------

  /** Check one source now (one at a time per source). Never throws: a failure is the source's status. */
  checkSource(id: SourceId, opts: { force?: boolean } = {}): Promise<SourceState> {
    const running = this.running.get(id);
    if (running) return running;
    const p = this.doCheck(id, opts).finally(() => this.running.delete(id));
    this.running.set(id, p);
    return p;
  }

  private async doCheck(id: SourceId, opts: { force?: boolean }): Promise<SourceState> {
    const source = sourceOf(id)!;
    // A drill, or a person pressing "check now", may use the reserve of Context.dev's per-minute allowance.
    const urgent = !!source.drill || !!opts.force;
    const deps: ReaderDeps = { ...this.deps, urgent };
    const st = this.state.sources[id];
    st.lastCheckAt = this.now().toISOString();
    st.checks += 1;
    try {
      if (source.kind === "authority_listing") await this.checkListing(source, st, opts, deps);
      else if (source.kind === "web_search") await this.checkWeb(source, st, deps);
      else await this.checkFeed(source, st, deps);
      if (st.status !== "layout_changed" && st.status !== "degraded") st.status = "ok";
      if (st.status === "ok" || st.status === "degraded") {
        st.lastOkAt = st.lastCheckAt;
        if (st.status === "ok") st.lastError = undefined;
      }
    } catch (err) {
      const e = err instanceof PartnerError ? err : new PartnerError("direct", "network", (err as Error)?.message ?? String(err));
      // A source that is down, or out of budget, is a status on the screen, never an alarm and never "no recalls".
      st.status = e.kind === "budget" || e.kind === "no_key" ? "paused" : "down";
      st.lastError = e.message;
    }
    this.store.save();
    return structuredClone(st);
  }

  private async checkListing(source: SourceConfig, st: SourceState, opts: { force?: boolean }, deps: ReaderDeps) {
    const read = await readListing(source, deps, { force: opts.force, previousCount: st.listedLastTime });
    if (read.items.length === 0 && (st.listedLastTime ?? 0) > 0) {
      st.status = "layout_changed";
      st.lastError = read.note ?? "The listing showed no notices where it had some: its layout probably changed. Nothing was concluded from it.";
      return;
    }
    st.status = read.via === "context.dev-json" ? "degraded" : "ok";
    st.lastError = read.via === "context.dev-json" ? read.note : undefined;
    st.listedLastTime = read.items.length;
    const recent = read.items.filter((i) => !i.publishedOn || days(i.publishedOn, this.today()) <= source.readWindowDays);
    const fresh = recent.filter((i) => !this.state.notices.some((n) => n.url === i.url && n.state === "read"));
    for (const item of fresh.slice(0, source.maxReadsPerCheck)) await this.readNotice(source, item, deps);
  }

  private async checkWeb(source: SourceConfig, st: SourceState, deps: ReaderDeps) {
    if (!deps.exa.configured) throw new PartnerError("exa", "no_key", "EXA_API_KEY is not set.");
    const items = await discoverOnWeb(source, deps);
    const fresh = items.filter((i) => !this.state.notices.some((n) => n.url === i.url) && !this.state.notRecalls.includes(i.url));
    st.listedLastTime = items.length;
    for (const item of fresh.slice(0, source.maxReadsPerCheck)) await this.readNotice(source, item, deps);
  }

  private async checkFeed(source: SourceConfig, st: SourceState, deps: ReaderDeps) {
    const items = await readRasff(source, deps);
    st.listedLastTime = items.length;
    for (const f of items) {
      if (this.state.notices.some((n) => n.url === f.url)) continue;
      const hz = hazardFromText(f.subject);
      this.state.notices.push({
        noticeId: newId("ntc"),
        sourceId: source.id,
        drill: false,
        url: f.url,
        title: f.subject,
        language: "en",
        publishedOn: f.publishedOn,
        seenAt: this.now().toISOString(),
        readAt: this.now().toISOString(),
        readBy: "rasff",
        state: "read",
        facts: { products: [], hazard: { kind: hz.kind, allergens: hz.allergens, text: { value: f.subject, sentence: f.subject, verified: true } }, eans: [], lots: { bestBefore: [], batches: [], marks: [] }, summaryEnglish: `${f.classification}${f.risk ? `, risk ${f.risk}` : ""}${f.category ? `, ${f.category}` : ""}. The public RASFF record names no brand or EAN, so it cannot match a product by itself.` },
        corroboration: [],
        sameAs: [],
        feed: { reference: f.reference, classification: f.classification, risk: f.risk, category: f.category, countries: f.countries },
      });
      st.noticesRead += 1;
    }
  }

  /** List a notice (if new), read its page into facts, then match and act on it. */
  private async readNotice(source: SourceConfig, item: ListingItem, deps: ReaderDeps = this.deps): Promise<Notice> {
    let n = this.state.notices.find((x) => x.url === item.url);
    if (!n) {
      n = {
        noticeId: newId("ntc"),
        sourceId: source.id,
        drill: !!source.drill,
        url: item.url,
        title: item.title,
        language: source.language,
        publishedOn: item.publishedOn,
        seenAt: this.now().toISOString(),
        state: "listed",
        corroboration: [],
        sameAs: [],
      };
      this.state.notices.push(n);
      const d = source.drill ? this.state.drills.find((x) => item.url.endsWith(`/${x.slug}`)) : undefined;
      if (d && !d.pickedUpAt) d.pickedUpAt = n.seenAt;
    }
    try {
      const page = await readPage(item.url, source, deps);
      if (source.kind === "web_search" && page.model?.is_recall_notice === false) {
        this.state.notices = this.state.notices.filter((x) => x !== n);
        this.state.notRecalls.push(item.url);
        return n;
      }
      await this.ingest(n, page, source);
    } catch (err) {
      n.state = "unreadable";
      n.readError = (err as Error)?.message ?? String(err);
    }
    this.store.save();
    return n;
  }

  /** Facts from a page, then matches and decisions. Public for tests (recorded pages, no network). */
  async ingest(n: Notice, page: PageRead, source: SourceConfig): Promise<Notice> {
    n.readAt = this.now().toISOString();
    n.readBy = page.via;
    n.state = "read";
    n.readError = undefined;
    n.title = n.title || page.title || n.url;
    n.publishedOn ??= page.publishedOn;
    n.drill = n.drill || !!source.drill || (DRILL_MARK.test(page.text) && /HARJOITUS|DRILL/.test(n.title));
    n.text = page.text.slice(0, 30_000);
    n.facts = buildFacts({ text: page.text, title: n.title, publishedOn: n.publishedOn, model: page.model, seenOn: this.today() });
    if (page.model?.language === "sv" || page.model?.language === "fi" || page.model?.language === "en") n.language = page.model.language;
    this.state.sources[source.id].noticesRead += 1;
    this.pairLanguages(n);
    await this.act(n, source);
    if (!n.drill && source.kind === "authority_listing" && source.independent && n.publishedOn && days(n.publishedOn, this.today()) <= BUDGET.corroborateWithinDays && this.deps.exa.configured) {
      void corroborate(n, this.deps)
        .then((c) => {
          n.corroboration = c;
          this.store.save();
        })
        .catch(() => undefined);
    }
    return n;
  }

  /**
   * Run matching again on every notice already read (after the matching rules changed). Only undecided matches are
   * replaced: anything a person reviewed, and every hold, stays as it is.
   */
  async rematchAll(): Promise<{ before: number; after: number }> {
    const before = this.state.matches.length;
    const undecided = (m: Match) => !m.review && !m.holdId;
    this.state.matches = this.state.matches.filter((m) => !undecided(m));
    for (const n of this.state.notices.filter((x) => x.state === "read" && x.facts)) await this.act(n, sourceOf(n.sourceId)!);
    this.store.save();
    return { before, after: this.state.matches.length };
  }

  /** The Finnish and Swedish versions of one notice: same date, and a shared EAN or the only notice that day. */
  private pairLanguages(n: Notice) {
    if (!n.publishedOn || n.sourceId === "exa-web" || n.sourceId === "rasff") return;
    const other = this.state.notices.filter((x) => x !== n && x.language !== n.language && x.publishedOn === n.publishedOn && x.sourceId !== "exa-web" && x.sourceId !== "rasff" && x.drill === n.drill);
    const sameDayMine = this.state.notices.filter((x) => x.language === n.language && x.publishedOn === n.publishedOn && x.sourceId === n.sourceId);
    const pair = other.find((x) => (x.facts?.eans ?? []).some((e) => n.facts?.eans.includes(e))) ?? (other.length === 1 && sameDayMine.length === 1 ? other[0] : undefined);
    if (!pair) return;
    if (!n.sameAs.includes(pair.noticeId)) n.sameAs.push(pair.noticeId);
    if (!pair.sameAs.includes(n.noticeId)) pair.sameAs.push(n.noticeId);
  }

  /** Match the notice and do what code decides for each match. */
  private async act(n: Notice, source: SourceConfig) {
    if (!n.facts) return;
    const assortment = await assortmentOf(this.rt);
    const age = n.publishedOn ? days(n.publishedOn, this.today()) : undefined;
    for (const p of matchNotice(n.facts, assortment.items)) {
      if (this.state.matches.some((m) => m.noticeId === n.noticeId && m.productId === p.productId)) continue;
      // The same recall read in its other language does not match twice.
      if (this.state.matches.some((m) => n.sameAs.includes(m.noticeId) && m.productId === p.productId && m.status !== "dismissed")) continue;
      const d = decide(p, { today: this.today(), noticeAgeDays: n.drill ? 0 : age });
      const m: Match = {
        matchId: newId("rmt"),
        noticeId: n.noticeId,
        drill: n.drill,
        productId: p.productId,
        productName: p.productName,
        strength: p.strength,
        basis: p.basis,
        why: p.why,
        noticeProduct: p.noticeProduct,
        lots: p.lots,
        newDeliveriesAffected: d.status !== "confirmed" || d.hold,
        status: d.status,
        reviewReason: d.reviewReason ?? d.note,
        createdAt: this.now().toISOString(),
      };
      this.state.matches.push(m);
      const tag = n.drill ? "DRILL, not a real recall: " : "";
      const what = `${publisherOf(n)} notice "${n.title}" (${fiDay(n.publishedOn)}, ${n.url})`;
      if (d.hold) {
        this.placeHold(m, n, "radar");
      } else if (d.status === "history") {
        // nothing to decide: shown with the notice
      } else if (d.status === "review") {
        this.log(`${tag}Recall radar: possible match for review. ${p.productName} (${p.productId}) against the ${what}. ${p.why} ${d.reviewReason}`, { action: "recall_review_raised", matchId: m.matchId, noticeId: n.noticeId, productId: p.productId, strength: p.strength, basis: p.basis, drill: n.drill, noticeUrl: n.url });
      } else {
        this.log(`${tag}Recall radar: ${p.productName} (${p.productId}) is the product in the ${what}, matched on ${p.basis === "gtin" ? "its EAN" : "producer, name and pack"}. ${d.note}`, { action: "recall_match_no_hold", matchId: m.matchId, noticeId: n.noticeId, productId: p.productId, basis: p.basis, lots: describeLots(p.lots), drill: n.drill, noticeUrl: n.url });
      }
    }
    void source;
  }

  private placeHold(m: Match, n: Notice, by: string): Hold {
    const lots = describeLots(m.lots);
    const h: Hold = {
      holdId: newId("rhd"),
      productId: m.productId,
      productName: m.productName,
      noticeId: n.noticeId,
      matchId: m.matchId,
      drill: n.drill,
      ...(n.drill ? { drillId: this.state.drills.find((d) => n.url.endsWith(`/${d.slug}`))?.drillId } : {}),
      reason: `${n.drill ? "DRILL notice" : `${publisherOf(n)} notice`} "${n.title}" (${fiDay(n.publishedOn)})${lots ? `, ${lots}` : ""}: ${hazardWords(n)}.`,
      noticeUrl: n.url,
      noticeTitle: n.title,
      publisher: publisherOf(n),
      placedAt: this.now().toISOString(),
      placedBy: by,
      refusals: 0,
    };
    this.state.holds.push(h);
    m.holdId = h.holdId;
    if (h.drillId) {
      const d = this.state.drills.find((x) => x.drillId === h.drillId);
      if (d && !d.heldAt) d.heldAt = h.placedAt;
    }
    const who = by === "radar" ? "Recall radar" : `Operations staff (${by.replace(/^operator:/, "")})`;
    this.log(
      `${n.drill ? "DRILL, not a real recall: " : ""}${who} put ${m.productName} (${m.productId}) on a recall hold: ${h.reason} Matched: ${m.why} Autonomous orders for it are refused with this notice as the reason; orders waiting for sign-off that contain it are flagged to their approver and cannot be approved while it holds.`,
      { action: "recall_hold", holdId: h.holdId, matchId: m.matchId, noticeId: n.noticeId, productId: m.productId, basis: m.basis, noticeUrl: n.url, drill: n.drill, by },
      by === "radar" ? "radar" : by,
    );
    return h;
  }

  // ---------- staff actions ----------

  review(matchId: string, input: { decision: "confirm" | "dismiss"; reason: string; by: string }): Match {
    const m = this.state.matches.find((x) => x.matchId === matchId);
    if (!m) throw new DockError(404, "match_not_found", `No match ${matchId}.`);
    if (m.status !== "review") throw new DockError(409, "match_not_in_review", `This match is already ${m.status.replaceAll("_", " ")}.`);
    const reason = input.reason.trim();
    if (!reason) throw new DockError(400, "reason_required", "Say why: the reason is written to the ledger.");
    const n = this.store.notice(m.noticeId)!;
    m.review = { by: input.by, at: this.now().toISOString(), decision: input.decision, reason };
    m.status = input.decision === "confirm" ? "confirmed_by_staff" : "dismissed";
    const tag = m.drill ? "DRILL, not a real recall: " : "";
    this.log(`${tag}Operations staff (${input.by}) ${input.decision === "confirm" ? "confirmed" : "dismissed"} the possible match of ${m.productName} (${m.productId}) to ${publisherOf(n)} notice "${n.title}": "${reason}".`, { action: input.decision === "confirm" ? "recall_review_confirmed" : "recall_review_dismissed", matchId, noticeId: n.noticeId, productId: m.productId, reason, by: input.by, drill: m.drill }, `operator:${input.by}`);
    if (input.decision === "confirm") {
      m.newDeliveriesAffected = true;
      this.placeHold(m, n, `operator:${input.by}`);
    }
    this.store.save();
    return structuredClone(m);
  }

  liftHold(holdId: string, input: { reason: string; by: string }): Hold {
    const h = this.state.holds.find((x) => x.holdId === holdId);
    if (!h) throw new DockError(404, "hold_not_found", `No hold ${holdId}.`);
    if (h.liftedAt) throw new DockError(409, "hold_already_lifted", "This hold was already lifted.");
    const reason = input.reason.trim();
    if (!reason) throw new DockError(400, "reason_required", "Say why: the reason is written to the ledger.");
    h.liftedAt = this.now().toISOString();
    h.liftedBy = input.by;
    h.liftReason = reason;
    this.log(`${h.drill ? "DRILL, not a real recall: " : ""}Operations staff (${input.by}) lifted the recall hold on ${h.productName} (${h.productId}): "${reason}". It refused ${h.refusals} call${h.refusals === 1 ? "" : "s"} while in force.`, { action: "recall_hold_lifted", holdId, productId: h.productId, noticeUrl: h.noticeUrl, reason, by: input.by, refusals: h.refusals, drill: h.drill }, `operator:${input.by}`);
    this.store.save();
    return structuredClone(h);
  }

  // ---------- drills ----------

  async publishDrill(input: { productId: string; by: string; origin?: string }): Promise<DrillNotice> {
    const a = await assortmentOf(this.rt);
    const item = a.byId.get(input.productId);
    if (!item) throw new DockError(404, "product_not_found", `No product ${input.productId} in the assortment.`);
    if (this.state.drills.some((d) => !d.withdrawnAt && d.productId === input.productId)) throw new DockError(409, "drill_running", "A drill notice for this product is already published. End it first.");
    if (input.origin) this.deps.drill.localOrigin = input.origin;
    const now = this.now();
    const bb = helsinkiDay(new Date(now.getTime() + 12 * 86400_000));
    const d: DrillNotice = {
      drillId: newId("drl"),
      slug: `harjoitus-${now.getTime().toString(36)}`,
      productId: item.id,
      productName: displayName(item),
      names: { ...item.names },
      brand: item.brand,
      vendor: item.vendor,
      ean: item.gtins[item.gtins.length - 1] ?? item.gtins[0],
      pack: item.pack ? describePack({ ...item.pack, count: 1 }) : undefined,
      bestBefore: bb,
      publishedAt: now.toISOString(),
      publishedBy: input.by,
    };
    this.state.drills.push(d);
    const target = listingTarget(sourceOf("drill")!, this.deps);
    this.log(`DRILL, not a real recall: Operations staff (${input.by}) published a drill notice "${drillTitle(d)}" about ${d.productName} (${d.productId}) on Dock's own drill page ${target.url}. The radar reads it the same way as a real notice.`, { action: "recall_drill_published", drill: true, drillId: d.drillId, productId: d.productId, url: `${target.url}/${d.slug}`, by: input.by }, `operator:${input.by}`);
    this.store.save();
    this.lastDrillPoll = 0;
    setTimeout(() => void this.checkSource("drill", { force: true }), 800).unref?.();
    return structuredClone(d);
  }

  endDrill(drillId: string, input: { by: string }): DrillNotice {
    const d = this.state.drills.find((x) => x.drillId === drillId);
    if (!d) throw new DockError(404, "drill_not_found", `No drill ${drillId}.`);
    if (d.withdrawnAt) throw new DockError(409, "drill_ended", "This drill already ended.");
    d.withdrawnAt = this.now().toISOString();
    d.withdrawnBy = input.by;
    for (const h of this.state.holds.filter((x) => x.drillId === drillId && !x.liftedAt)) this.liftHold(h.holdId, { reason: "Drill ended", by: input.by });
    this.log(`DRILL, not a real recall: Operations staff (${input.by}) ended the drill about ${d.productName} (${d.productId}).`, { action: "recall_drill_ended", drill: true, drillId, productId: d.productId, by: input.by }, `operator:${input.by}`);
    this.store.save();
    return structuredClone(d);
  }

  // ---------- Context.dev monitors and the schedule ----------

  /** A Context.dev page monitor on each listing that wants one: found by name (one per account), else created. */
  async ensureMonitors(): Promise<void> {
    if (!this.deps.cd.configured) return;
    for (const s of SOURCES.filter((x) => x.monitor && !x.drill)) {
      const st = this.state.sources[s.id];
      if (st.monitor?.monitorId) continue;
      const name = `Dock recall radar: ${s.id}`;
      try {
        const found = (await this.deps.cd.listMonitors(name)).find((m) => m.name === name);
        const m =
          found ??
          (await this.deps.cd.createMonitor({
            name,
            target: { type: "page", url: s.homeUrl, include_selectors: s.monitor!.includeSelectors },
            change_detection: { type: "exact" },
            schedule: { type: "interval", frequency: s.monitor!.everyMinutes, unit: "minutes" },
          }));
        st.monitor = { monitorId: m.id, lastRunAt: m.last_run_at ?? undefined, nextRunAt: m.next_run_at ?? undefined, lastChangeAt: m.last_change_at ?? undefined, lastRunStatus: m.status, seenChangeIds: [] };
        this.store.save();
      } catch (err) {
        st.lastError = `Monitor: ${(err as Error).message}`;
      }
    }
  }

  /** Read the monitors' state (free); a change since we last looked triggers a full check of that listing. */
  async pollMonitors(): Promise<void> {
    for (const s of SOURCES.filter((x) => x.monitor)) {
      const st = this.state.sources[s.id];
      if (!st.monitor?.monitorId) continue;
      try {
        const m = await this.deps.cd.getMonitor(st.monitor.monitorId);
        const changed = !!m.last_change_at && m.last_change_at !== st.monitor.lastChangeAt;
        st.monitor = { ...st.monitor, lastRunAt: m.last_run_at ?? undefined, nextRunAt: m.next_run_at ?? undefined, lastRunStatus: m.last_error ? `failed: ${m.last_error.message ?? m.last_error.code}` : m.status, lastChangeAt: m.last_change_at ?? undefined };
        if (changed) void this.checkSource(s.id, { force: true });
      } catch {
        // the monitor is a second pair of eyes; the radar's own schedule still runs
      }
    }
    this.store.save();
  }

  /** One tick of the schedule: due sources, monitors, and a fast look at the drill page while a drill waits. */
  async tick(): Promise<void> {
    const now = this.now().getTime();
    for (const s of SOURCES) {
      const st = this.state.sources[s.id];
      if (s.drill && !this.state.drills.some((d) => !d.withdrawnAt)) continue;
      const due = !st.lastCheckAt || now - Date.parse(st.lastCheckAt) >= s.checkEveryMinutes * 60_000;
      if (due && st.status !== "paused") void this.checkSource(s.id);
    }
    if (now - this.lastMonitorPoll >= BUDGET.monitorPollSeconds * 1000) {
      this.lastMonitorPoll = now;
      void this.ensureMonitors().then(() => this.pollMonitors());
    }
    const waiting = this.state.drills.some((d) => !d.withdrawnAt && !d.heldAt);
    if (waiting && now - this.lastDrillPoll >= BUDGET.drillPollSeconds * 1000) {
      this.lastDrillPoll = now;
      void this.checkSource("drill", { force: true });
    }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick().catch(() => undefined), 3000);
    this.timer.unref?.();
    void this.tick().catch(() => undefined);
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }
}

export function publisherOf(n: Notice): string {
  if (n.drill) return "Dock drill page (not a real recall)";
  if (n.sourceId === "exa-web") {
    try {
      return new URL(n.url).hostname.replace(/^www\./, "");
    } catch {
      return "a web page";
    }
  }
  return sourceOf(n.sourceId)?.publisher ?? n.sourceId;
}

const HAZARD_WORDS: Record<string, string> = {
  allergen: "undeclared allergen",
  microbial: "microbial hazard",
  foreign_body: "foreign bodies",
  chemical: "chemical limit exceeded",
  spoilage: "spoilage or shelf-life fault",
  labelling: "labelling fault",
  other: "safety fault",
};

function hazardWords(n: Notice): string {
  const hz = n.facts?.hazard;
  if (!hz) return "see the notice";
  const base = HAZARD_WORDS[hz.kind] ?? "safety fault";
  return hz.allergens.length ? `${base} (${hz.allergens.join(", ")})` : (hz.text?.english ?? base);
}

// On globalThis for the same reason as the store (store.ts): one radar and one schedule per Dock, whichever bundle asks.
const gr = globalThis as typeof globalThis & { __dockRadars?: WeakMap<object, RadarRegistry> };
const registries = (gr.__dockRadars ??= new WeakMap<object, RadarRegistry>());

/** The radar of one runtime. The schedule starts with it unless RADAR_POLL=off, under tests, or during a build. */
export function radar(rt: Pick<Runtime, "dock" | "catalog">, opts?: RadarOptions): RadarRegistry {
  let r = registries.get(rt.dock);
  if (!r) {
    registries.set(rt.dock, (r = new RadarRegistry(rt, opts)));
    const off = process.env.RADAR_POLL === "off" || !!process.env.VITEST || process.env.NEXT_PHASE === "phase-production-build";
    if (!off) r.start();
  }
  return r;
}

export { AUTO_HOLD_MAX_AGE_DAYS };
