import { z } from "zod";
import data from "./works-with.json";

/**
 * Which agent runtimes have bought through Dock unchanged, for a "works with" table. The JSON beside this file is
 * written by `examples/runtimes/run-all` after a live run of each example (see examples/runtimes/RESULTS.md); do
 * not edit it by hand. `verified` is true only when that run ended with the order committed or waiting for sign-off.
 */
export const WorksWithEntrySchema = z.object({
  runtime: z.string(), // display name, e.g. "Pydantic AI"
  slug: z.string(), // folder under examples/runtimes/
  language: z.enum(["Python", "TypeScript"]),
  package: z.string(), // the package whose version is reported
  version: z.string().nullable().optional(),
  interface: z.enum(["MCP", "OpenAPI 3.1"]),
  model: z.string().nullable().optional(), // provider:model-id used in the verifying run
  outcome: z.string().nullable().optional(), // committed | pending_approval | no_order | refused:<rule> | error
  verified: z.boolean(),
  verifiedDate: z.string(), // YYYY-MM-DD
  humanInput: z.string().nullable().optional(), // elicitation | relay+approval | relay+filter
  examplePath: z.string(),
  exampleUrl: z.string().regex(/^\/docs\//, "a document the app serves (/docs/...), never a link into the private repository"),
});
export type WorksWithEntry = z.infer<typeof WorksWithEntrySchema>;

export const WorksWithSchema = z.object({ generatedBy: z.string(), commit: z.string(), runtimes: z.array(WorksWithEntrySchema) });
export type WorksWith = z.infer<typeof WorksWithSchema>;

export const WORKS_WITH: WorksWith = WorksWithSchema.parse(data);
