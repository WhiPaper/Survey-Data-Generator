import { createHash } from "node:crypto";

import type { SourceScope } from "@survey-synth/contracts";

import { backendFailure } from "./errors";
import type { SurveyDatabase } from "./persistence/database";
import {
  getSourceRevision,
  listSourceResponses,
  type StoredSourceResponse,
} from "./persistence/store";

export type ResolvedSourceScope = {
  revisionId: string;
  sourceScope: SourceScope;
  responseCount: number;
  responseSetHash: string;
  responses: StoredSourceResponse[];
  startMs?: number;
  endMs?: number;
};

const subsetHash = (revisionId: string, responses: readonly StoredSourceResponse[]): string => {
  const hash = createHash("sha256");
  hash.update(revisionId);
  for (const response of responses) {
    hash.update("\0");
    hash.update(response.responseId);
  }
  return hash.digest("hex");
};

/** Resolves and normalizes a scope against immutable source evidence. */
export const resolveSourceScope = (
  db: SurveyDatabase,
  revisionId: string,
  requested: SourceScope | undefined,
): ResolvedSourceScope => {
  const revision = getSourceRevision(db, revisionId);
  if (!revision) throw backendFailure("NOT_FOUND", "Source revision was not found");
  const responses = listSourceResponses(db, revisionId);
  const sourceScope = requested ?? { kind: "all" as const };
  if (sourceScope.kind === "all") {
    return {
      revisionId,
      sourceScope,
      responseCount: responses.length,
      responseSetHash: revision.responseSetHash,
      responses,
    };
  }
  const startMs = Date.parse(sourceScope.start);
  const endMs = Date.parse(sourceScope.end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    throw backendFailure("VALIDATION_FAILED", "SourceScope timestamp is invalid");
  }
  if (startMs > endMs) {
    throw backendFailure("VALIDATION_FAILED", "SourceScope start must not be after end");
  }
  const selected = responses.filter(
    (response) => response.submittedAtMs >= startMs && response.submittedAtMs <= endMs,
  );
  return {
    revisionId,
    sourceScope: {
      kind: "submitted_between",
      start: new Date(startMs).toISOString(),
      end: new Date(endMs).toISOString(),
    },
    responseCount: selected.length,
    responseSetHash: subsetHash(revisionId, selected),
    responses: selected,
    startMs,
    endMs,
  };
};
