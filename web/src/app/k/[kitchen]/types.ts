// Wire shapes the console reads. Type-only imports from core: erased at build, nothing from core ships to the browser.
import type { IntakeView } from "@/core/intake";
import type { kitchenView } from "@/core/kitchen";
import type { LedgerEntry } from "@/core/ledger";
import type { PublicOrder } from "@/core/orders";
import type { ConsoleKitchenInfo } from "@/server/console-kitchens";

export type Step = IntakeView;
export type Order = PublicOrder;
export type KitchenMemory = ReturnType<typeof kitchenView>;
export type Entry = LedgerEntry;
export type KitchenInfo = ConsoleKitchenInfo;
export type KitchenChoice = { slug: string; name: string; kind: "demo" | "visitor"; approverName?: string };

export type LedgerReply = {
  verification: { ok: boolean; length?: number; message?: string };
  catalog: { searches: number; liveCalls: number; productsPriced: number };
  entries: LedgerEntry[];
};

export type ApprovalQr = { mode: "passkey" | "demo_link" | "view_only"; approver: { name: string; role: string }; status: string; url: string; qrSvg: string };
