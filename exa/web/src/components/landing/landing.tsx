import { AudioLines, Check, Globe, KeyRound, LayoutGrid, Layers, ListFilter, Monitor, MousePointerClick, Play, ShieldCheck, Smartphone, Telescope, Users, WalletCards } from "lucide-react";
import { cn } from "@/lib/utils";
import { APP_NAME, APP_TAGLINE } from "@/lib/brand";
import { Logo } from "@/components/brand/logo";
import { ModeIcon } from "@/components/butler/mode-icon";
import { BrowserFrame, Crop, PhoneFrame, Shot, TALL, WindowFrame } from "./frames";
import { DemoVideo, DownloadButtons, HeroDownload, ModesDemo, Reveal, SignInLink, TopNav } from "./parts";

/*
 * The front page of the website, for someone who is not signed in. It says what Beryl does, shows
 * it on the three screens it runs on, and offers the desktop app. The desktop app itself never
 * shows this page: there, a signed-out visitor goes straight to the sign-in screen.
 *
 * The pictures are real screenshots of the app (public/landing), one per theme. The words are
 * short on purpose: a headline, a line under it, one sentence per thing.
 */

const WIDGETS = ["Maps", "Flights", "Hotels", "Products", "Stock charts", "Prediction markets", "Weather", "Images", "Comparisons", "Charts"];

export function Landing({ signedIn = false, demoVideo = "" }: { signedIn?: boolean; /** A YouTube link or a video file's address. Empty until the video exists. */ demoVideo?: string }) {
  return (
    <div id="top" className="landing min-h-dvh bg-background text-foreground">
      <TopNav signedIn={signedIn} />

      <main>
        {/* ───────── Hero ───────── */}
        <section className="backdrop-room">
          <div className="mx-auto w-full max-w-[1120px] px-5 pt-14 pb-16 sm:px-8 sm:pt-20 sm:pb-24">
            <div className="mx-auto max-w-[44rem] text-center">
              <p className="text-[0.78rem] font-medium tracking-[0.14em] text-brand uppercase">{APP_TAGLINE}</p>
              <h1 className="font-display mt-4 text-[2.9rem] leading-[1.02] text-balance sm:text-[4.4rem]">Hand it over.</h1>
              <p className="mx-auto mt-5 max-w-[36rem] text-[1.08rem] leading-relaxed text-pretty text-muted-foreground sm:text-[1.2rem]">
                Tell {APP_NAME} what you need. It searches the live web, shows you the answer, and can finish the job in a browser while you watch.
              </p>
              <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
                <SignInLink signedIn={signedIn} />
                <HeroDownload />
                <a href="#demo" className="flex h-12 items-center justify-center gap-2 rounded-full px-4 text-[0.95rem] font-medium text-muted-foreground transition-colors hover:text-foreground">
                  <Play className="size-4" aria-hidden />
                  Watch the demo
                </a>
              </div>
              {signedIn ? null : <p className="mt-4 text-[0.82rem] text-subtle">Accounts are by invitation for now.</p>}
            </div>

            {/* The same answer, as it looks on the screen the visitor is holding. */}
            <Reveal className="mt-12 sm:mt-16">
              <BrowserFrame className="hidden sm:block">
                <Shot name="places" alt={`${APP_NAME} answering "Find three good coffee shops in Kallio" with a map and a card for each place`} />
              </BrowserFrame>
              <div className="flex justify-center sm:hidden">
                <PhoneFrame className="w-[16.5rem]">
                  <Shot name="phone-places" size={TALL} alt={`${APP_NAME} on a phone, answering "Find three good coffee shops in Kallio" with a map`} />
                </PhoneFrame>
              </div>
            </Reveal>
          </div>
        </section>

        {/* ───────── What it does ───────── */}
        <section id="features" className="scroll-mt-16 border-t border-border/60">
          <div className="mx-auto w-full max-w-[1120px] px-5 py-16 sm:px-8 sm:py-24">
            <SectionTitle title="What you can hand over" lead={`A few things ${APP_NAME} is good at.`} />

            <div className="mt-12 space-y-16 sm:mt-16 sm:space-y-24">
              {/* The one only the desktop app can do gets the whole width: the browser and the chat side by side, as they are. */}
              <Reveal>
                <div className="grid gap-6 md:grid-cols-2 md:items-end md:gap-14">
                  <div className="max-w-[30rem]">
                    <p className="flex items-center gap-2 text-[0.8rem] font-medium text-brand">
                      <span className="flex size-7 items-center justify-center rounded-lg bg-brand-soft [&_svg]:size-4">
                        <MousePointerClick />
                      </span>
                      In the desktop app
                    </p>
                    <h3 className="font-display mt-4 text-[1.7rem] leading-[1.12] text-balance sm:text-[2.1rem]">It does the clicking</h3>
                    <p className="mt-4 text-[1.02rem] leading-relaxed text-muted-foreground">Ask it to book the table and {APP_NAME} opens a real browser and works through the site while you watch.</p>
                  </div>
                  <ul className="space-y-2.5 md:pb-1">
                    <Point icon={<ShieldCheck />}>It asks before anything is booked, sent or ordered.</Point>
                    <Point icon={<KeyRound />}>You do the sign-ins. It never types a password.</Point>
                    <Point icon={<WalletCards />}>It never pays. That step is always yours.</Point>
                  </ul>
                </div>
                <WindowFrame title={APP_NAME} className="mt-8 sm:mt-10">
                  <Shot name="browser" alt={`${APP_NAME} filling in a table reservation in a live browser beside the chat, and waiting for approval before it confirms`} />
                </WindowFrame>
              </Reveal>

              <Feature
                flip
                icon={<ListFilter />}
                kicker="Sift"
                title="Finds the ones that fit"
                picture={<Crop name="sift" alt="A grid of forty recipes, each ticked against five wishes: vegetarian, no nuts, one pan, under 30 minutes, uses chickpeas" className="aspect-[5/4]" at="74% 40%" zoom={1.25} />}
              >
                <p>
                  Want a dinner that&apos;s quick, vegetarian and one pan? {APP_NAME} reads about 40 pages and checks each one against everything you asked for. It takes about a second.
                </p>
                <p className="mt-3 text-[0.92rem] text-subtle">Good for recipes, job ads, flats, courses and studies.</p>
              </Feature>

              <Feature
                icon={<Telescope />}
                kicker="Deep research"
                title="A research team on call"
                picture={<Crop name="research-live" alt="Four researchers working side by side on leasing or buying an electric car in Finland, each with its own searches" className="aspect-[5/4]" at="76% 45%" zoom={1.22} />}
              >
                <p>
                  Big question? {APP_NAME} sends out up to 12 researchers at once. They read hundreds of sources and come back with one report, every claim linked to where it came from.
                </p>
              </Feature>

              <Feature
                flip
                icon={<AudioLines />}
                kicker="Voice"
                title="Just say it"
                picture={
                  <div className="flex justify-center">
                    <PhoneFrame className="w-[15.5rem] sm:w-[17rem]">
                      <Shot name="phone-call" size={TALL} alt={`A live call with ${APP_NAME} on a phone: it is speaking while a map of coffee shops sits on screen`} />
                    </PhoneFrame>
                  </div>
                }
              >
                <p>Talk to {APP_NAME} like you&apos;d talk on the phone, in any language. The answer shows up on screen while it speaks. Or tap the mic and dictate.</p>
              </Feature>
            </div>

            {/* The rest, smaller. */}
            <div className="mt-16 grid gap-4 sm:mt-24 sm:grid-cols-2 lg:grid-cols-6">
              <Card className="lg:col-span-3" icon={<Globe />} title="Straight from the live web" text={`${APP_NAME} searches with Exa, so what you get is current, and every fact links to its source.`}>
                <p className="rounded-2xl bg-surface px-4 py-3.5 text-[0.9rem] leading-relaxed hairline">
                  Helsinki&apos;s tallest building is Majakka, at 134 metres <SourcePill>srv.fi</SourcePill>
                </p>
              </Card>
              <Card className="lg:col-span-3" icon={<LayoutGrid />} title="Answers you can use" text="You get the thing itself: a map you can open, fares you can book, a chart you can read.">
                <ul className="flex flex-wrap gap-1.5">
                  {WIDGETS.map((name) => (
                    <li key={name} className="rounded-full border border-border bg-surface px-3 py-1.5 text-[0.8rem] text-muted-foreground">
                      {name}
                    </li>
                  ))}
                </ul>
              </Card>
              <Card className="lg:col-span-2" icon={<ModeIcon mode="smart" />} title="Pick your pace" text="Four modes, from Ultra fast to Expert, and a dial for how hard it should think.">
                <ModesDemo />
              </Card>
              <Card className="lg:col-span-2" icon={<Layers />} title="Keeps working without you" text="Close the tab or start something else. Your task keeps running, and you can have several going at once.">
                <ul className="space-y-1.5">
                  {[
                    ["Lease or buy an electric car", true],
                    ["Flights to Lisbon in March", true],
                    ["Coffee shops in Kallio", false],
                  ].map(([task, running]) => (
                    <li key={String(task)} className="flex h-10 items-center gap-2.5 rounded-xl bg-surface px-3 text-[0.84rem] hairline">
                      <span className="min-w-0 flex-1 truncate">{task}</span>
                      {running ? <span className="size-2 shrink-0 animate-pulse-dot rounded-full bg-brand" aria-label="Running" /> : <Check className="size-4 shrink-0 text-subtle" aria-label="Done" />}
                    </li>
                  ))}
                </ul>
              </Card>
              <Card className="sm:col-span-2 lg:col-span-2" icon={<Users />} title="Made for teams" text="An admin hands out accounts, chooses which modes each person gets, and sets a spending limit.">
                <div className="rounded-2xl bg-surface p-3.5 hairline">
                  <div className="flex items-center gap-2.5">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[0.7rem] font-semibold text-brand">AM</span>
                    <span className="min-w-0 flex-1 truncate text-[0.86rem] font-medium">Alex Morgan</span>
                    <span className="nums text-[0.78rem] text-muted-foreground">$6.20 of $10</span>
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full w-[62%] rounded-full bg-brand" />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {(["ultrafast", "fast", "smart"] as const).map((id) => (
                      <span key={id} className="flex h-7 items-center gap-1.5 rounded-full bg-brand-soft px-2.5 text-[0.74rem] font-medium text-brand">
                        <ModeIcon mode={id} className="size-3.5" />
                        {id === "ultrafast" ? "Ultra fast" : id === "fast" ? "Fast" : "Smart"}
                      </span>
                    ))}
                  </div>
                </div>
              </Card>
            </div>
          </div>
        </section>

        {/* ───────── Demo ───────── */}
        <section id="demo" className="scroll-mt-16 border-t border-border/60 bg-surface/50">
          <div className="mx-auto w-full max-w-[960px] px-5 py-16 sm:px-8 sm:py-24">
            <SectionTitle title="Watch it work" lead="A two-minute tour, from a question to a finished task." />
            <Reveal className="mt-10 sm:mt-12">
              <DemoVideo src={demoVideo} />
            </Reveal>
          </div>
        </section>

        {/* ───────── Three screens ───────── */}
        <section id="screens" className="scroll-mt-16 border-t border-border/60">
          <div className="mx-auto w-full max-w-[1120px] px-5 py-16 sm:px-8 sm:py-24">
            <SectionTitle title="On the web, on your desktop, on your phone" lead="Sign in once. Your conversations are there on every screen." />

            <div className="mt-12 grid items-end gap-10 lg:grid-cols-[1fr_1fr_auto] lg:gap-8">
              <Screen icon={<Globe />} name="Web" text="Nothing to install.">
                <BrowserFrame>
                  <Shot name="research" alt={`A finished research report in ${APP_NAME} in a web browser`} />
                </BrowserFrame>
              </Screen>
              <Screen icon={<Monitor />} name="Desktop" text="Adds the live browser.">
                <WindowFrame title={APP_NAME}>
                  <Shot name="browser" alt={`The ${APP_NAME} desktop app with a live browser beside the conversation`} />
                </WindowFrame>
              </Screen>
              <Screen icon={<Smartphone />} name="Phone" text="Add it to your home screen." className="mx-auto w-[13.5rem] lg:w-[11.5rem]">
                <PhoneFrame>
                  <Shot name="phone-places" size={TALL} alt={`${APP_NAME} on a phone, showing coffee shops on a map`} />
                </PhoneFrame>
              </Screen>
            </div>
          </div>
        </section>

        {/* ───────── Download ───────── */}
        <section id="download" className="scroll-mt-16 border-t border-border/60 bg-surface/50">
          <div className="mx-auto grid w-full max-w-[1120px] gap-10 px-5 py-16 sm:px-8 sm:py-24 lg:grid-cols-[1fr_1.1fr] lg:gap-16">
            <div>
              <h2 className="font-display text-[2rem] leading-[1.1] text-balance sm:text-[2.6rem]">Get the desktop app</h2>
              <p className="mt-4 max-w-[30rem] text-[1.02rem] leading-relaxed text-muted-foreground">Same {APP_NAME}, plus a browser it can drive for you. You&apos;ll need an account to sign in.</p>
            </div>
            <div>
              <DownloadButtons />
              <p className="mt-6 border-t border-border/70 pt-5 text-[0.9rem] leading-relaxed text-muted-foreground">
                Don&apos;t want to install anything? {APP_NAME} works in your browser too, and on a phone you can add it to your home screen.
              </p>
            </div>
          </div>
        </section>

        {/* ───────── The way in ───────── */}
        <section className="backdrop-room border-t border-border/60">
          <div className="mx-auto flex w-full max-w-[1120px] flex-col items-center px-5 py-16 text-center sm:px-8 sm:py-24">
            <Logo size={52} className="rounded-2xl shadow-card" />
            <h2 className="font-display mt-6 text-[2rem] leading-[1.1] text-balance sm:text-[2.6rem]">Got something to hand over?</h2>
            <p className="mt-3 text-[1.02rem] text-muted-foreground">{signedIn ? "Pick up where you left off." : "Sign in and try it on your next errand."}</p>
            <SignInLink signedIn={signedIn} className="mt-7" />
          </div>
        </section>
      </main>

      <footer className="border-t border-border/60">
        <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-5 px-5 py-8 text-[0.84rem] text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div className="flex items-center gap-2.5">
            <Logo size={24} className="rounded-md" />
            <span>
              {APP_NAME}. Built at Junction 2026 in Espoo.
            </span>
          </div>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2">
            <a href="#features" className="transition-colors hover:text-foreground">
              What it does
            </a>
            <a href="#demo" className="transition-colors hover:text-foreground">
              Demo
            </a>
            <a href="#download" className="transition-colors hover:text-foreground">
              Download
            </a>
            <a href={signedIn ? "/" : "/login"} className="transition-colors hover:text-foreground">
              {signedIn ? `Open ${APP_NAME}` : "Sign in"}
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}

function SectionTitle({ title, lead }: { title: string; lead?: string }) {
  return (
    <div className="mx-auto max-w-[40rem] text-center">
      <h2 className="font-display text-[2rem] leading-[1.1] text-balance sm:text-[2.6rem]">{title}</h2>
      {lead ? <p className="mt-3 text-[1.02rem] leading-relaxed text-muted-foreground">{lead}</p> : null}
    </div>
  );
}

/** One of the big four: words on one side, a real picture on the other. */
function Feature({ icon, kicker, title, picture, flip, children }: { icon: React.ReactNode; kicker: string; title: string; picture: React.ReactNode; flip?: boolean; children: React.ReactNode }) {
  return (
    <Reveal className="grid items-center gap-8 md:grid-cols-2 md:gap-14">
      <div className={cn("max-w-[30rem]", flip && "md:order-2 md:justify-self-end")}>
        <p className="flex items-center gap-2 text-[0.8rem] font-medium text-brand">
          <span className="flex size-7 items-center justify-center rounded-lg bg-brand-soft [&_svg]:size-4">{icon}</span>
          {kicker}
        </p>
        <h3 className="font-display mt-4 text-[1.7rem] leading-[1.12] text-balance sm:text-[2.1rem]">{title}</h3>
        <div className="mt-4 text-[1.02rem] leading-relaxed text-muted-foreground">{children}</div>
      </div>
      <div className={cn(flip && "md:order-1")}>{picture}</div>
    </Reveal>
  );
}

function Point({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3 text-[0.95rem] text-foreground">
      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-brand-soft text-brand [&_svg]:size-3.5">{icon}</span>
      {children}
    </li>
  );
}

/** One of the smaller things: a name, a sentence, and something to look at. */
function Card({ icon, title, text, className, children }: { icon: React.ReactNode; title: string; text: string; className?: string; children?: React.ReactNode }) {
  return (
    <Reveal className={cn("flex flex-col rounded-3xl border border-border bg-card p-5 shadow-card sm:p-6", className)}>
      <span className="flex size-9 items-center justify-center rounded-xl bg-brand-soft text-brand [&_svg]:size-[1.1rem]">{icon}</span>
      <h3 className="mt-4 text-[1.08rem] leading-tight font-semibold tracking-tight">{title}</h3>
      <p className="mt-2 text-[0.92rem] leading-relaxed text-muted-foreground">{text}</p>
      {children ? <div className="mt-5 pt-0 md:mt-auto md:pt-5">{children}</div> : null}
    </Reveal>
  );
}

function SourcePill({ children }: { children: React.ReactNode }) {
  return (
    <span className="ml-0.5 inline-flex h-6 items-center gap-1.5 rounded-full border border-border bg-card px-2 align-middle text-[0.72rem] text-muted-foreground">
      <span className="size-2.5 rounded-full bg-brass" aria-hidden />
      {children}
    </span>
  );
}

/** One of the three screens: the frame, and under it what it is. */
function Screen({ icon, name, text, className, children }: { icon: React.ReactNode; name: string; text: string; className?: string; children: React.ReactNode }) {
  return (
    <Reveal className={className}>
      <figure>
        {children}
        <figcaption className="mt-4 text-center text-[0.9rem] leading-snug">
          <span className="flex items-center justify-center gap-2 font-medium">
            <span className="text-brand [&_svg]:size-4">{icon}</span>
            {name}
          </span>
          <span className="mt-1 block text-muted-foreground">{text}</span>
        </figcaption>
      </figure>
    </Reveal>
  );
}
