import type { ModeId } from "@/lib/agent/modes";

/** The signed-in account, as much of it as the interface needs. Shared by the server and the browser. */
export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: "user" | "admin";
  /** The modes this account may use, quickest first. Set by the admin; the admin has them all. */
  modes: ModeId[];
  /** Whether this account sees what its conversations and answers cost and used. */
  showUsage: boolean;
  /**
   * The most this account may spend in all, in US dollars, or null for no limit. Set by the
   * admin, who has none. Once what the account has used reaches it, nothing more runs until the
   * admin raises it.
   */
  usageCapUsd: number | null;
};
