/**
 * The rules the agent cannot talk its way past. Plain code, no model: every browser step goes
 * through `judge` before it happens.
 *
 * Three outcomes:
 * - "block": never done by the agent. Payment details, pay buttons, passwords, one-time codes.
 *   The agent is told to hand the page to the user.
 * - "approve": done only after the user says yes in the chat. Anything that submits, sends, books,
 *   posts, deletes or changes something on the user's behalf.
 * - "allow": everything else. Reading, navigating, searching, filling in a form.
 *
 * The lists are heuristics and say so: they err towards asking. They cover the languages the
 * demo is likely to meet (English, Finnish, Swedish, German, French, Spanish, Italian).
 */

/** What the page tells us about the element a step targets. Gathered in the page, judged here. */
export type Target = {
  tag: string;
  /** The `type` attribute of an input or button, lower case. */
  type: string;
  role: string;
  autocomplete: string;
  /** Visible text, value or label of a button or link, trimmed. */
  text: string;
  /** The best plain name for it: its label, placeholder or text. Used in captions. */
  name: string;
  /** Name, id, placeholder and label of a field, joined. Used to recognise what it is for. */
  hint: string;
  /** Host and full address of the frame the element lives in. */
  frameHost: string;
  frameUrl: string;
  /** The element is inside a frame embedded in the page. */
  inFrame: boolean;
  /** The element submits a form: a submit button, or a button inside a form. */
  submits: boolean;
  /** The text of the submit button of the form the element is in, if any: what pressing Enter presses. */
  formSubmitText: string;
  /** The element's form (or the page, when it has none) has a visible card field. */
  nearPayment: boolean;
  /** The element sits inside a search form or is a search field. */
  search: boolean;
  /** The element belongs to a cookie or consent banner. */
  consent: boolean;
};

export type Verdict =
  | { decision: "allow" }
  | { decision: "approve"; reason: string }
  | { decision: "block"; kind: "payment" | "password" | "code"; reason: string };

/** Hosts whose whole page is a payment or bank step. The agent does nothing there. */
const PAYMENT_HOSTS =
  /(^|\.)(paypal\.com|checkout\.stripe\.com|buy\.stripe\.com|pay\.google\.com|payments\.google\.com|klarna\.com|pay\.amazon\.[a-z.]+|adyen\.com|checkout\.com|worldpay\.com|paytrail\.com|checkout\.fi|nets\.eu|netaxept\.[a-z.]+|mobilepay\.(fi|dk)|vipps\.no|swish\.nu|verifone\.[a-z.]+|bambora\.[a-z.]+|mollie\.com|payu\.[a-z.]+|sumup\.com|squareup\.com|braintreegateway\.com|3dsecure\.io|securecode\.com|trustly\.com|revolut\.me|wise\.com)$/i;

/** Frames that hold card fields on someone else's checkout page. */
const PAYMENT_FRAMES =
  /js\.stripe\.com|checkoutshopper-[a-z]+\.adyen\.com|assets\.braintreegateway\.com|js\.checkout\.com|x\.klarnacdn\.net|pay\.google\.com|web\.squarecdn\.com|secure\.worldpay|hostedfields|securedfields|hosted-fields/i;

const CARD_FIELD =
  /card.?(number|no\b|num)|cardnumber|cc.?(num|number|exp|csc|cvc)|credit.?card|debit.?card|kortin?.?numero|korttinumero|kortnummer|kartennummer|num[eé]ro de carte|n[uú]mero de (la )?tarjeta|numero (della )?carta|\bcvv2?\b|\bcvc2?\b|\bcsc\b|security.?code|turvakoodi|turvaluku|s[äa]kerhetskod|pr[üu]fziffer|cryptogramme|expir|voimassa|giltig|g[üu]ltig|\bmm\s*\/\s*(yy|aa|jj|vv)|\biban\b|\bbic\b|swift.?code|account.?number|tilinumero|kontonummer|routing.?number|sort.?code/i;

const CODE_FIELD = /one.?time|otp\b|verification.?code|security.?code sent|2fa|two.?factor|auth(entication)? code|sms.?code|vahvistuskoodi|verifieringskod|best[äa]tigungscode/i;

/** Buttons that take money. Never pressed by the agent. */
const PAY_BUTTON =
  /^\W*(pay\b|pay now|pay with|pay by|pay and|pay [€$£]|place (your |the |my )?order|buy now|buy with|buy it now|purchase\b|complete (the |your |my )?(purchase|order|payment)|confirm (and|&) pay|confirm (the |your |my )?(payment|purchase|order and pay)|submit (the |your |my )?payment|make (a |the )?payment|order (now )?(and|&) pay|order with obligation|maksa\b|maksa nyt|siirry maksamaan|tilaa ja maksa|vahvista (maksu|ja maksa)|osta nyt|betala\b|betala nu|slutf[öo]r k[öo]p|k[öo]p nu|jetzt kaufen|zahlungspflichtig bestellen|kostenpflichtig bestellen|jetzt bezahlen|bezahlen\b|payer\b|payer maintenant|acheter maintenant|commander et payer|pagar\b|pagar ahora|comprar ahora|paga\b|paga ora|acquista ora)/i;

const WALLET_BUTTON = /apple\s?pay|google\s?pay|\bg\s?pay\b|paypal|klarna|mobilepay|\bswish\b|\bvipps\b|shop\s?pay|amazon\s?pay|\balipay\b|\bideal\b/i;

/** Buttons that do something on the user's behalf. Pressed only with the user's approval. */
const COMMIT_BUTTON =
  /\b(submit|send|confirm|complete|finish|finali[sz]e|book(?! a | an | now$)|reserve(?! a | an )|request (a )?(booking|reservation|quote|callback)|place|apply(?! (the |a )?(filter|coupon|code|promo|discount|voucher))|register|sign up|create (an |my )?account|join|subscribe|donate|upgrade|start (my |your |free )?trial|post|publish|share|tweet|comment|reply|vote|rsvp|delete|remove (my )?account|cancel (my |the |this )?(booking|order|subscription|reservation|membership)|unsubscribe|save changes|save (my |the )?(settings|preferences|profile)|accept|agree|i agree|order now|vahvista|varaa|l[äa]het[äa]|tilaa|rekister[öo]idy|hyv[äa]ksy|poista|tallenna|julkaise|boka|bekr[äa]fta|skicka|best[äa]ll|registrera|best[äa]tigen|buchen|senden|absenden|bestellen|registrieren|confirmer|r[ée]server|envoyer|commander|s'inscrire|confirmar|reservar|enviar|registrarse|conferma|prenota|invia)\b/i;

/** Buttons that only move on to the next page or step. Going to the checkout is not yet buying. */
const MOVES_ON =
  /^\W*(go to|continue to|proceed to|on to|view|see|show|open|next|continue|back|previous|edit|change|choose|select|siirry|jatka|seuraava|edellinen|n[äa]yt[äa]|muokkaa|valitse|forts[äa]tt|n[äa]sta|visa|[äa]ndra|v[äa]lj|weiter|zur[üu]ck|ansehen|[äa]ndern|continuer|suivant|voir|modifier|continuar|siguiente|ver|avanti|vedi)\b/i;

/**
 * On a cookie or consent banner, only saying yes is the user's call. Refusing, keeping to the
 * necessary cookies, opening the details and flipping the switches are all fine.
 */
const CONSENT_YES =
  /accept|allow all|allow cookies|agree|^\W*(ok|okay|got it|yes|continue)\W*$|hyv[äa]ksy|salli kaikki|selv[äa]|godk[äa]nn|till[åa]t alla|acceptera|akzeptieren|alle (zulassen|akzeptieren)|zustimmen|einverstanden|accepter|tout accepter|j'accepte|aceptar|acepto|accetta|accetto/i;
const CONSENT_NO = /necessary|essential|required only|reject|decline|deny|refuse|kiell[äa]|hylk[äa][äa]|v[äa]ltt[äa]m[äa]tt[öo]m|avvisa|n[öo]dv[äa]ndiga|ablehnen|notwendige|erforderliche|refuser|n[ée]cessaires|rechazar|necesarias|rifiuta|necessari/i;

const host = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
};

/** The whole page is a payment or bank step. */
export function isPaymentHost(url: string): boolean {
  return PAYMENT_HOSTS.test(host(url));
}

/** A frame that holds card fields. */
export function isPaymentFrame(url: string): boolean {
  return PAYMENT_FRAMES.test(url) || isPaymentHost(url);
}

export function isPasswordField(t: Target): boolean {
  return t.type === "password" || t.autocomplete === "current-password" || t.autocomplete === "new-password";
}

export function isCodeField(t: Target): boolean {
  return t.autocomplete === "one-time-code" || CODE_FIELD.test(t.hint);
}

export function isPaymentField(t: Target): boolean {
  return t.autocomplete.startsWith("cc-") || CARD_FIELD.test(t.hint) || PAYMENT_HOSTS.test(t.frameHost) || (t.inFrame && PAYMENT_FRAMES.test(t.frameUrl));
}

/** A field whose value must never reach the model or the log. */
export function isSensitiveField(t: Target): boolean {
  return isPasswordField(t) || isCodeField(t) || isPaymentField(t);
}

/** The same test on a field's visible name alone, for redacting what the model reads. */
export function isSensitiveName(name: string): boolean {
  return CARD_FIELD.test(name) || CODE_FIELD.test(name) || /pass(word|code|phrase)|salasana|l[öo]senord|kennwort|passwort|mot de passe|contrase[ñn]a|\bpin\b/i.test(name);
}

const HANDOVER_HINT = {
  payment: 'Call requestUserAction with kind "payment": the user pays themselves in the live browser, or stops there.',
  password: 'Call requestUserAction with kind "login": the user signs in themselves in the live browser.',
  code: 'Call requestUserAction with kind "verification": the user enters the code themselves in the live browser.',
};

export type Step = {
  action: "click" | "type" | "select" | "press" | "hover";
  /** The model says this step submits, sends, books, posts, deletes or changes something for the user. */
  commits?: boolean;
  /** "type" with Enter afterwards, or "press" with Enter. */
  enter?: boolean;
};

/** Decide a step. `pageUrl` is the address of the page as a whole. */
export function judge(step: Step, target: Target | null, pageUrl: string): Verdict {
  if (isPaymentHost(pageUrl)) {
    return { decision: "block", kind: "payment", reason: `This is a payment page (${host(pageUrl)}). You never act on payment pages. ${HANDOVER_HINT.payment}` };
  }
  if (!target) return step.commits ? { decision: "approve", reason: "The agent says this step acts on your behalf." } : { decision: "allow" };

  const fills = step.action === "type" || step.action === "select";
  if (fills || step.action === "click") {
    if (isPaymentField(target) && (fills || target.tag === "input" || target.tag === "iframe")) {
      return { decision: "block", kind: "payment", reason: `"${label(target)}" is a payment field. You never enter payment details. ${HANDOVER_HINT.payment}` };
    }
  }
  if (fills) {
    if (isPasswordField(target)) return { decision: "block", kind: "password", reason: `"${label(target)}" is a password field. You never type passwords. ${HANDOVER_HINT.password}` };
    if (isCodeField(target)) return { decision: "block", kind: "code", reason: `"${label(target)}" takes a one-time code. ${HANDOVER_HINT.code}` };
  }

  // Pressing a button, or pressing Enter in a form (which presses its submit button).
  const viaEnter = step.enter === true && !target.search;
  if (step.action === "click" || viaEnter) {
    const text = step.action === "click" ? target.text : target.formSubmitText;
    if (PAY_BUTTON.test(text) || (WALLET_BUTTON.test(text) && text.length < 40)) {
      return { decision: "block", kind: "payment", reason: `"${clip(text)}" takes payment. You never pay. ${HANDOVER_HINT.payment}` };
    }
    // Submitting a form that holds card fields is paying, whatever the button says.
    if (target.nearPayment && (viaEnter || target.submits)) {
      return { decision: "block", kind: "payment", reason: `This form takes card details, so submitting it is paying. You never pay. ${HANDOVER_HINT.payment}` };
    }
    if (step.action === "click" && target.consent) {
      return CONSENT_YES.test(text) && !CONSENT_NO.test(text) ? { decision: "approve", reason: "This accepts cookies or terms on your behalf." } : { decision: "allow" };
    }
    if (step.commits) return { decision: "approve", reason: "This step acts on your behalf." };
    const isButton = viaEnter || target.submits || target.tag === "button" || target.role === "button";
    if (text && isButton && COMMIT_BUTTON.test(text) && !MOVES_ON.test(text)) {
      return { decision: "approve", reason: `"${clip(text)}" looks like it submits or changes something on your behalf.` };
    }
  } else if (step.commits) {
    return { decision: "approve", reason: "This step acts on your behalf." };
  }
  return { decision: "allow" };
}

const clip = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const label = (t: Target) => clip(t.name || t.text || t.tag, 50);
