/**
 * The desktop app, as the website offers it. Shared by the server and the browser, and read by
 * the packaging script (desktop/pack.mjs), which names its files from this list: no imports, and
 * nothing here but plain data and small functions.
 *
 * The landing page lists these and links each one to `/download/<id>`, where the server sends
 * the file (or sends the visitor on to wherever the files are hosted).
 */

export type DownloadId = "mac-arm64" | "mac-x64" | "windows-x64";

export type Download = {
  id: DownloadId;
  os: "mac" | "windows";
  /** What the button says: "Download for Mac". */
  label: string;
  /** Which computers it is for: "Apple silicon", "Intel", "Windows 10 and 11". */
  detail: string;
  /** What it needs, for the small print under the button. */
  requires: string;
  /** The file's name as it is saved on the visitor's computer. */
  file: string;
};

export const DOWNLOADS: Download[] = [
  { id: "mac-arm64", os: "mac", label: "Download for Mac", detail: "Apple silicon", requires: "macOS 13 or later, M1 chip or newer", file: "Beryl-mac-apple-silicon.dmg" },
  { id: "mac-x64", os: "mac", label: "Download for Mac", detail: "Intel", requires: "macOS 13 or later, Intel processor", file: "Beryl-mac-intel.dmg" },
  { id: "windows-x64", os: "windows", label: "Download for Windows", detail: "Windows 10 and 11", requires: "Windows 10 or 11, 64-bit", file: "Beryl-windows.zip" },
];

export const downloadHref = (id: DownloadId) => `/download/${id}`;

export const isDownloadId = (value: unknown): value is DownloadId => DOWNLOADS.some((d) => d.id === value);

/** What `/download/manifest` answers when the files are on this server: what was built, and when. */
export type DownloadManifest = {
  version: string;
  files: Array<{ id: DownloadId; file: string; size: number; sha256: string; builtAt: string }>;
};

/* ───────────────────────── Opening it the first time ─────────────────────────
 *
 * The downloads are not signed with a paid developer certificate, and the Mac ones are not
 * notarised by Apple. Both systems say so the first time the app is opened, and each has its own
 * way past. These are the steps, in the words the website shows.
 *
 * Checked on macOS 26 (14 November 2026): a downloaded disk image passes its "downloaded" mark on
 * to the app dragged out of it, and Gatekeeper rejects that app until the person allows it. The
 * Windows steps are the standard SmartScreen ones; the build has not been run on Windows yet.
 */

export type FirstLaunch = {
  os: "mac" | "windows";
  /** One line on why the system asks. */
  why: string;
  /** Getting it onto the computer. */
  install: string[];
  /** Getting past the warning, once. */
  open: string[];
  /** For older systems or people who prefer another way. */
  otherwise?: string;
};

export const FIRST_LAUNCH: Record<"mac" | "windows", FirstLaunch> = {
  mac: {
    os: "mac",
    why: "Beryl is not yet registered with Apple, so your Mac asks you to confirm before it opens the first time.",
    install: ["Open the file you downloaded.", "Drag Beryl onto the Applications folder.", "Open Beryl from Applications."],
    open: [
      "Your Mac says it could not verify Beryl. Click Done.",
      "Open System Settings and go to Privacy & Security.",
      "Scroll down to Security and click Open Anyway next to Beryl.",
      "Confirm with your password or Touch ID. You only do this once.",
    ],
    otherwise: "On macOS 13 or 14 it is quicker: right-click Beryl in Applications, choose Open, then Open again.",
  },
  windows: {
    os: "windows",
    why: "Beryl is not yet signed for Windows, so Windows asks you to confirm before it runs the first time.",
    install: ["Right-click the file you downloaded and choose Extract All.", "Open the Beryl folder.", "Double-click Beryl."],
    open: ["If a blue box says Windows protected your PC, click More info.", "Click Run anyway. You only do this once."],
    otherwise: "Keep the Beryl folder wherever you like. To remove Beryl, delete the folder.",
  },
};
