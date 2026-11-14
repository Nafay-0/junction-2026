"use client";

import * as React from "react";
import { MotionConfig } from "motion/react";
import { useTheme } from "next-themes";
import { useClientValue } from "@/lib/use-client";
import { Actions } from "@/components/widgets/actions";
import { Clarify } from "@/components/widgets/clarify";
import { Comparison } from "@/components/widgets/comparison";
import { Custom } from "@/components/widgets/custom";
import { KeyFacts } from "@/components/widgets/facts";
import { Flights } from "@/components/widgets/flights";
import { Hotels } from "@/components/widgets/hotels";
import { Images } from "@/components/widgets/images";
import { LocationRequest } from "@/components/widgets/location-request";
import { PredictionMarket } from "@/components/widgets/market";
import { PlacesMap } from "@/components/widgets/places-map";
import { Plan } from "@/components/widgets/plan";
import { Products } from "@/components/widgets/products";
import { Research } from "@/components/widgets/research";
import { Sift } from "@/components/widgets/sift";
import { JobCard } from "@/components/widgets/job-card";
import { Stocks } from "@/components/widgets/stocks";
import { Weather } from "@/components/widgets/weather";
import { actionsFixture, actionsLoadingFixture } from "@/lib/widgets/fixtures/actions";
import { clarifyAnswerFixture, clarifyFixture } from "@/lib/widgets/fixtures/clarify";
import { comparisonFixture, comparisonLoadingFixture } from "@/lib/widgets/fixtures/comparison";
import { customChartsFixture, customFixture, customHtmlFixture, customLoadingFixture } from "@/lib/widgets/fixtures/custom";
import { factsFixture, factsLoadingFixture } from "@/lib/widgets/fixtures/facts";
import { flightsFixture, flightsLoadingFixture } from "@/lib/widgets/fixtures/flights";
import { hotelsFixture, hotelsLoadingFixture } from "@/lib/widgets/fixtures/hotels";
import { imagesFixture, imagesLoadingFixture } from "@/lib/widgets/fixtures/images";
import { jobCreatedFixture, jobDeletedFixture, jobListFixture, jobLoadingFixture, jobRefusedFixture } from "@/lib/widgets/fixtures/job";
import { marketFixture, marketLoadingFixture } from "@/lib/widgets/fixtures/market";
import { placesFixture, placesLoadingFixture } from "@/lib/widgets/fixtures/places-map";
import { planFixture } from "@/lib/widgets/fixtures/plan";
import { productsFixture, productsLoadingFixture } from "@/lib/widgets/fixtures/products";
import { researchFixture, researchLoadingFixture } from "@/lib/widgets/fixtures/research";
import { siftFixture, siftLoadingFixture } from "@/lib/widgets/fixtures/sift";
import { stocksClosedFixture, stocksFixture, stocksLoadingFixture } from "@/lib/widgets/fixtures/stocks";
import { weatherFixture, weatherLoadingFixture } from "@/lib/widgets/fixtures/weather";

/**
 * Every widget with sample data, for design review.
 * /dev/widgets shows all; ?only=flights,hotels narrows it; ?loading=1 shows loading states;
 * ?still=1 turns animation off (for screenshots).
 */
export default function WidgetGallery() {
  const query = useClientValue(() => window.location.search, "");
  const params = new URLSearchParams(query);
  const only = params.get("only");
  const still = params.get("still") === "1";
  const [toggled, setToggled] = React.useState<boolean | null>(null);
  const loading = toggled ?? params.get("loading") === "1";
  const setLoading = (next: (value: boolean) => boolean) => setToggled(next(loading));
  const { resolvedTheme, setTheme } = useTheme();

  const items: Array<[string, React.ReactNode]> = [
    ["plan", <Plan key="plan" data={planFixture} />],
    ["clarify", <Clarify key="clarify" input={clarifyFixture} onSubmit={() => {}} />],
    ["clarify-answered", <Clarify key="clarify-answered" input={clarifyFixture} answer={clarifyAnswerFixture} />],
    ["location", <LocationRequest key="location" input={{ reason: "to find cafes within walking distance of you" }} approximatePlace="Helsinki, Finland" />],
    [
      "location-answered",
      <LocationRequest
        key="location-answered"
        input={{}}
        approximatePlace="Helsinki, Finland"
        answer={{ status: "granted", lat: 60.1841, lng: 24.8301, accuracyM: 18, label: "Otaniemi, Espoo, Finland", country: "FI", at: 0 }}
      />,
    ],
    ["places", <PlacesMap key="places" data={loading ? placesLoadingFixture : placesFixture} loading={loading} />],
    ["weather", <Weather key="weather" data={loading ? weatherLoadingFixture : weatherFixture} loading={loading} />],
    ["flights", <Flights key="flights" data={loading ? flightsLoadingFixture : flightsFixture} loading={loading} />],
    ["hotels", <Hotels key="hotels" data={loading ? hotelsLoadingFixture : hotelsFixture} loading={loading} />],
    ["products", <Products key="products" data={loading ? productsLoadingFixture : productsFixture} loading={loading} />],
    ["stocks", <Stocks key="stocks" data={loading ? stocksLoadingFixture : stocksFixture} loading={loading} />],
    ["stocks-closed", <Stocks key="stocks-closed" data={stocksClosedFixture} />],
    ["job", <JobCard key="job" data={loading ? jobLoadingFixture : jobCreatedFixture} loading={loading} />],
    ["job-list", <JobCard key="job-list" data={jobListFixture} />],
    ["job-deleted", <JobCard key="job-deleted" data={jobDeletedFixture} />],
    ["job-refused", <JobCard key="job-refused" data={jobRefusedFixture} />],
    ["market", <PredictionMarket key="market" data={loading ? marketLoadingFixture : marketFixture} loading={loading} />],
    ["images", <Images key="images" data={loading ? imagesLoadingFixture : imagesFixture} loading={loading} />],
    ["research", <Research key="research" data={loading ? researchLoadingFixture : researchFixture} loading={loading} />],
    ["custom", <Custom key="custom" data={loading ? customLoadingFixture : customFixture} loading={loading} onAsk={(prompt) => window.alert(`Would send: ${prompt}`)} />],
    ["custom-charts", <Custom key="custom-charts" data={customChartsFixture} />],
    ["custom-html", <Custom key="custom-html" data={customHtmlFixture} onAsk={(prompt) => window.alert(`Would send: ${prompt}`)} />],
    ["sift", <Sift key="sift" data={loading ? siftLoadingFixture : siftFixture} loading={loading} />],
    ["comparison", <Comparison key="comparison" data={loading ? comparisonLoadingFixture : comparisonFixture} loading={loading} />],
    ["facts", <KeyFacts key="facts" data={loading ? factsLoadingFixture : factsFixture} loading={loading} />],
    ["actions", <Actions key="actions" data={loading ? actionsLoadingFixture : actionsFixture} loading={loading} />],
  ];

  return (
    <MotionConfig reducedMotion={still ? "always" : "user"}>
    <main className={"mx-auto flex w-full max-w-[760px] flex-col gap-6 px-4 py-6" + (still ? " still" : "")}>
      <div className="flex items-center justify-between gap-3 text-[0.8rem] text-muted-foreground">
        <span className="font-medium text-foreground">Widget gallery</span>
        <span className="flex gap-2">
          <button className="rounded-full border border-border px-3 py-1 hover:bg-muted" onClick={() => setLoading((v) => !v)}>
            {loading ? "Show data" : "Show loading"}
          </button>
          <button className="rounded-full border border-border px-3 py-1 hover:bg-muted" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
            Toggle theme
          </button>
        </span>
      </div>
      {items
        .filter(([name]) => !only || only.split(",").includes(name))
        .map(([name, node]) => (
          <section key={name} className="flex flex-col gap-2">
            <h2 className="text-[0.7rem] font-medium tracking-wider text-subtle uppercase">{name}</h2>
            {node}
          </section>
        ))}
    </main>
    </MotionConfig>
  );
}
