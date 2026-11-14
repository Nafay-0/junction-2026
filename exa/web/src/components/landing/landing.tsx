import {
  ArrowDown,
  AudioLines,
  Bell,
  CalendarClock,
  Check,
  CloudSun,
  Globe,
  Infinity as InfinityIcon,
  KeyRound,
  Layers,
  LineChart,
  ListFilter,
  Mail,
  MapPin,
  Mic,
  Monitor,
  MousePointerClick,
  Plane,
  Play,
  ShieldCheck,
  ShoppingBag,
  Smartphone,
  Telescope,
  TrendingUp,
  Users,
  WalletCards,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { APP_NAME, APP_TAGLINE } from "@/lib/brand";
import { Logo } from "@/components/brand/logo";
import { ModeIcon } from "@/components/butler/mode-icon";
import { BrowserFrame, PhoneFrame, Shot, TALL, WindowFrame } from "./frames";
import { Live, type DemoName } from "./live";
import { DemoVideo, DownloadPicker, Drift, ModesDemo, Motion, Reveal, Rise, SignInLink, Stagger, StaggerItem, TopNav, VoiceBars } from "./parts";

/*
 * The front page of the website, for someone who is not signed in. It says what Beryl does and
 * shows it: most of what is on this page is the app's own cards, running with sample data
 * (live.tsx). What cannot run here (the desktop app at work in its browser, a call, the Jobs
 * page) is shown in real screenshots (public/landing), one per theme, each in a frame that fits
 * it. The desktop app itself never shows this page: there, a signed-out visitor goes to sign in.
 *
 * The words are short on purpose: a headline, a line under it, one sentence per thing.
 */

const MORE = ["Hotels", "Images", "Comparisons", "Timelines", "Opening hours", "Calculators", "Charts of anything", "News", "Recipes", "Courses", "Job ads", "Exchange rates"];

export function Landing({ signedIn = false, demoVideo = "" }: { signedIn?: boolean; /** A YouTube link or a video file's address. Empty until the video exists. */ demoVideo?: string }) {
  return (
    <Motion>
      <div id="top" className="landing min-h-dvh overflow-x-clip bg-background text-foreground">
        <TopNav signedIn={signedIn} />

        <main>
          {/* ───────── Hero ───────── */}
          <section className="backdrop-room">
            <div className="mx-auto w-full max-w-[1180px] px-5 pt-14 pb-16 sm:px-8 sm:pt-20 sm:pb-28">
              <div className="mx-auto max-w-[46rem] text-center">
                <Rise>
                  <p className="text-[0.78rem] font-medium tracking-[0.14em] text-brand uppercase">{APP_TAGLINE}</p>
                </Rise>
                <Rise delay={0.06}>
                  <h1 className="font-display mt-4 text-[3rem] leading-[1.02] text-balance sm:text-[4.6rem]">Hand it over.</h1>
                </Rise>
                <Rise delay={0.12}>
                  <p className="mx-auto mt-5 max-w-[37rem] text-[1.08rem] leading-relaxed text-pretty text-muted-foreground sm:text-[1.2rem]">
                    Ask {APP_NAME} for anything. It finds it on the live web, shows you the answer, and in the desktop app it does the clicking too.
                  </p>
                </Rise>
                <Rise delay={0.18} className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
                  <SignInLink signedIn={signedIn} />
                  <a
                    href="#download"
                    className="flex h-12 items-center justify-center gap-2 rounded-full border border-border bg-card px-6 text-[0.95rem] font-medium shadow-card transition-[border-color,transform] hover:border-ring/50 active:scale-[0.98]"
                  >
                    <ArrowDown className="size-4" aria-hidden />
                    Download
                  </a>
                  <a href="#watch" className="flex h-12 items-center justify-center gap-2 rounded-full px-4 text-[0.95rem] font-medium text-muted-foreground transition-colors hover:text-foreground">
                    <Play className="size-4" aria-hidden />
                    Watch it work
                  </a>
                </Rise>
                {signedIn ? null : (
                  <Rise delay={0.22}>
                    <p className="mt-4 text-[0.82rem] text-subtle">Accounts are by invitation for now.</p>
                  </Rise>
                )}
              </div>

              {/* A question and its answer, live: the card is the app's own. A phone and two notices sit in front of it. */}
              <Rise delay={0.3} className="relative mx-auto mt-12 max-w-[1000px] sm:mt-16">
                <div className="stage-glow pointer-events-none absolute -inset-x-16 -inset-y-10 -z-10 hidden sm:block" aria-hidden />
                <BrowserFrame address="beryl.zeroanomaly.tech">
                  <div className="bg-background px-3 pt-5 sm:px-8 sm:pt-7">
                    <div className="mx-auto max-w-[43rem]">
                      <Bubble>Where should we eat near Kamppi tonight?</Bubble>
                      <div className="fade-below mt-4 h-[25rem] w-full min-w-0 overflow-hidden sm:h-[31rem]">
                        <Live name="places" className="w-full min-w-0" />
                      </div>
                    </div>
                  </div>
                </BrowserFrame>

                <Drift by={-22} className="absolute -right-4 -bottom-14 z-20 hidden w-[13.5rem] lg:block xl:-right-20">
                  <PhoneFrame>
                    <Shot name="phone-call" size={TALL} eager alt={`A call with ${APP_NAME} on a phone: it is speaking while the answer sits on screen`} />
                  </PhoneFrame>
                </Drift>
                <Drift by={30} className="absolute bottom-10 -left-6 z-20 hidden w-[17.5rem] space-y-2.5 lg:block xl:-left-24">
                  <Notice icon={<Mail />} title="Morning AI news" line="Your 08:00 job has run. The result is in your inbox." />
                  <Notice icon={<ShieldCheck />} title="Waiting for your approval" line="Reserve a table for 2 tomorrow at 19:00" tone="brass" />
                </Drift>
              </Rise>
            </div>
          </section>

          {/* ───────── Ask for anything ───────── */}
          <section id="ask" className="scroll-mt-16 border-t border-border/60">
            <div className="mx-auto w-full max-w-[1180px] px-5 py-16 sm:px-8 sm:py-24">
              <SectionTitle
                kicker="What it does"
                title="Ask for anything"
                lead="You get the thing itself, not a page of links: a chart you can read, fares you can book, a forecast you can plan around."
                powered={<PoweredBy marks={["exa"]}>Powered by Exa</PoweredBy>}
              />

              <Stagger className="mt-12 grid grid-cols-1 gap-4 sm:mt-14 lg:grid-cols-12">
                <Example className="lg:col-span-7" icon={<LineChart />} label="Stock prices" question="How are Nvidia and Apple doing today?" name="stocks" />
                <Example className="lg:col-span-5" icon={<CloudSun />} label="Weather" question="Do I need a coat in Espoo this week?" name="weather" />
                <Example className="lg:col-span-5" icon={<TrendingUp />} label="Prediction markets" question="Who is ahead for 2028?" name="market" />
                <Example className="lg:col-span-7" icon={<Plane />} label="Flights" question="Flights from Helsinki to London this weekend?" name="flights" />
                <Example className="lg:col-span-7" icon={<ShoppingBag />} label="Products" question="Which noise-cancelling headphones should I buy?" name="products" />

                <StaggerItem className="min-w-0 lg:col-span-5">
                  <div className="backdrop-room flex h-full min-h-[22rem] flex-col rounded-3xl border border-border bg-card p-6 shadow-card sm:p-7">
                    <span className="flex size-10 items-center justify-center rounded-xl bg-brand-soft text-brand">
                      <InfinityIcon className="size-5" aria-hidden />
                    </span>
                    <h3 className="font-display mt-5 text-[1.7rem] leading-[1.1] sm:text-[2rem]">Limitless possibilities</h3>
                    <p className="mt-3 text-[0.98rem] leading-relaxed text-muted-foreground">If it&apos;s on the web, {APP_NAME} can fetch it. And when no card fits, it builds one: a chart, a table, a timeline, a small tool.</p>
                    <ul className="mt-5 flex flex-wrap gap-1.5">
                      {MORE.map((name) => (
                        <li key={name} className="rounded-full border border-border bg-surface px-3 py-1.5 text-[0.8rem] text-muted-foreground">
                          {name}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-auto flex items-center gap-2 pt-6 text-[0.86rem] text-foreground">
                      <MapPin className="size-4 shrink-0 text-brand" aria-hidden />
                      The map at the top of this page is one too.
                    </p>
                  </div>
                </StaggerItem>
              </Stagger>
              <p className="mt-5 text-center text-[0.8rem] text-subtle">These are the app&apos;s real cards. Try them. The numbers are examples.</p>
            </div>
          </section>

          {/* ───────── It does it for you ───────── */}
          <section id="desktop" className="scroll-mt-16 border-t border-border/60 bg-surface/50">
            <div className="mx-auto w-full max-w-[1180px] px-5 py-16 sm:px-8 sm:py-24">
              <SectionTitle
                kicker="Desktop app only"
                icon={<MousePointerClick />}
                title="It does it for you"
                lead={`Ask it to book the table. ${APP_NAME} opens a browser inside the app and works through the site, start to finish, while you watch.`}
                powered={<PoweredBy marks={["gemini", "claude"]}>Powered by {MODELS}</PoweredBy>}
              />

              <div className="relative mx-auto mt-12 max-w-[1040px] sm:mt-14 lg:pb-16">
                <Reveal>
                  <WindowFrame title={APP_NAME}>
                    <Shot name="browser" alt={`${APP_NAME} filling in a table reservation in a live browser beside the chat, and waiting for approval before it confirms`} />
                  </WindowFrame>
                </Reveal>
                <Drift by={18} className="relative z-10 mt-4 lg:absolute lg:-bottom-2 lg:-left-10 lg:mt-0 lg:w-[23rem]">
                  <Reveal delay={0.1}>
                    <ul className="space-y-3 rounded-3xl border border-border bg-card p-5 shadow-float">
                      <Point icon={<ShieldCheck />} title="It asks first">Nothing is booked, sent or ordered without your yes.</Point>
                      <Point icon={<KeyRound />} title="You sign in">It never types a password or a code. You do, in the app.</Point>
                      <Point icon={<WalletCards />} title="It never pays">The payment page is always handed to you.</Point>
                    </ul>
                  </Reveal>
                </Drift>
              </div>
            </div>
          </section>

          {/* ───────── Talk to it ───────── */}
          <section id="voice" className="scroll-mt-16 border-t border-border/60">
            <div className="mx-auto grid w-full max-w-[1180px] items-center gap-10 px-5 py-16 sm:px-8 sm:py-24 md:grid-cols-2 md:gap-14">
              <Reveal className="max-w-[31rem]">
                <Kicker icon={<AudioLines />}>Voice</Kicker>
                <h2 className="font-display mt-4 text-[2rem] leading-[1.1] text-balance sm:text-[2.6rem]">Talk to it</h2>
                <p className="mt-4 text-[1.02rem] leading-relaxed text-muted-foreground">Say it out loud, in any language. {APP_NAME} answers by voice and puts the map, the prices or the chart on screen while it speaks.</p>
                <PoweredBy marks={["gemini"]} className="mt-4">
                  Powered by Gemini 3.8 Live
                </PoweredBy>
                <VoiceBars className="mt-6" />
                <ul className="mt-7 space-y-3">
                  <Point icon={<AudioLines />} title="A real conversation">Interrupt it, change your mind, ask a follow-up.</Point>
                  <Point icon={<Mic />} title="Or just dictate">Tap the mic and speak your message instead of typing it.</Point>
                </ul>
              </Reveal>
              <Reveal delay={0.08} className="relative flex justify-center">
                <div className="stage-glow pointer-events-none absolute inset-0 -z-10" aria-hidden />
                <Drift by={14} className="w-[15.5rem] sm:w-[18rem]">
                  <PhoneFrame>
                    <Shot name="phone-call" size={TALL} alt={`A live call with ${APP_NAME} on a phone: it is speaking while a map of coffee shops sits on screen`} />
                  </PhoneFrame>
                </Drift>
              </Reveal>
            </div>
          </section>

          {/* ───────── Jobs ───────── */}
          <section id="jobs" className="scroll-mt-16 border-t border-border/60 bg-surface/50">
            <div className="mx-auto w-full max-w-[1180px] px-5 py-16 sm:px-8 sm:py-24">
              <SectionTitle
                kicker="Jobs"
                icon={<CalendarClock />}
                title="Put it on a schedule"
                lead={`Ask once. ${APP_NAME} does it on time, every time, emails you the result and keeps every run.`}
                powered={<PoweredBy marks={["exa", "gemini", "claude"]}>Powered by Exa, {MODELS}</PoweredBy>}
              />

              <Stagger className="mx-auto mt-8 flex max-w-[52rem] flex-wrap justify-center gap-2">
                {["Every weekday at 8, email me the top AI news", "Check this price every 6 hours until Friday", "Tomorrow at 9, send me the weather for the hike"].map((ask) => (
                  <StaggerItem key={ask}>
                    <span className="block rounded-full border border-border bg-card px-4 py-2 text-[0.86rem] text-muted-foreground shadow-card">&ldquo;{ask}&rdquo;</span>
                  </StaggerItem>
                ))}
              </Stagger>

              <div className="relative mx-auto mt-12 max-w-[1040px] lg:pb-40">
                <Reveal>
                  <WindowFrame title={`${APP_NAME} · Jobs`}>
                    <Shot name="jobs" alt={`The Jobs page in ${APP_NAME}: two jobs with their schedules, and one opened with its instructions and its runs`} />
                  </WindowFrame>
                </Reveal>
                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:mt-0 lg:block">
                  <Drift by={26} className="z-10 min-w-0 lg:absolute lg:bottom-6 lg:-left-10 lg:w-[25rem]">
                    <Reveal delay={0.08}>
                      <Live name="job" className="w-full min-w-0 rounded-2xl shadow-float" />
                    </Reveal>
                  </Drift>
                  <Drift by={-16} className="z-10 min-w-0 lg:absolute lg:right-[-2.5rem] lg:bottom-0 lg:w-[23rem]">
                    <Reveal delay={0.16}>
                      <EmailMock />
                    </Reveal>
                  </Drift>
                </div>
              </div>

              <Stagger className="mx-auto mt-10 grid max-w-[1040px] grid-cols-1 gap-4 sm:grid-cols-3 lg:mt-12">
                <Mini title="Made in a chat">Say what you want and when. {APP_NAME} writes the instructions and shows you the next run times.</Mini>
                <Mini title="Yours to change">Edit it, pause it, delete it or try it with Run now. Or just tell {APP_NAME} to.</Mini>
                <Mini title="Every run kept">The email has the result. The Jobs page has every run, with its cards and sources.</Mini>
              </Stagger>
            </div>
          </section>

          {/* ───────── Sift ───────── */}
          <section id="sift" className="scroll-mt-16 border-t border-border/60">
            <div className="mx-auto w-full max-w-[1180px] px-5 py-16 sm:px-8 sm:py-24">
              <SectionTitle
                kicker="Sift"
                icon={<ListFilter />}
                title="Finds the ones that fit"
                lead={`Dinner that's quick, vegetarian and one pan? ${APP_NAME} reads about 40 pages and checks every one against everything you asked for. It takes about a second.`}
                powered={<PoweredBy marks={["exa", "gemini"]}>Powered by Exa and the Gemini Decisions API</PoweredBy>}
              />
              <Reveal className="mx-auto mt-10 max-w-[900px] sm:mt-12">
                <Bubble>Something quick for dinner with the chickpeas I have. Vegetarian, no nuts, one pan.</Bubble>
                <div className="fade-below mt-4 h-[30rem] w-full min-w-0 overflow-hidden sm:h-[34rem]">
                  <Live name="sift" className="w-full min-w-0" />
                </div>
              </Reveal>
              <p className="mt-4 text-center text-[0.9rem] text-muted-foreground">Good for recipes, job ads, flats, courses and studies. Tick a wish to make it a must.</p>
            </div>
          </section>

          {/* ───────── Research ───────── */}
          <section id="research" className="scroll-mt-16 border-t border-border/60 bg-surface/50">
            <div className="mx-auto w-full max-w-[1180px] px-5 py-16 sm:px-8 sm:py-24">
              <SectionTitle
                kicker="Deep research"
                icon={<Telescope />}
                title="A research team on call"
                lead={`Big question? ${APP_NAME} sends out up to 12 researchers at once. They read hundreds of sources and come back with one report, every claim linked to where it came from.`}
                powered={<PoweredBy marks={["exa", "gemini", "claude"]}>Powered by Exa, {MODELS}</PoweredBy>}
              />
              <Reveal className="mx-auto mt-10 max-w-[900px] sm:mt-12">
                <Bubble>Should I lease or buy an electric car in Finland in 2026? I drive about 15,000 km a year.</Bubble>
                <div className="fade-below mt-4 h-[32rem] w-full min-w-0 overflow-hidden sm:h-[38rem]">
                  <Live name="research" className="w-full min-w-0" />
                </div>
              </Reveal>
              <p className="mt-4 text-center text-[0.9rem] text-muted-foreground">How deep it goes follows the mode and the effort you pick.</p>
            </div>
          </section>

          {/* ───────── The rest ───────── */}
          <section id="more" className="scroll-mt-16 border-t border-border/60">
            <div className="mx-auto w-full max-w-[1180px] px-5 py-16 sm:px-8 sm:py-24">
              <SectionTitle title="And the rest" lead="Small things that make it easy to live with." />
              <Stagger className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6">
                <Card className="lg:col-span-3" icon={<Bell />} title="Tells you when it matters" text="A long chat is done, a job has run, or the browser needs your OK. You see it in the app, and get an email only when you&apos;re away.">
                  <ul className="space-y-1.5">
                    {[
                      [<Check key="i" />, "Done: lease or buy an electric car"],
                      [<Mail key="i" />, "Morning AI news is in your inbox"],
                      [<Bell key="i" />, "Waiting for your approval: reserve a table"],
                    ].map(([icon, line]) => (
                      <li key={String(line)} className="flex h-10 items-center gap-2.5 rounded-xl bg-surface px-3 text-[0.84rem] hairline">
                        <span className="flex size-5 shrink-0 items-center justify-center text-brand [&_svg]:size-4">{icon}</span>
                        <span className="min-w-0 flex-1 truncate">{line}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
                <Card className="lg:col-span-3" icon={<Globe />} title="Straight from the live web" text={`${APP_NAME} searches with Exa, so what you get is current, and every fact links to its source.`}>
                  <p className="rounded-2xl bg-surface px-4 py-3.5 text-[0.9rem] leading-relaxed hairline">
                    Helsinki&apos;s tallest building is Majakka, at 134 metres <SourcePill>srv.fi</SourcePill>
                  </p>
                </Card>
                <Card className="lg:col-span-2" icon={<ModeIcon mode="smart" />} title="Pick your pace" text="Four modes and a dial for how hard it should think. Ultra fast is Gemini 4 Hydrogen, Fast is Claude Sonnet 5.5, Smart is Claude Opus 5.5 and Expert is Gemini 4 Carbon.">
                  <ModesDemo />
                </Card>
                <Card className="lg:col-span-2" icon={<Layers />} title="Keeps working without you" text="Close the tab or start something else. Your chat keeps working, and you can have several going at once.">
                  <ul className="space-y-1.5">
                    {[
                      ["Lease or buy an electric car", true],
                      ["Flights to Lisbon in March", true],
                      ["Coffee shops in Kallio", false],
                    ].map(([chat, running]) => (
                      <li key={String(chat)} className="flex h-10 items-center gap-2.5 rounded-xl bg-surface px-3 text-[0.84rem] hairline">
                        <span className="min-w-0 flex-1 truncate">{chat}</span>
                        {running ? <span className="size-2 shrink-0 animate-pulse-dot rounded-full bg-brand" aria-label="Working" /> : <Check className="size-4 shrink-0 text-subtle" aria-label="Done" />}
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
              </Stagger>
            </div>
          </section>

          {/* ───────── Watch it work ───────── */}
          <section id="watch" className="scroll-mt-16 border-t border-border/60 bg-surface/50">
            <div className="mx-auto w-full max-w-[960px] px-5 py-16 sm:px-8 sm:py-24">
              <SectionTitle title="Watch it work" lead="Two minutes, from a question to the finished result." />
              <Reveal className="mt-10 sm:mt-12">
                <DemoVideo src={demoVideo} />
              </Reveal>
            </div>
          </section>

          {/* ───────── Use it anywhere ───────── */}
          <section id="anywhere" className="scroll-mt-16 border-t border-border/60">
            <div className="mx-auto w-full max-w-[1180px] px-5 py-16 sm:px-8 sm:py-24">
              <SectionTitle title="Use it anywhere" lead="Sign in once. Your chats and your jobs are there on every screen." />

              <div className="relative mx-auto mt-12 max-w-[1060px] sm:mt-16">
                <div className="stage-glow pointer-events-none absolute -inset-8 -z-10" aria-hidden />
                <div className="lg:pr-[17%] lg:pb-[9%]">
                  <Reveal>
                    <BrowserFrame address="beryl.zeroanomaly.tech">
                      <Shot name="places" alt={`${APP_NAME} in a web browser, answering with a map of coffee shops`} />
                    </BrowserFrame>
                  </Reveal>
                </div>
                <Drift by={20} className="mt-4 lg:absolute lg:right-[9%] lg:bottom-0 lg:mt-0 lg:w-[52%]">
                  <Reveal delay={0.08}>
                    <WindowFrame title={APP_NAME}>
                      <Shot name="browser" alt={`The ${APP_NAME} desktop app with a live browser beside the chat`} />
                    </WindowFrame>
                  </Reveal>
                </Drift>
                <Drift by={-14} className="mx-auto mt-6 w-[13rem] lg:absolute lg:right-0 lg:bottom-[-4%] lg:mt-0 lg:w-[17.5%]">
                  <Reveal delay={0.16}>
                    <PhoneFrame>
                      <Shot name="phone-places" size={TALL} alt={`${APP_NAME} on a phone, showing coffee shops on a map`} />
                    </PhoneFrame>
                  </Reveal>
                </Drift>
              </div>

              <Stagger className="mx-auto mt-12 grid max-w-[1040px] grid-cols-1 gap-4 sm:grid-cols-3 lg:mt-20">
                <Mini icon={<Globe />} title="Web">Nothing to install. Open it in any browser.</Mini>
                <Mini icon={<Monitor />} title="Desktop">Mac and Windows. Adds the browser it can drive for you.</Mini>
                <Mini icon={<Smartphone />} title="Phone">Add it to your home screen and it opens like an app.</Mini>
              </Stagger>
            </div>
          </section>

          {/* ───────── Download ───────── */}
          <section id="download" className="scroll-mt-16 border-t border-border/60 bg-surface/50">
            <div className="mx-auto grid w-full max-w-[1180px] gap-10 px-5 py-16 sm:px-8 sm:py-24 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16">
              <Reveal>
                <h2 className="font-display text-[2rem] leading-[1.1] text-balance sm:text-[2.6rem]">Get the desktop app</h2>
                <p className="mt-4 max-w-[30rem] text-[1.02rem] leading-relaxed text-muted-foreground">Same {APP_NAME}, plus a browser it can drive for you. Pick your computer. You&apos;ll need an account to sign in.</p>
                <p className="mt-6 max-w-[30rem] border-t border-border/70 pt-5 text-[0.9rem] leading-relaxed text-muted-foreground">
                  Don&apos;t want to install anything? {APP_NAME} works in your browser too, and on a phone you can add it to your home screen.
                </p>
              </Reveal>
              <Reveal delay={0.08}>
                <DownloadPicker />
              </Reveal>
            </div>
          </section>

          {/* ───────── Powered by ───────── */}
          <section id="powered" className="scroll-mt-16 border-t border-border/60">
            <div className="mx-auto w-full max-w-[1180px] px-5 py-16 sm:px-8 sm:py-20">
              <p className="text-center text-[0.78rem] font-medium tracking-[0.14em] text-subtle uppercase">Powered by</p>
              <Stagger className="mx-auto mt-8 grid max-w-[1040px] grid-cols-1 gap-4 sm:grid-cols-3">
                <Maker logo="exa-color" name="Exa" what="Search and page contents. Every answer, every research report and every job starts with what Exa finds and reads on the live web." />
                <Maker logo="gemini-color" name="Gemini" by="Google" what="Gemini 4 Hydrogen and Gemini 4 Carbon think in the Ultra fast and Expert modes. Gemini 3.8 Live is the voice. The Gemini Decisions API does the checking in Sift." />
                <Maker logo="claude-color" name="Claude" by="Anthropic" what="Claude Sonnet 5.5 and Claude Opus 5.5 think in the Fast and Smart modes: in chats, in research, in jobs and at the browser." />
              </Stagger>
            </div>
          </section>

          {/* ───────── The way in ───────── */}
          <section className="backdrop-room border-t border-border/60">
            <Reveal className="mx-auto flex w-full max-w-[1180px] flex-col items-center px-5 py-16 text-center sm:px-8 sm:py-24">
              <Logo size={52} className="rounded-2xl shadow-card" />
              <h2 className="font-display mt-6 text-[2rem] leading-[1.1] text-balance sm:text-[2.6rem]">Got something to hand over?</h2>
              <p className="mt-3 text-[1.02rem] text-muted-foreground">{signedIn ? "Pick up where you left off." : "Sign in and try it on your next errand."}</p>
              <SignInLink signedIn={signedIn} className="mt-7" />
            </Reveal>
          </section>
        </main>

        <footer className="border-t border-border/60">
          <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-5 px-5 py-8 text-[0.84rem] text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-8">
            <div className="flex items-center gap-2.5">
              <Logo size={24} className="rounded-md" />
              <span>{APP_NAME}. Built at Junction 2026 in Espoo.</span>
            </div>
            <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2">
              {[
                ["#ask", "What it does"],
                ["#desktop", "Desktop app"],
                ["#jobs", "Jobs"],
                ["#watch", "Watch"],
                ["#download", "Download"],
                [signedIn ? "/" : "/login", signedIn ? `Open ${APP_NAME}` : "Sign in"],
              ].map(([href, label]) => (
                <a key={href} href={href} className="transition-colors hover:text-foreground">
                  {label}
                </a>
              ))}
            </nav>
          </div>
        </footer>
      </div>
    </Motion>
  );
}

/* ───────── Pieces ───────── */

function Kicker({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <p className="inline-flex items-center gap-2 text-[0.8rem] font-medium text-brand">
      {icon ? <span className="flex size-7 items-center justify-center rounded-lg bg-brand-soft [&_svg]:size-4">{icon}</span> : null}
      {children}
    </p>
  );
}

function SectionTitle({ kicker, icon, title, lead, powered }: { kicker?: string; icon?: React.ReactNode; title: string; lead?: string; /** What this feature runs on: a `PoweredBy` line. */ powered?: React.ReactNode }) {
  return (
    <Reveal className="mx-auto max-w-[42rem] text-center">
      {kicker ? <Kicker icon={icon}>{kicker}</Kicker> : null}
      <h2 className={cn("font-display text-[2rem] leading-[1.1] text-balance sm:text-[2.6rem]", kicker && "mt-4")}>{title}</h2>
      {lead ? <p className="mt-3 text-[1.02rem] leading-relaxed text-pretty text-muted-foreground">{lead}</p> : null}
      {powered ? <div className="mt-4 flex justify-center">{powered}</div> : null}
    </Reveal>
  );
}

const MARKS = { exa: ["exa-color", "Exa"], gemini: ["gemini-color", "Gemini"], claude: ["claude-color", "Claude"] } as const;
/** The models behind the agent: the four modes, quickest to deepest thinker's makers side by side. */
const MODELS = "Gemini 4 Carbon, Gemini 4 Hydrogen, Claude Opus 5.5, Claude Sonnet 5.5";

/**
 * What a feature runs on: the makers' marks, then the names. The same quiet line under every
 * feature; it wraps on a narrow screen and reads in both themes (the marks carry their own colours).
 */
function PoweredBy({ marks, children, className }: { marks: Array<keyof typeof MARKS>; children: React.ReactNode; className?: string }) {
  return (
    <p className={cn("inline-flex max-w-full items-start gap-2.5 rounded-2xl border border-border/70 bg-card/60 px-3 py-1.5 text-left text-[0.78rem] leading-snug text-muted-foreground", className)}>
      <span className="mt-px flex shrink-0 items-center gap-1.5">
        {marks.map((mark) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={mark} src={`/landing/logos/${MARKS[mark][0]}.svg`} alt={MARKS[mark][1]} width={16} height={16} loading="lazy" className="size-4" />
        ))}
      </span>
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/** What someone typed, as the chat shows it. */
function Bubble({ children }: { children: React.ReactNode }) {
  return <p className="ml-auto w-fit max-w-[88%] rounded-[1.25rem] rounded-br-md bg-muted px-4 py-2.5 text-left text-[0.92rem] leading-snug text-foreground">{children}</p>;
}

/** One thing you can ask for: the question, and the card it gets, live. */
function Example({ icon, label, question, name, className }: { icon: React.ReactNode; label: string; question: string; name: DemoName; className?: string }) {
  return (
    <StaggerItem className={cn("min-w-0", className)}>
      {/* On a phone the card inside gets nearly the whole width of the tile: it lays itself out by the room it has. */}
      <div className="flex h-full w-full min-w-0 flex-col overflow-hidden rounded-3xl border border-border bg-surface/60 py-3 sm:p-4">
        <div className="flex min-w-0 items-center justify-between gap-3 px-4 sm:px-1">
          <Kicker icon={icon}>{label}</Kicker>
        </div>
        <div className="mt-3 min-w-0 px-3 sm:px-0">
          <Bubble>{question}</Bubble>
        </div>
        {/* Under 400 px the card is drawn at nine tenths of its size, so it has the room it has in the app on a phone. */}
        <div className="fade-below mt-3 h-[23rem] w-full min-w-0 overflow-hidden px-1.5 sm:px-0">
          <Live name={name} className="w-full min-w-0 max-[399px]:[zoom:0.9]" />
        </div>
      </div>
    </StaggerItem>
  );
}

function Point({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand [&_svg]:size-4">{icon}</span>
      <span className="text-[0.92rem] leading-snug">
        <span className="block font-medium text-foreground">{title}</span>
        <span className="mt-0.5 block text-muted-foreground">{children}</span>
      </span>
    </li>
  );
}

/** A notice like the ones the app shows, floating in front of the hero. */
function Notice({ icon, title, line, tone = "brand" }: { icon: React.ReactNode; title: string; line: string; tone?: "brand" | "brass" }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-border bg-card/95 p-3.5 text-left shadow-float backdrop-blur">
      <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full [&_svg]:size-4", tone === "brass" ? "bg-brass/15 text-brass" : "bg-brand-soft text-brand")}>{icon}</span>
      <span className="min-w-0 text-[0.82rem] leading-snug">
        <span className="block font-medium">{title}</span>
        <span className="mt-0.5 block text-muted-foreground">{line}</span>
      </span>
    </div>
  );
}

/** A short point under a picture: a name and a sentence. */
function Mini({ icon, title, children }: { icon?: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <StaggerItem>
      <div className="h-full rounded-2xl border border-border bg-card p-5 shadow-card">
        <p className="flex items-center gap-2 text-[0.95rem] font-semibold tracking-tight">
          {icon ? <span className="text-brand [&_svg]:size-4">{icon}</span> : null}
          {title}
        </p>
        <p className="mt-1.5 text-[0.88rem] leading-relaxed text-muted-foreground">{children}</p>
      </div>
    </StaggerItem>
  );
}

/** One of the smaller things: a name, a sentence, and something to look at. */
function Card({ icon, title, text, className, children }: { icon: React.ReactNode; title: string; text: string; className?: string; children?: React.ReactNode }) {
  return (
    <StaggerItem className={cn("min-w-0", className)}>
      <div className="flex h-full flex-col rounded-3xl border border-border bg-card p-5 shadow-card sm:p-6">
        <span className="flex size-9 items-center justify-center rounded-xl bg-brand-soft text-brand [&_svg]:size-[1.1rem]">{icon}</span>
        <h3 className="mt-4 text-[1.08rem] leading-tight font-semibold tracking-tight">{title}</h3>
        <p className="mt-2 text-[0.92rem] leading-relaxed text-muted-foreground">{text}</p>
        {children ? <div className="mt-5 pt-0 md:mt-auto md:pt-5">{children}</div> : null}
      </div>
    </StaggerItem>
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

/** One of the three whose work Beryl stands on: its mark, its name, and what it does here. */
function Maker({ logo, name, by, what }: { logo: string; name: string; by?: string; what: string }) {
  return (
    <StaggerItem>
      <div className="flex h-full flex-col items-center rounded-3xl border border-border bg-card px-6 py-7 text-center shadow-card">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/landing/logos/${logo}.svg`} alt="" width={44} height={44} loading="lazy" className="size-11" />
        <p className="font-display mt-4 text-[1.35rem] leading-none">{name}</p>
        <p className="mt-1.5 h-4 text-[0.78rem] text-subtle">{by ? `by ${by}` : ""}</p>
        <p className="mt-3 text-[0.9rem] leading-relaxed text-muted-foreground">{what}</p>
      </div>
    </StaggerItem>
  );
}

/**
 * The email a job sends, small. It is light whatever the page's theme, as in an inbox, and laid
 * out like the real one (src/lib/email/layout.ts): the label, the job's name, when it ran, the
 * result, the way back. The stories are made up.
 */
function EmailMock() {
  const ink = "oklch(0.24 0.02 165)";
  const muted = "oklch(0.5 0.02 165)";
  const brand = "oklch(0.5 0.11 163)";
  return (
    <div className="overflow-hidden rounded-2xl border border-black/10 bg-[oklch(0.97_0.006_160)] text-left shadow-float" style={{ color: ink }}>
      <div className="flex items-center gap-2.5 border-b border-black/10 bg-white/70 px-4 py-2.5 text-[0.74rem]" style={{ color: muted }}>
        <Mail className="size-3.5 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate">
          <span className="font-semibold" style={{ color: ink }}>
            {APP_NAME}
          </span>{" "}
          · Morning AI news · Mon 08:00
        </span>
      </div>
      <div className="p-4">
        <div className="rounded-xl border border-black/10 bg-white p-4">
          <p className="text-[0.62rem] font-semibold tracking-[0.1em] uppercase" style={{ color: brand }}>
            Job result
          </p>
          <p className="mt-1.5 text-[1.02rem] leading-tight font-bold">Morning AI news</p>
          <p className="mt-1 text-[0.72rem]" style={{ color: muted }}>
            Mon 16 Nov, 08:00 · Every weekday at 08:00
          </p>
          <ol className="mt-3 space-y-2 border-t border-black/10 pt-3 text-[0.78rem] leading-snug">
            {[
              ["A new open model tops the coding benchmarks.", "paperswithcode.com"],
              ["The EU publishes its guidance for general-purpose models.", "europa.eu"],
              ["Two chip makers agree to share a packaging plant.", "reuters.com"],
            ].map(([story, source], i) => (
              <li key={story} className="flex gap-2">
                <span className="nums shrink-0 font-semibold" style={{ color: muted }}>
                  {i + 1}.
                </span>
                <span>
                  <span className="font-semibold">{story}</span>{" "}
                  <span className="underline" style={{ color: brand }}>
                    {source}
                  </span>
                </span>
              </li>
            ))}
          </ol>
          <span className="mt-3.5 inline-flex h-7 items-center rounded-full px-3 text-[0.72rem] font-semibold text-white" style={{ background: brand }}>
            Open this run
          </span>
        </div>
      </div>
    </div>
  );
}
