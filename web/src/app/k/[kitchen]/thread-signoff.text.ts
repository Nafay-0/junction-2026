import type { Lang } from "../../_i18n/lang";

/** The sign-off step on the thread's waiting gate card: what is true about the signer's devices, and the two ways on. */
export const THREAD_SIGNOFF_TEXT: Record<Lang, {
  checking: string;
  hasDevice: string;
  hasDeviceHere: string;
  noDeviceHere: string;
  noDevice: string;
  onTheirPhone: string;
  signHere: string;
  addAndSign: string;
  signNow: string;
  signing: string;
  toPhone: string;
  hidePhone: string;
  phoneHint: string;
  phoneAddHint: string;
  openOnPhone: string;
  signed: string;
  failed: string;
  otherSigner: (name: string) => string;
}> = {
  en: {
    checking: "Checking who can sign…",
    hasDevice: "Signs with their passkey on a signing device of the kitchen.",
    hasDeviceHere: "This device can sign it: the passkey is bound to this exact order.",
    noDeviceHere: "No signing device yet. Add this device's passkey and sign here in one step, or on your phone.",
    noDevice: "No signing device yet: the signer adds one from Agent and rules, then signs.",
    onTheirPhone: "Asked on their phone, with their passkey.",
    signHere: "Sign with this device",
    addAndSign: "Add this device and sign",
    signNow: "Sign now",
    signing: "Waiting for the passkey…",
    toPhone: "Send to my phone",
    hidePhone: "Hide the code",
    phoneHint: "Scan with the phone of the person who OKs it: it opens this order.",
    phoneAddHint: "Scan with your phone: it adds the phone as a device that can OK orders, then opens this order.",
    openOnPhone: "Or open this address on the phone",
    signed: "OK given. The order goes to the wholesaler now.",
    failed: "Not signed",
    otherSigner: (name) => `${name} signs this one; it cannot be signed from this account.`,
  },
  fi: {
    checking: "Tarkistetaan, kuka voi hyväksyä…",
    hasDevice: "Hyväksyy pääsyavaimella keittiön hyväksyntälaitteella.",
    hasDeviceHere: "Tällä laitteella voi hyväksyä: pääsyavain sidotaan juuri tähän tilaukseen.",
    noDeviceHere: "Hyväksyntälaitetta ei ole vielä. Lisää tämän laitteen pääsyavain ja hyväksy tässä samalla kertaa, tai puhelimella.",
    noDevice: "Hyväksyntälaitetta ei ole vielä: hyväksyjä lisää sen kohdasta Agentti ja säännöt ja hyväksyy sitten.",
    onTheirPhone: "Kysytty hänen puhelimestaan, pääsyavaimella.",
    signHere: "Hyväksy tällä laitteella",
    addAndSign: "Lisää tämä laite ja hyväksy",
    signNow: "Hyväksy nyt",
    signing: "Odotetaan pääsyavainta…",
    toPhone: "Lähetä puhelimeeni",
    hidePhone: "Piilota koodi",
    phoneHint: "Skannaa hyväksyjän puhelimella: se avaa tämän tilauksen hyväksynnän.",
    phoneAddHint: "Skannaa puhelimellasi: se lisää puhelimen hyväksyntälaitteeksi ja avaa sitten tämän tilauksen hyväksynnän.",
    openOnPhone: "Tai avaa tämä osoite puhelimessa",
    signed: "Hyväksytty. Tilaus lähtee nyt tukulle.",
    failed: "Ei hyväksytty",
    otherSigner: (name) => `Tämän hyväksyy ${name}; sitä ei voi hyväksyä tältä tililtä.`,
  },
  sv: {
    checking: "Kontrollerar vem som kan godkänna…",
    hasDevice: "Godkänner med sin nyckel på en av köksenhetens godkännandeenheter.",
    hasDeviceHere: "Den här enheten kan godkänna: nyckeln binds till exakt den här ordern.",
    noDeviceHere: "Ingen godkännandeenhet ännu. Lägg till den här enhetens nyckel och godkänn här i ett steg, eller på telefonen.",
    noDevice: "Ingen godkännandeenhet ännu: den som godkänner lägger till en under Agent och regler och godkänner sedan.",
    onTheirPhone: "Tillfrågad på sin telefon, med sin nyckel.",
    signHere: "Godkänn med den här enheten",
    addAndSign: "Lägg till enheten och godkänn",
    signNow: "Godkänn nu",
    signing: "Väntar på nyckeln…",
    toPhone: "Skicka till min telefon",
    hidePhone: "Dölj koden",
    phoneHint: "Skanna med telefonen hos den som godkänner: den öppnar godkännandet av den här ordern.",
    phoneAddHint: "Skanna med din telefon: den läggs till som godkännandeenhet och öppnar sedan godkännandet av den här ordern.",
    openOnPhone: "Eller öppna den här adressen på telefonen",
    signed: "Godkänd. Ordern går nu till grossisten.",
    failed: "Inte godkänd",
    otherSigner: (name) => `${name} godkänner den här; den kan inte godkännas från det här kontot.`,
  },
};
