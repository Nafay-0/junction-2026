import type { CustomData } from "@/lib/widgets/types";
import { toSource } from "@/lib/widgets/types";

/** A small dashboard: stats, a donut beside progress bars, a callout, a timeline and actions. */
export const customFixture: CustomData = {
  kind: "custom",
  title: "Monthly budget for a student in Helsinki",
  subtitle: "November 2026 · €1,150 income · 16 days left",
  sources: [
    toSource({ url: "https://www.kela.fi/web/en/study-grant-amount", title: "Amount of study grant | Kela" }),
    toSource({ url: "https://www.hoas.fi/en/apartments/rents/", title: "Rents | HOAS" }),
    toSource({ url: "https://www.hsl.fi/en/tickets-and-fares/discounted-tickets/student", title: "Student discount | HSL" }),
    toSource({ url: "https://www.numbeo.com/cost-of-living/in/Helsinki", title: "Cost of living in Helsinki | Numbeo" }),
  ],
  blocks: [
    {
      type: "stats",
      items: [
        { label: "Income", value: "€1,150", detail: "Grant, loan and part-time" },
        { label: "Spent so far", value: "€849", detail: "6% more than October", trend: "up", good: false },
        { label: "Left this month", value: "€301", detail: "About €19 a day" },
        { label: "Rent share", value: "49%", detail: "Same as last month", trend: "flat" },
      ],
    },
    {
      type: "chart",
      chartType: "donut",
      width: "half",
      title: "Planned spending",
      unit: "€",
      labels: ["Rent", "Groceries", "Eating out", "Leisure", "Transport", "Phone and internet", "Other"],
      series: [{ name: "Planned", values: [560, 210, 80, 60, 33.6, 24.9, 31.5] }],
    },
    {
      type: "progress",
      width: "half",
      title: "Budget used so far",
      items: [
        { label: "Rent", value: "€560 of €560", percent: 100, detail: "Paid on 2 November" },
        { label: "Groceries", value: "€151 of €210", percent: 72 },
        { label: "Eating out", value: "€77 of €80", percent: 96, detail: "Nearly used up" },
        { label: "Leisure", value: "€27 of €60", percent: 45 },
        { label: "Transport", value: "€33.60 of €33.60", percent: 100, detail: "HSL 30-day student ticket" },
      ],
    },
    {
      type: "callout",
      tone: "warning",
      text: "Eating out is at 96% with 16 days to go. Cooking at home three more evenings a week would keep you about €40 under budget.",
    },
    {
      type: "list",
      listStyle: "timeline",
      title: "Upcoming payments",
      items: [
        { label: "20 Nov", value: "Elisa phone plan", detail: "€24.90 by direct debit" },
        { label: "1 Dec", value: "HOAS rent for December", detail: "€560, due by the 5th", href: "https://www.hoas.fi/en/" },
        { label: "3 Dec", value: "HSL 30-day ticket renews", detail: "€33.60 in the HSL app" },
      ],
    },
    {
      type: "buttons",
      buttons: [
        {
          label: "Find cheaper phone plans",
          action: "ask",
          value: "Find phone plans in Finland under €20 a month with at least 50 GB of data",
          primary: true,
        },
        { label: "Kela study grant rates", action: "link", value: "https://www.kela.fi/web/en/study-grant-amount" },
        {
          label: "Copy summary",
          action: "copy",
          value: "November budget: €1,150 income, €849 spent, €301 left. Eating out at 96% of budget.",
        },
      ],
    },
  ],
};

/** One block per chart type, for review. */
export const customChartsFixture: CustomData = {
  kind: "custom",
  title: "Chart gallery",
  subtitle: "Every chart type the custom widget can draw",
  sources: [
    toSource({ url: "https://www.nordpoolgroup.com/en/market-data/", title: "Market data | Nord Pool" }),
    toSource({ url: "https://www.energia.fi/en/statistics/", title: "Energy statistics | Finnish Energy" }),
    toSource({ url: "https://www.stat.fi/en/statistics/asvu", title: "Rents of dwellings | Statistics Finland" }),
    toSource({ url: "https://gs.statcounter.com/vendor-market-share/mobile/finland", title: "Mobile vendor market share in Finland | StatCounter" }),
    toSource({ url: "https://www.timeanddate.com/sun/finland/helsinki", title: "Sunrise and sunset in Helsinki | timeanddate.com" }),
  ],
  blocks: [
    {
      type: "chart",
      chartType: "line",
      title: "Spot electricity price in Finland, monthly average",
      unit: "c/kWh",
      labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
      series: [
        { name: "2024", values: [10.9, 6.2, 5.1, 4.4, 3.6, 3.2, 1.9, 3.1, 3.8, 3.6, 5.9, 4.5] },
        { name: "2025", values: [6.8, 7.4, 3.9, 2.8, 2.4, 1.8, 2.3, 3.5, 4.1, 4.9, 6.6, 7.8] },
      ],
    },
    {
      type: "chart",
      chartType: "area",
      title: "Daylight hours on the 15th of each month",
      unit: "h",
      labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
      series: [
        { name: "Helsinki", values: [6.6, 9.1, 11.9, 14.8, 17.5, 18.9, 18.1, 15.5, 12.6, 9.7, 7.0, 5.8] },
        { name: "Rovaniemi", values: [3.9, 8.1, 11.8, 15.8, 20.9, 24, 22.6, 16.9, 12.8, 9.0, 5.1, 1.6] },
      ],
    },
    {
      type: "chart",
      chartType: "bar",
      title: "Average monthly rent, privately financed",
      unit: "€",
      labels: ["Helsinki", "Espoo", "Vantaa", "Tampere", "Turku", "Oulu"],
      series: [
        { name: "Studio", values: [790, 760, 690, 590, 560, 520] },
        { name: "Two rooms", values: [1120, 1090, 960, 800, 760, 700] },
      ],
    },
    {
      type: "chart",
      chartType: "stackedBar",
      title: "Electricity production in Finland by source, 2025",
      unit: "TWh",
      labels: ["Q1", "Q2", "Q3", "Q4"],
      series: [
        { name: "Nuclear", values: [8.9, 7.6, 7.4, 8.8] },
        { name: "Wind", values: [6.0, 4.8, 4.5, 6.5] },
        { name: "Hydro", values: [3.3, 4.3, 3.4, 3.5] },
        { name: "CHP and other", values: [3.8, 1.6, 1.2, 3.2] },
      ],
    },
    {
      type: "chart",
      chartType: "horizontalBar",
      title: "Visitors to Helsinki museums, 2025",
      labels: [
        "Ateneum Art Museum",
        "Kiasma Museum of Contemporary Art",
        "Amos Rex",
        "National Museum of Finland",
        "Helsinki City Museum",
        "Design Museum",
      ],
      series: [{ name: "Visitors", values: [418000, 352000, 291000, 276000, 214000, 148000] }],
    },
    {
      type: "chart",
      chartType: "pie",
      width: "half",
      title: "Smartphone market share in Finland",
      unit: "%",
      labels: ["Apple", "Samsung", "Google", "Xiaomi", "OnePlus", "Other"],
      series: [{ name: "Share", values: [38.4, 35.9, 7.2, 6.1, 3.8, 8.6] }],
    },
    {
      type: "chart",
      chartType: "donut",
      width: "half",
      title: "Where a home's energy goes",
      unit: "%",
      labels: ["Space heating", "Hot water", "Appliances", "Lighting", "Saunas"],
      series: [{ name: "Share", values: [61, 17, 13, 4, 5] }],
    },
    {
      type: "chart",
      chartType: "scatter",
      title: "Noise-cancelling headphones: price (€) against rating",
      labels: ["349", "299", "449", "199", "379", "249", "129", "279", "399", "179"],
      series: [{ name: "Rating out of 5", values: [4.6, 4.4, 4.7, 4.0, 4.5, 4.2, 3.8, 4.3, 4.5, 4.1] }],
    },
    {
      type: "chart",
      chartType: "radar",
      title: "Two laptops, scored out of 10",
      labels: ["Battery", "Performance", "Display", "Weight", "Keyboard", "Price"],
      series: [
        { name: "MacBook Air 13", values: [9, 8, 8, 9, 7, 7] },
        { name: "ThinkPad X1 Carbon", values: [7, 7, 7, 9, 9, 5] },
      ],
    },
  ],
};

const TIP_CALCULATOR = `
<div class="card">
  <div class="grid" style="grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));">
    <div>
      <label for="bill">Bill (€)</label>
      <input id="bill" type="number" inputmode="decimal" min="0" step="0.5" value="86.40">
    </div>
    <div>
      <label for="people">People</label>
      <input id="people" type="number" inputmode="numeric" min="1" step="1" value="3">
    </div>
  </div>
  <div style="margin-top: 14px;">
    <div class="row" style="justify-content: space-between;">
      <label for="tip" style="margin: 0;">Tip</label>
      <span id="tipLabel" class="nums" style="font-weight: 600;">5%</span>
    </div>
    <input id="tip" type="range" min="0" max="20" step="1" value="5" style="margin-top: 6px;">
    <div class="row" style="margin-top: 8px;">
      <button type="button" data-tip="0">None</button>
      <button type="button" data-tip="5">5%</button>
      <button type="button" data-tip="10">10%</button>
      <button type="button" data-tip="15">15%</button>
    </div>
  </div>
</div>
<div class="grid" style="margin-top: 12px; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px;">
  <div class="card"><div class="muted" style="font-size: 12px;">Tip</div><div id="tipOut" class="nums" style="font-size: 18px; font-weight: 600;">€0</div></div>
  <div class="card"><div class="muted" style="font-size: 12px;">Total</div><div id="totalOut" class="nums" style="font-size: 18px; font-weight: 600;">€0</div></div>
  <div class="card" style="border-color: var(--brand);"><div class="muted" style="font-size: 12px;">Each</div><div id="eachOut" class="nums" style="font-size: 18px; font-weight: 600; color: var(--brand);">€0</div></div>
</div>
<div class="row" style="margin-top: 12px;">
  <button type="button" class="btn-primary" id="ask">Restaurants with service included</button>
  <button type="button" id="copy">Copy split</button>
</div>
<script>
  var $ = function (id) { return document.getElementById(id); };
  var eur = new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR" });
  function calc() {
    var bill = Math.max(0, parseFloat($("bill").value) || 0);
    var people = Math.max(1, Math.round(parseFloat($("people").value) || 1));
    var tip = Math.max(0, parseFloat($("tip").value) || 0);
    var tipAmount = bill * tip / 100;
    var total = bill + tipAmount;
    $("tipLabel").textContent = tip + "%";
    $("tipOut").textContent = eur.format(tipAmount);
    $("totalOut").textContent = eur.format(total);
    $("eachOut").textContent = eur.format(total / people);
    document.querySelectorAll("[data-tip]").forEach(function (b) {
      b.className = Number(b.getAttribute("data-tip")) === tip ? "btn-primary" : "";
    });
    return { total: total, each: total / people, people: people };
  }
  ["bill", "people", "tip"].forEach(function (id) { $(id).addEventListener("input", calc); });
  document.querySelectorAll("[data-tip]").forEach(function (b) {
    b.addEventListener("click", function () { $("tip").value = b.getAttribute("data-tip"); calc(); });
  });
  $("ask").addEventListener("click", function () {
    hovi.ask("Which restaurants in Helsinki already include service in their prices?");
  });
  $("copy").addEventListener("click", function () {
    var r = calc();
    hovi.copy("Dinner: " + eur.format(r.total) + " in total, " + eur.format(r.each) + " each for " + r.people + " people.");
  });
  calc();
</script>
`;

/** A text block and a working calculator in the sandboxed html block. */
export const customHtmlFixture: CustomData = {
  kind: "custom",
  title: "Tip and split calculator",
  subtitle: "Dinner for three in Helsinki",
  sources: [
    toSource({
      url: "https://www.visitfinland.com/en/articles/tipping-in-finland/",
      title: "Tipping in Finland | Visit Finland",
      snippet: "Service charges are included in the bill, so tipping is not required.",
    }),
  ],
  blocks: [
    {
      type: "text",
      text: "In Finland, service is **already included** in restaurant prices, so a tip is optional. Rounding up or leaving 5 to 10% for great service is common. Change the bill and the number of people below.",
    },
    { type: "html", title: "Calculator", height: 300, html: TIP_CALCULATOR },
  ],
};

/** Mid-stream: two complete blocks and a chart that has labels but no series yet. */
export const customLoadingFixture: CustomData = {
  kind: "custom",
  title: "Phone plans in Finland",
  stage: "Drawing the price comparison",
  sources: [toSource({ url: "https://www.elisa.fi/liittymat/", title: "Liittymät | Elisa" })],
  blocks: [
    {
      type: "text",
      text: "Unlimited 4G plans from the three main operators, compared on monthly price after any first-year discount.",
    },
    {
      type: "stats",
      items: [
        { label: "Cheapest", value: "€14.90", detail: "DNA, 100 Mbit/s" },
        { label: "Average", value: "€24.60" },
        { label: "Plans compared", value: "11" },
      ],
    },
    {
      type: "chart",
      chartType: "bar",
      title: "Monthly price by operator",
      unit: "€",
      labels: ["Elisa", "DNA", "Telia"],
    },
  ],
};
