import type { NormalizedResponse } from "@survey-synth/domain";

import { backendFailure } from "../errors";
import { listPersistedRunRows } from "../persistence/run-store";
import { getSourceRevision, listSourceResponses } from "../persistence/store";
import { resolveSourceScope } from "../source-scope";
import type { SurveyDatabase } from "../persistence/database";
import { getCompositeRecord, listCompositeChildren } from "../persistence/composite-store";
import { getRunRecord } from "../persistence/run-store";

export type CompositeRow = {
  responseId: string;
  submittedAtMs: number;
  response: NormalizedResponse;
};

/** The sole composition primitive for one or many disjoint scoped Runs. */
export const composeCompositeRows = (db: SurveyDatabase, compositeId: string): CompositeRow[] => {
  const composite = getCompositeRecord(db, compositeId);
  if (!composite) throw backendFailure("NOT_FOUND", "Composite result was not found");
  const revision = getSourceRevision(db, composite.sourceRevisionId);
  if (!revision || revision.projectId !== composite.projectId)
    throw backendFailure("INTERNAL", "Composite source revision is invalid");
  const claimed = new Set<string>();
  const childRows: CompositeRow[] = [];
  let delta = 0;
  for (const child of listCompositeChildren(db, compositeId)) {
    const run = getRunRecord(db, child.runId);
    if (!run || run.projectId !== composite.projectId || run.sourceRevisionId !== revision.id) {
      throw backendFailure("INTERNAL", "Composite child Run does not match its immutable base");
    }
    const snapshot = JSON.parse(run.targetJson) as {
      sourceScope: Parameters<typeof resolveSourceScope>[2];
    };
    const scope = resolveSourceScope(db, revision.id, snapshot.sourceScope);
    if (
      scope.responseCount !== run.scopeResponseCount ||
      scope.responseSetHash !== run.scopeResponseSetHash ||
      scope.responseCount !== child.scopeResponseCount
    ) {
      throw backendFailure(
        "INTERNAL",
        "Composite child scope evidence does not match immutable source evidence",
      );
    }
    for (const response of scope.responses) {
      if (claimed.has(response.responseId))
        throw backendFailure("VALIDATION_FAILED", "Composite child scopes overlap");
      claimed.add(response.responseId);
    }
    const rows = listPersistedRunRows(db, run.id);
    if (rows.length !== run.finalResponseCount || rows.length !== child.finalResponseCount)
      throw backendFailure("INTERNAL", "Composite child result is incomplete");
    childRows.push(
      ...rows.map(({ responseId, submittedAtMs, origin, response }) => ({
        // Synthetic ids are only internal ordering/provenance keys. Prefixing
        // them avoids equal seeds in different rules becoming unstable ties.
        responseId: origin === "synthetic" ? `${child.ruleId}:${responseId}` : responseId,
        submittedAtMs,
        response,
      })),
    );
    delta += run.finalResponseCount - run.scopeResponseCount;
  }
  const baseRows = listSourceResponses(db, revision.id)
    .filter((response) => !claimed.has(response.responseId))
    .map(({ responseId, submittedAtMs, response }) => ({
      responseId,
      submittedAtMs,
      response: response as NormalizedResponse,
    }));
  const rows = [...baseRows, ...childRows];
  if (new Set(rows.map((row) => row.responseId)).size !== rows.length) {
    throw backendFailure("INTERNAL", "Composite row identities are not unique");
  }
  if (
    rows.length !== revision.responseCount + delta ||
    rows.length !== composite.finalResponseCount
  ) {
    throw backendFailure("INTERNAL", "Composite final-count invariant failed");
  }
  return rows;
};
