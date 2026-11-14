import { DockError } from "@/core/errors";
import { cardId } from "./cards";
import { record, type TurnRun } from "./pipeline";
import { createSheet, currentSheet, editSheet, openAlternatives, pickAlternative, placeSheet } from "./sheet";
import type { ThreadAction } from "./types";
import { runHomeAction } from "./home";

/**
 * The widgets' actions (docs/agent-thread.md "Widgets"), each one a turn: the order sheet, the alternatives picker,
 * the options card's "edit before ordering", the menu builder (menu.ts). Returns false for an action that is not a
 * widget's (the engine's own runAction handles it). The home's actions are added here as they land.
 */
export async function runWidget(run: TurnRun, a: ThreadAction, words?: string): Promise<boolean> {
  void words;
  switch (a.type) {
    case "sheet_packs":
      await editSheet(run, a.sheetId, a.version, { kind: "packs", lineId: a.lineId, packs: a.packs });
      return true;
    case "sheet_day":
      await editSheet(run, a.sheetId, a.version, { kind: "day", date: a.date });
      return true;
    case "sheet_swap":
      await editSheet(run, a.sheetId, a.version, { kind: "swap", lineId: a.lineId, productId: a.productId });
      return true;
    case "sheet_remove":
      await editSheet(run, a.sheetId, a.version, { kind: "remove", lineId: a.lineId });
      return true;
    case "sheet_add": {
      const packs = a.packs ?? 1;
      const s = a.sheetId ? { sheetId: a.sheetId, version: a.version } : currentSheet(run);
      if (s) await editSheet(run, s.sheetId, a.sheetId ? a.version : undefined, { kind: "add", productId: a.productId, packs });
      else {
        const [p] = await run.rt.catalog.searchProducts({ ids: [a.productId], limit: 1 });
        if (!p) throw new DockError(404, "product_not_found", "That product is not in the assortment.");
        await createSheet(run, { lines: [{ productId: p.id, packs }], text: `${packs} × ${p.name}`, category: p.category, asked: [p.id] });
      }
      return true;
    }
    case "sheet_alternatives":
      await openAlternatives(run, a.sheetId, a.lineId);
      return true;
    case "alt_rerank": {
      const [sheetPart, linePart] = a.pickerId.replace(/^pk_/, "").split("_");
      await openAlternatives(run, `sh_${sheetPart}`, `ln_${linePart}`, a.chip);
      return true;
    }
    case "alt_pick":
      await pickAlternative(run, a.pickerId, a.productId);
      return true;
    case "sheet_place":
      await placeSheet(run, a.sheetId, a.version);
      return true;
    case "sheet_from_option": {
      // The option the buyer wants to adjust, as a sheet: its lines, its day; nothing is quoted until they confirm.
      const s = await run.rt.dock.intake.get(run.session, a.requestId);
      const o = s.options.find((x) => x.optionId === a.optionId);
      if (!o || s.state !== "options_ready") throw new DockError(409, "turn_card_stale", "That option is no longer open.", "intake_sequence");
      record(run, "sheet_from_option", `The buyer chose to adjust ${o.optionId} before ordering.`, { optionId: o.optionId }, a.requestId);
      await createSheet(run, {
        lines: o.quoteLines.map((l, n) => ({ productId: l.productId, packs: l.quantity, ...(l.substituteFor ? { substituteFor: l.substituteFor } : n === 0 && o.alternative?.for && o.alternative.for !== l.productId ? { substituteFor: o.alternative.for } : {}) })),
        deliveryDate: o.deliveryDate,
        text: s.need.text ?? o.title,
        category: s.family,
        ...(s.need.item.productId ? { asked: [s.need.item.productId] } : {}),
      });
      return true;
    }
    case "menu_choose":
    case "menu_covers":
    case "menu_day":
    case "menu_line_swap":
    case "menu_line_have":
    case "menu_line_per_cover":
    case "menu_accept":
    case "menu_to_sheet": {
      const { runMenuAction } = await import("./menu");
      return runMenuAction(run, a);
    }
    default:
      return runHomeAction(run, a);
  }
}

export { cardId };
