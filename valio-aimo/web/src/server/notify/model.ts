/**
 * What each mail says, as data: built by the service from the order, the gate's record or the watch's finding, and
 * rendered by render.ts (pure). Kept in the mail log so the operations page can show the mail again. It never holds
 * the address: the renderer is given only the masked one.
 */

export type MailKind = "confirm" | "receipt" | "sign_off" | "changed";

export type ChangeKind = "cannot_come" | "substituted" | "renewal_held" | "refused" | "declined" | "expired" | "withdrawn" | "confirmed" | "not_confirmed";

export type MailKitchen = { orgId: string; slug: string; name: string };

export type ReceiptLine = {
  productId: string;
  name: string;
  quantity: number;
  packSize: number;
  unit: string;
  unitPriceCents: number;
  lineTotalCents: number;
  depositCents?: number;
  taxRatePct?: number;
  deliveryDate: string;
  /** The product it stands in for, when it is a substitute. */
  insteadOf?: string;
};

export type VatRow = { ratePct: number | null; baseCents: number; vatCents: number | null };

export type DecidedBy =
  | { kind: "agent"; agentName: string; limitCents: number }
  | { kind: "person"; name: string; role: string; at: string; verified: boolean };

export type ReceiptModel = {
  kind: "receipt";
  kitchen: MailKitchen;
  orderId: string;
  committedAt: string;
  deliveryDates: string[];
  lines: ReceiptLine[];
  goodsCents: number;
  depositCents: number;
  vat: { byRate: VatRow[]; vatCents: number; incomplete: boolean };
  /** Goods and deposits, before VAT: what the kitchen's limits are counted in. */
  totalCents: number;
  /** Goods, deposits and the VAT that is known. */
  totalWithVatCents: number;
  decidedBy: DecidedBy;
  /** SHA-256 of the signed confirmation (hex, first 16), so the kitchen can match the receipt it checks. */
  fingerprint?: string;
  links: { order: string; verify: string; keys: string };
};

export type SignOffModel = {
  kind: "sign_off";
  kitchen: MailKitchen;
  orderId: string;
  approvalId: string;
  approver: { name: string; role: string };
  agentName: string;
  totalCents: number;
  deliveryDates: string[];
  lines: { name: string; quantity: number; packSize: number; unit: string; lineTotalCents: number; insteadOf?: string }[];
  /** Why it needs a person: rule id and the gate's own sentence. */
  reasons: { rule: string; reason: string }[];
  holdsUntil?: string;
  links: { order: string };
};

export type ChangedModel = {
  kind: "changed";
  change: ChangeKind;
  kitchen: MailKitchen;
  orderId?: string;
  /** The product concerned (cannot_come, substituted, renewal_held). */
  product?: { name: string; amount?: number; unit?: string };
  /** The day it was needed or delivered. */
  date?: string;
  /** The day it can come again, when the wholesaler says. */
  backOn?: string | null;
  /** cannot_come: why ("not_orderable", "later", "cutoff_passed"); refused: the rule id. */
  reasonCode?: string;
  /** The system's own sentence (English), shown as it came under the translated heading. */
  reason?: string;
  /** cannot_come: the order or the recurring order it concerns. */
  source?: "order" | "standing";
  substitutes?: { rank: "best" | "better" | "good"; name: string; why: string; insidePreferences: boolean }[];
  /** substituted: what went in instead, and whether the agent did it alone. */
  substitute?: { name: string; insidePreferences: boolean };
  outcome?: { status?: string; totalCents?: number; approver?: string };
  /** renewal_held: the usual and the latest amounts. */
  amounts?: { usual: number; latest: number; unit: string };
  totalCents?: number;
  /** declined: who; withdrawn: who took it back. */
  by?: string;
  staged?: boolean;
  links: { order?: string; store: string };
};

export type ConfirmModel = {
  kind: "confirm";
  kitchen: MailKitchen;
  links: { confirm: string };
  hours: number;
};

export type MailModel = ReceiptModel | SignOffModel | ChangedModel | ConfirmModel;

export type RenderContext = {
  lang: "en" | "fi" | "sv";
  /** The masked address, said in the footer. */
  maskedTo: string;
  /** The one-click stop link (absent on the confirmation mail: nothing else is sent until it is confirmed). */
  stopUrl?: string;
  /** Where the kitchen changes the address. */
  settingsUrl: string;
};

export type RenderedMail = { subject: string; preheader: string; html: string; text: string };
