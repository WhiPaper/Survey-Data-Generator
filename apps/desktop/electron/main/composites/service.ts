import { randomUUID } from "node:crypto";

import type {
  AugmentationBatchDraft,
  AugmentationBatchEditorDraft,
  AugmentationBatchEditorDraftView,
  CompositeResult,
  CompositeStartResult,
  SynthesisTarget,
} from "@survey-synth/contracts";
import { eq } from "drizzle-orm";

import { backendFailure } from "../errors";
import {
  getCompositeRecord,
  listCompositeChildren,
  listCompositeRecords,
  persistComposite,
} from "../persistence/composite-store";
import type { SurveyDatabase } from "../persistence/database";
import { getProject, getSourceRevision } from "../persistence/store";
import type { SynthesisService } from "../synthesis/service";
import type { TargetService } from "../targets/service";
import { resolveSourceScope } from "../source-scope";
import { getRunRecord } from "../persistence/run-store";
import { preferences } from "../persistence/schema";

type PendingBatch = {
  draft: AugmentationBatchDraft;
  revisionId: string;
  next: number;
  children: Array<{ ruleId: string; runId: string }>;
  planId?: string;
};

const compositeView = (db: SurveyDatabase, compositeId: string): CompositeResult => {
  const composite = getCompositeRecord(db, compositeId);
  if (!composite) throw backendFailure("NOT_FOUND", "Composite result was not found");
  return {
    compositeId: composite.id,
    projectId: composite.projectId,
    sourceRevisionId: composite.sourceRevisionId,
    overlapPolicy: "reject",
    createdAt: new Date(composite.createdAtMs).toISOString(),
    finalResponseCount: composite.finalResponseCount,
    children: listCompositeChildren(db, composite.id).map((child) => {
      const run = getRunRecord(db, child.runId);
      if (!run) throw backendFailure("INTERNAL", "Composite child Run is missing");
      const target = JSON.parse(run.targetJson) as {
        sourceScope: CompositeResult["children"][number]["sourceScope"];
      };
      const report = JSON.parse(run.engineReportJson) as {
        achieved?: CompositeResult["children"][number]["outcome"];
      };
      if (!report.achieved) throw backendFailure("INTERNAL", "Composite child outcome is missing");
      return {
        ruleId: child.ruleId,
        runId: child.runId,
        count: child.count,
        sourceScope: target.sourceScope,
        scopeResponseCount: child.scopeResponseCount,
        finalResponseCount: child.finalResponseCount,
        outcome: report.achieved,
      };
    }),
  };
};

export type CompositeService = {
  start(draft: AugmentationBatchDraft): Promise<CompositeStartResult>;
  resolveEditPlan(
    batchId: string,
    choice: "append_only" | "replacement",
  ): Promise<CompositeStartResult>;
  get(compositeId: string): Promise<CompositeResult>;
  list(projectId: string): Promise<CompositeResult[]>;
  getDraft(projectId: string): Promise<AugmentationBatchEditorDraftView | null>;
  saveDraft(draft: AugmentationBatchEditorDraft): Promise<AugmentationBatchEditorDraftView>;
};

export const createCompositeService = (
  db: SurveyDatabase,
  synthesis: SynthesisService,
  targets?: TargetService,
): CompositeService => {
  const pending = new Map<string, PendingBatch>();
  const advance = async (batchId: string, state: PendingBatch): Promise<CompositeStartResult> => {
    for (; state.next < state.draft.rules.length; state.next += 1) {
      const rule = state.draft.rules[state.next]!;
      const scope = resolveSourceScope(db, state.revisionId, rule.sourceScope);
      const finalCount =
        rule.count.kind === "add" ? scope.responseCount + rule.count.value : rule.count.value;
      if (
        finalCount < scope.responseCount ||
        (rule.targets.length === 0 && finalCount <= scope.responseCount)
      ) {
        return {
          status: "infeasible",
          issues: [
            {
              targetIds: [],
              code: "out_of_range",
              message: `Rule ${rule.ruleId} must add at least one response`,
            },
          ],
        };
      }
      const profile = targets
        ? await targets.profileForRevision(
            state.draft.projectId,
            state.revisionId,
            scope.sourceScope,
            rule.scoreMappings,
          )
        : null;
      const resolvedTargets = rule.targets.map((target): SynthesisTarget => {
        const intent = rule.targetIntents?.find(
          (entry) => String(entry.targetId) === String(target.id),
        )?.intent;
        if (!intent || intent.kind === "absolute" || target.kind === "mean") return target;
        const metric = profile?.metrics.find((candidate) => {
          if (target.kind === "conditional_share" && candidate.kind === "conditional_share")
            return (
              candidate.questionId === target.questionId &&
              candidate.optionKey === target.optionKey &&
              candidate.population.valueGroupId === target.population.valueGroupId
            );
          if ((target.kind === "count" || target.kind === "share") && candidate.kind === "subject")
            return JSON.stringify(candidate.subject) === JSON.stringify(target.subject);
          return false;
        });
        if (!metric)
          throw backendFailure(
            "VALIDATION_FAILED",
            `Rule ${rule.ruleId} target baseline is unavailable`,
          );
        const baseline =
          target.kind === "count"
            ? (metric as { count: number }).count
            : (metric as { share: number }).share;
        const value =
          intent.kind === "count_delta"
            ? baseline + intent.value
            : intent.kind === "percentage_point_delta"
              ? baseline + intent.value
              : baseline * (1 + intent.value);
        return { ...target, value } as SynthesisTarget;
      });
      const result = await synthesis.start({
        projectId: state.draft.projectId,
        finalCount,
        targets: resolvedTargets,
        ...(rule.targetIntents ? { targetIntents: rule.targetIntents } : {}),
        ...(rule.scoreMappings ? { scoreMappings: rule.scoreMappings } : {}),
        sourceScope: scope.sourceScope,
        seed: rule.seed,
        sourceRevisionId: state.revisionId,
      } as never);
      if (result.status === "infeasible") return result;
      if (result.status === "approval_required") {
        state.planId = result.planId;
        pending.set(batchId, state);
        return {
          status: "approval_required",
          batchId,
          ruleId: rule.ruleId,
          planId: result.planId,
          editPlan: result.editPlan,
        };
      }
      state.children.push({ ruleId: rule.ruleId, runId: result.runId });
    }
    const id = randomUUID();
    persistComposite(db, {
      id,
      projectId: state.draft.projectId,
      sourceRevisionId: state.revisionId,
      overlapPolicy: "reject",
      finalResponseCount:
        getSourceRevision(db, state.revisionId)!.responseCount +
        state.children.reduce((sum, child) => {
          const run = getRunRecord(db, child.runId)!;
          return sum + run.finalResponseCount - run.scopeResponseCount;
        }, 0),
      children: state.children.map((child) => {
        const run = getRunRecord(db, child.runId)!;
        const rule = state.draft.rules.find((item) => item.ruleId === child.ruleId)!;
        return {
          ...child,
          count: rule.count,
          scopeResponseCount: run.scopeResponseCount,
          finalResponseCount: run.finalResponseCount,
        };
      }),
    });
    pending.delete(batchId);
    return { status: "success", composite: compositeView(db, id) };
  };
  return {
    async start(draft) {
      const project = getProject(db, draft.projectId);
      if (!project?.currentSourceRevisionId)
        throw backendFailure("VALIDATION_FAILED", "Project has no imported source revision");
      const revision = getSourceRevision(db, project.currentSourceRevisionId);
      if (!revision || revision.projectId !== project.id)
        throw backendFailure("INTERNAL", "Project source revision is invalid");
      const ownerByResponse = new Map<string, string>();
      for (const rule of draft.rules) {
        for (const response of resolveSourceScope(db, revision.id, rule.sourceScope).responses) {
          const previous = ownerByResponse.get(response.responseId);
          if (previous)
            return {
              status: "infeasible",
              issues: [
                {
                  targetIds: [],
                  code: "target_conflict",
                  message: `Rules ${previous} and ${rule.ruleId} overlap on source responses`,
                },
              ],
            };
          ownerByResponse.set(response.responseId, rule.ruleId);
        }
      }
      const batchId = randomUUID();
      return advance(batchId, { draft, revisionId: revision.id, next: 0, children: [] });
    },
    async resolveEditPlan(batchId, choice) {
      const state = pending.get(batchId);
      if (!state?.planId)
        throw backendFailure("NOT_FOUND", "Composite EditPlan is no longer available");
      const result = await synthesis.resolveEditPlan({ planId: state.planId, choice });
      state.children.push({ ruleId: state.draft.rules[state.next]!.ruleId, runId: result.runId });
      state.next += 1;
      state.planId = undefined;
      return advance(batchId, state);
    },
    async get(compositeId) {
      return compositeView(db, compositeId);
    },
    async list(projectId) {
      return listCompositeRecords(db, projectId).map((record) => compositeView(db, record.id));
    },
    async getDraft(projectId) {
      const row = db
        .select()
        .from(preferences)
        .where(eq(preferences.key, `composite.draft.${projectId}`))
        .get();
      if (!row) return null;
      return {
        ...(JSON.parse(row.valueJson) as AugmentationBatchEditorDraft),
        updatedAt: new Date(row.updatedAtMs).toISOString(),
      };
    },
    async saveDraft(draft) {
      if (!getProject(db, draft.projectId))
        throw backendFailure("NOT_FOUND", "Project was not found");
      const nowMs = Date.now();
      db.insert(preferences)
        .values({
          key: `composite.draft.${draft.projectId}`,
          valueJson: JSON.stringify(draft),
          updatedAtMs: nowMs,
        })
        .onConflictDoUpdate({
          target: preferences.key,
          set: { valueJson: JSON.stringify(draft), updatedAtMs: nowMs },
        })
        .run();
      return { ...draft, updatedAt: new Date(nowMs).toISOString() };
    },
  };
};
