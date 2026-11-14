// Wire shapes the console reads. Type-only imports from core: erased at build, nothing from core ships to the browser.
import type { IntakeView } from "@/core/intake";
import type { kitchenView } from "@/core/kitchen";
import type { LedgerEntry } from "@/core/ledger";
import type { PublicOrder } from "@/core/orders";
import type { ConsoleKitchenInfo } from "@/server/console-kitchens";
import type { CutoffReply, LiveReply, LiveResult, Overview, PortalOrder, PortalRequest, Standing, WeekNumbers } from "@/server/kitchen-portal";
import type { Product as CoreProduct } from "@/core/catalog";
import type { ProductPage as ServerProductPage, ShopCategory, ShopDepartment } from "@/server/kitchen-catalog";

export type Step = IntakeView;
export type Order = PublicOrder;
export type KitchenMemory = ReturnType<typeof kitchenView>;
export type Entry = LedgerEntry;
export type KitchenInfo = ConsoleKitchenInfo;
export type KitchenChoice = { slug: string; name: string; kind: "demo" | "visitor" | "account"; approverName?: string };

export type LedgerReply = {
  verification: { ok: boolean; length?: number; message?: string };
  catalog: { searches: number; liveCalls: number; productsPriced: number };
  entries: LedgerEntry[];
};

export type ApprovalQr = { mode: "passkey" | "demo_link" | "enrol" | "view_only" | "no_device"; approver: { name: string; role: string }; status: string; orderId?: string; url: string; qrSvg: string };

// ---------- the kitchen portal ----------
export type { CutoffReply, LiveReply, LiveResult, Overview, PortalOrder, PortalRequest, Standing, WeekNumbers, ShopCategory, ShopDepartment };
/** A product as the shop shows it: master data, plus its category's label when the list route adds it. */
export type Product = CoreProduct & { shopCategory?: { id: string; label: string } };
export type ProductPage = ServerProductPage;

export type QuoteBundle = NonNullable<Step["quote"]>;
export type CatalogReply = { products: Product[]; source: { kind: "valio" | "seed"; products: number | null }; ms: number; liveCalls: number };
export type ConnectReply = { mcpUrl: string; openApiUrl: string; catalogUrl: string; jwksUrl: string; agentId: string; orgId: string; mandate: string; mandateValidUntil: string };
