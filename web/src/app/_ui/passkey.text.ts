import { passkeyProblem } from "../_client/api";
import type { Lang } from "../_i18n/lang";

type Problem = { cancelled: boolean; title: string; body: string };

/**
 * `passkeyProblem()` (src/app/_client/api.ts) in the buyer's language. English is that function's own words; Finnish
 * and Swedish follow the same codes. Kept beside the phone pages until `_client/api.ts` takes a language itself.
 */
export function passkeyProblemL(err: unknown, lang: Lang): Problem {
  const en = passkeyProblem(err);
  if (lang === "en") return en;
  const t = PASSKEY_WORDS[lang];
  const e = err as { name?: string; code?: string; message?: string };
  switch (e?.code) {
    case "ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT":
      return { cancelled: false, ...t.screenLock };
    case "ERROR_INVALID_DOMAIN":
    case "ERROR_INVALID_RP_ID":
      return { cancelled: false, ...t.address };
    case "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED":
      return { cancelled: false, ...t.already };
  }
  switch (e?.name) {
    case "NotAllowedError":
      return { cancelled: true, ...t.closed };
    case "AbortError":
      return { cancelled: true, ...t.interrupted };
    case "NotSupportedError":
      return { cancelled: false, ...t.browser };
    case "SecurityError":
      return { cancelled: false, ...t.blocked };
    case "InvalidStateError":
      return { cancelled: false, ...t.already };
  }
  return { cancelled: en.cancelled, title: t.other.title, body: e?.message ? t.phoneSaid(e.message) : t.other.body };
}

type Words = Record<"screenLock" | "address" | "already" | "closed" | "interrupted" | "browser" | "blocked" | "other", { title: string; body: string }> & {
  phoneSaid: (m: string) => string;
};

const PASSKEY_WORDS: Record<"fi" | "sv", Words> = {
  fi: {
    screenLock: { title: "Puhelimessa on oltava näytön lukitus", body: "Pääsyavain tarvitsee Face ID:n, sormenjäljen tai laitteen PIN-koodin. Ota näytön lukitus käyttöön ja yritä uudelleen." },
    address: { title: "Pääsyavaimet eivät toimi tässä osoitteessa", body: "Avaa sivu https-osoitteella (tai localhostissa), niin pääsyavaimet toimivat." },
    already: { title: "Jo käytössä", body: "Tässä puhelimessa on jo pääsyavain tälle keittiölle." },
    closed: { title: "Peruttu", body: "Face ID- tai sormenjälkikysely suljettiin tai sen aika loppui. Mitään ei tapahtunut. Yritä uudelleen napauttamalla." },
    interrupted: { title: "Peruttu", body: "Pääsyavaimen kysely keskeytyi. Yritä uudelleen napauttamalla." },
    browser: { title: "Tämä selain ei tue pääsyavaimia", body: "Kokeile puhelimen omaa selainta (iPhonessa Safari, Androidissa Chrome)." },
    blocked: { title: "Pääsyavaimet on estetty tässä", body: "Avaa sivu https-osoitteella, niin pääsyavaimet toimivat." },
    other: { title: "Pääsyavain ei toiminut", body: "Pääsyavaimen kyselyssä meni jokin pieleen." },
    phoneSaid: (m) => `Puhelin ilmoitti: ${m}`,
  },
  sv: {
    screenLock: { title: "Telefonen behöver ett skärmlås", body: "En inloggnings­nyckel kräver Face ID, fingeravtryck eller enhetens PIN-kod. Slå på skärmlåset och försök igen." },
    address: { title: "Inloggnings­nycklar fungerar inte på den här adressen", body: "Öppna sidan på en https-adress (eller på localhost), så fungerar inloggnings­nycklar." },
    already: { title: "Redan klart", body: "Den här telefonen har redan en inloggnings­nyckel för det här köket." },
    closed: { title: "Avbrutet", body: "Rutan för Face ID eller fingeravtryck stängdes eller tog för lång tid. Ingenting hände. Tryck för att försöka igen." },
    interrupted: { title: "Avbrutet", body: "Rutan för inloggnings­nyckeln avbröts. Tryck för att försöka igen." },
    browser: { title: "Den här webbläsaren kan inte använda inloggnings­nycklar", body: "Prova telefonens egen webbläsare (Safari på iPhone, Chrome på Android)." },
    blocked: { title: "Inloggnings­nycklar är blockerade här", body: "Öppna sidan på en https-adress, så fungerar inloggnings­nycklar." },
    other: { title: "Inloggnings­nyckeln fungerade inte", body: "Något gick fel med inloggnings­nyckeln." },
    phoneSaid: (m) => `Telefonen svarade: ${m}`,
  },
};
