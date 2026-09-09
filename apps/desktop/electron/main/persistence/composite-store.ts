import { asc, desc, eq } from "drizzle-orm";

import type { AugmentationCountSpec } from "@survey-synth/contracts";

import type { SurveyDatabase } from "./database";
import { compositeChildren, compositeResults } from "./schema";

export type PersistCompositeInput = {
  id: string;
  projectId: string;
  sourceRevisionId: string;
  overlapPolicy: "reject";
  finalResponseCount: number;
  children: readonly {
    ruleId: string;
    runId: string;
    count: AugmentationCountSpec;
    scopeResponseCount: number;
    finalResponseCount: number;
  }[];
  createdAtMs?: number;
};

export const persistComposite = (db: SurveyDatabase, input: PersistCompositeInput): void => {
  const createdAtMs = input.createdAtMs ?? Date.now();
  db.transaction((tx) => {
    tx.insert(compositeResults)
      .values({
        id: input.id,
        projectId: input.projectId,
        sourceRevisionId: input.sourceRevisionId,
        overlapPolicy: input.overlapPolicy,
        finalResponseCount: input.finalResponseCount,
        createdAtMs,
      })
      .run();
    tx.insert(compositeChildren)
      .values(
        input.children.map((child, position) => ({
          compositeId: input.id,
          position,
          ruleId: child.ruleId,
          runId: child.runId,
          countJson: JSON.stringify(child.count),
          scopeResponseCount: child.scopeResponseCount,
          finalResponseCount: child.finalResponseCount,
        })),
      )
      .run();
  });
};

export const getCompositeRecord = (db: SurveyDatabase, compositeId: string) =>
  db.select().from(compositeResults).where(eq(compositeResults.id, compositeId)).get() ?? null;

export const listCompositeRecords = (db: SurveyDatabase, projectId: string) =>
  db
    .select()
    .from(compositeResults)
    .where(eq(compositeResults.projectId, projectId))
    .orderBy(desc(compositeResults.createdAtMs), desc(compositeResults.id))
    .all();

export const listCompositeChildren = (db: SurveyDatabase, compositeId: string) =>
  db
    .select()
    .from(compositeChildren)
    .where(eq(compositeChildren.compositeId, compositeId))
    .orderBy(asc(compositeChildren.position))
    .all()
    .map((row) => ({
      ...row,
      count: JSON.parse(row.countJson) as AugmentationCountSpec,
    }));
