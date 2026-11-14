import { defineText } from "../../_i18n/lang";

type StationWords = { Request: string; Lookup: string; Options: string; Price: string; Gate: string; "Sign-off": string; Order: string };
type StationState = "done" | "current" | "stopped" | "pending" | "skipped";

/** The order lane: the station strip and the lane rows. Station names stay short: the phone strip shows one large. */
export const UI_TEXT = defineText({
  en: {
    stations: { Request: "Request", Lookup: "Lookup", Options: "Options", Price: "Price", Gate: "Gate", "Sign-off": "Sign-off", Order: "Order" } as StationWords,
    whereLabel: "Where the request is",
    srStep: (n: number, st: StationState) =>
      `, step ${n}: ${st === "current" ? "here now" : st === "stopped" ? "stopped, a person must decide" : st === "done" ? "done" : st === "skipped" ? "not needed" : "not reached yet"}`,
    compactStep: (n: number, stopped: boolean) => `step ${n} of 7${stopped ? ", stopped for a person" : ""}`,
    nothingYet: "nothing asked yet",
    srLaneStep: (n: number) => `Step ${n}: `,
    fold: "Fold",
    open: "Open",
  },
  fi: {
    stations: { Request: "Pyyntö", Lookup: "Haku", Options: "Vaihtoehdot", Price: "Hinta", Gate: "Portti", "Sign-off": "Hyväksyntä", Order: "Tilaus" },
    whereLabel: "Missä vaiheessa pyyntö on",
    srStep: (n: number, st: StationState) =>
      `, vaihe ${n}: ${st === "current" ? "tässä nyt" : st === "stopped" ? "pysäytetty, ihmisen on päätettävä" : st === "done" ? "valmis" : st === "skipped" ? "ei tarvita" : "ei vielä"}`,
    compactStep: (n: number, stopped: boolean) => `vaihe ${n}/7${stopped ? ", odottaa ihmistä" : ""}`,
    nothingYet: "ei vielä pyyntöä",
    srLaneStep: (n: number) => `Vaihe ${n}: `,
    fold: "Sulje",
    open: "Avaa",
  },
  sv: {
    stations: { Request: "Förfrågan", Lookup: "Sökning", Options: "Alternativ", Price: "Pris", Gate: "Grinden", "Sign-off": "Godkännande", Order: "Beställning" },
    whereLabel: "Var förfrågan är",
    srStep: (n: number, st: StationState) =>
      `, steg ${n}: ${st === "current" ? "här nu" : st === "stopped" ? "stoppad, en person måste avgöra" : st === "done" ? "klar" : st === "skipped" ? "behövs inte" : "inte nådd än"}`,
    compactStep: (n: number, stopped: boolean) => `steg ${n} av 7${stopped ? ", väntar på en person" : ""}`,
    nothingYet: "ingen förfrågan än",
    srLaneStep: (n: number) => `Steg ${n}: `,
    fold: "Fäll ihop",
    open: "Öppna",
  },
});
