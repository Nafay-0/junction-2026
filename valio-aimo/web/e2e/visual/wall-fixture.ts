/**
 * A fixed wall snapshot for screenshots: the shape of GET /ui-api/wall (src/server/wall-snapshot.ts WallSnapshot),
 * every lane state and tone once, a refusal, two kitchens. Times are relative to `now`, which the page's frozen clock
 * also uses, so "2 min ago" is the same every run.
 */
export function wallFixture(now: number) {
  const at = (sAgo: number) => new Date(now - sAgo * 1000).toISOString();
  return {
    at: at(0),
    counters: { orders: 12, agentAlone: 7, humanSignedOff: 5, refused: 4, liveCalls: 31, waiting: 1 },
    chain: { ok: true, length: 248 },
    feed: [
      { key: "req_fixture_5", kitchen: "Hotel Saimaa kitchen, Jyväskylä", what: "1,000 L lactose-free milk", reached: 4, status: "Waiting for Leevi Saarinen", tone: "safety", totalCents: 132200, at: at(20) },
      { key: "req_fixture_4", kitchen: "Ravintola Kaari", what: "1,000 L lactose-free milk", reached: 4, status: "Refused: a swap may cost only a little more", tone: "safety", totalCents: 149000, at: at(75) },
      { key: "req_fixture_3", kitchen: "Laakso Catering Oy", what: "100 L milk", reached: 5, status: "Signed order, delivery Mon 16.11.", tone: "done", totalCents: 12900, at: at(140) },
      { key: "req_fixture_2", kitchen: "Ravintola Kaari", what: "6 L cream 35 %", reached: 3, status: "Price fixed at €31.20", tone: "plain", totalCents: 3120, at: at(260) },
      { key: "req_fixture_1", kitchen: "Hotel Aurora kitchen, Jyväskylä", what: "200 L lactose-free milk", reached: 2, status: "Comparing 3 options", tone: "plain", at: at(400) },
    ],
    refusals: [
      {
        key: "r_fixture_2",
        kitchen: "Ravintola Kaari",
        rule: "A swap may cost only a little more",
        reason: "Valio Eila 1.5 %, 1 L costs 15.5 % more per L than Valio Eila 1.5 %, 10 L bag-in-box; the mandate tolerates 10 %.",
        at: at(75),
      },
      { key: "r_fixture_1", kitchen: "Hotel Aurora kitchen, Jyväskylä", rule: "Over the weekly budget", reason: "This order would take the week to 1 620,00 € against a budget of 1 500,00 €.", at: at(900) },
    ],
    kitchens: [
      { slug: "sbx_fixture_1", name: "Hotel Saimaa kitchen, Jyväskylä", approverName: "Leevi Saarinen" },
      { slug: "sbx_fixture_2", name: "Hotel Aurora kitchen, Jyväskylä", approverName: "Juho Lehtonen" },
    ],
    lastActivityAt: at(20),
    catalogue: { kind: "seed" },
  };
}
