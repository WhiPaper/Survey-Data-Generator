import rootVersions from "../../../versions.json" with { type: "json" };
import { z } from "zod";

export const BuildVersionsSchema = z
  .object({
    appVersion: z.string().min(1),
    protocolVersion: z.number().int().positive(),
    databaseSchemaVersion: z.number().int().nonnegative(),
    domainSchemaVersion: z.number().int().nonnegative(),
    engineVersion: z.number().int().nonnegative(),
    profilerVersion: z.number().int().nonnegative(),
  })
  .strict();

export type BuildVersions = z.infer<typeof BuildVersionsSchema>;

export const VERSIONS: Readonly<BuildVersions> = Object.freeze(
  BuildVersionsSchema.parse(rootVersions),
);
