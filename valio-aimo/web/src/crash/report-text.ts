import type { FinalReport } from "./types";

/**
 * The model runner tells a model to end with a short message to the buyer; a model may do that instead of calling
 * finish. This reads such a message as a report, conservatively: order ids are taken only as written, the status
 * from plain phrases, the total from a euro amount. A report read this way is marked reportSource "final_text" in
 * the trajectory, and gets no shortfall or date unless the words carry one in a recognisable form.
 */
export function reportFromText(text: string, knownOrderIds: string[]): FinalReport {
  const t = text.toLowerCase();
  const orderIds = knownOrderIds.filter((id) => text.includes(id));
  const total = text.match(/(?:€|eur\s?)\s?(\d{1,3}(?:[ ,]\d{3})*(?:[.,]\d{2})?)|(\d{1,3}(?:[ ,]\d{3})*(?:[.,]\d{2})?)\s?(?:€|eur)/i);
  const totalCents = total ? Math.round(parseFloat((total[1] ?? total[2]).replace(/[ ,](?=\d{3})/g, "").replace(",", ".")) * 100) : undefined;
  const date = text.match(/\b(20\d\d-\d\d-\d\d)\b/)?.[1];
  const short = text.match(/(\d+(?:[.,]\d+)?)\s?(l|litres?|liters?|kg)\b[^.]*\b(short|missing|shortfall|not covered)/i);
  let status: FinalReport["status"];
  if (/(cannot|can't|could not|couldn't|unable|not possible|no order (was|has been) placed|did not (place|order)|didn't (place|order)|nothing was ordered)/.test(t) && orderIds.length === 0) status = "not_ordered";
  else if (/(awaiting|waiting for|pending) (sign-?off|approval)|needs? (sign-?off|approval)/.test(t)) status = "awaiting_sign_off";
  else if (/(partial|shortfall|short by|only \d|missing \d|could only)/.test(t)) status = "partially_ordered";
  else status = orderIds.length ? "ordered" : "not_ordered";
  return {
    status,
    orderIds,
    ...(totalCents !== undefined && orderIds.length ? { totalCents } : {}),
    ...(short ? { shortfall: { quantity: parseFloat(short[1].replace(",", ".")), unit: short[2].toLowerCase().startsWith("k") ? "kg" : "L" } } : {}),
    ...(date && status === "not_ordered" ? { earliestPossibleDelivery: date } : {}),
    message: text.slice(0, 4000) || "(no message)",
  };
}
