import { createHash } from "node:crypto";

import { asc, eq } from "drizzle-orm";

import type {
  SourceScope,
  SynthesisStartResult,
  SynthesisTarget,
  TargetDraft,
  TargetDraftTarget,
  TargetDraftView,
  TargetIssue,
  TargetProfileResult,
  TargetsValidateResult,
} from "@survey-synth/contracts";
import type { AnswerSlot, FormSnapshot, NormalizedResponse, QuestionId } from "@survey-synth/domain";

import { backendFailure } from "../errors";
import type { SurveyDatabase } from "../persistence/database";
import { formSnapshots, targetDrafts, valueGroups } from "../persistence/schema";
import {
  getProject,
  getSourceRevision,
  listSourceResponses,
  type StoredSourceResponse,
} from "../persistence/store";
import type { SynthesisService } from "../synthesis/service";

type ScopeContext = {
  revisionId: string;
  revisionHash: string;
  sourceScope: SourceScope;
  responses: StoredSourceResponse[];
  responseSetHash: string;
  form: FormSnapshot;
};

type ValueGroupRecord = typeof valueGroups.$inferSelect;

const parseTimestamp = (value: string, label: string): number => {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw backendFailure("VALIDATION_FAILED", `${label} timestamp is invalid`);
  }
  return timestamp;
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

const parseForm = (schemaJson: string): FormSnapshot => {
  const parsed = JSON.parse(schemaJson) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw backendFailure("INTERNAL", "Stored Form snapshot is invalid");
  }
  const form = parsed as FormSnapshot;
  if (!Array.isArray(form.questions)) {
    throw backendFailure("INTERNAL", "Stored Form snapshot is invalid");
  }
  return form;
};

const normalizedResponse = (value: unknown): NormalizedResponse => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw backendFailure("INTERNAL", "Stored normalized response is invalid");
  }
  return value as NormalizedResponse;
};

const scopeContext = (
  db: SurveyDatabase,
  projectId: string,
  requested: SourceScope | undefined,
): ScopeContext => {
  const project = getProject(db, projectId);
  if (!project) throw backendFailure("NOT_FOUND", "Project was not found");
  if (!project.currentSourceRevisionId) {
    throw backendFailure("VALIDATION_FAILED", "Project has no imported source revision");
  }
  const revision = getSourceRevision(db, project.currentSourceRevisionId);
  if (!revision || revision.projectId !== project.id) {
    throw backendFailure("INTERNAL", "Project source revision is invalid");
  }
  const snapshot = db
    .select()
    .from(formSnapshots)
    .where(eq(formSnapshots.id, revision.formSnapshotId))
    .get();
  if (!snapshot) throw backendFailure("INTERNAL", "Source revision Form snapshot is missing");

  const allResponses = listSourceResponses(db, revision.id);
  const sourceScope = requested ?? { kind: "all" as const };
  if (sourceScope.kind === "all") {
    return {
      revisionId: revision.id,
      revisionHash: revision.responseSetHash,
      sourceScope,
      responses: allResponses,
      responseSetHash: revision.responseSetHash,
      form: parseForm(snapshot.schemaJson),
    };
  }

  const startMs = parseTimestamp(sourceScope.start, "Start");
  const endMs = parseTimestamp(sourceScope.end, "End");
  if (startMs > endMs) {
    throw backendFailure("VALIDATION_FAILED", "SourceScope start must not be after end");
  }
  const responses = allResponses.filter(
    (response) => response.submittedAtMs >= startMs && response.submittedAtMs <= endMs,
  );
  return {
    revisionId: revision.id,
    revisionHash: revision.responseSetHash,
    sourceScope: {
      kind: "submitted_between",
      start: new Date(startMs).toISOString(),
      end: new Date(endMs).toISOString(),
    },
    responses,
    responseSetHash: subsetHash(revision.id, responses),
    form: parseForm(snapshot.schemaJson),
  };
};

const parseMembers = (row: ValueGroupRecord): string[] => {
  const parsed = JSON.parse(row.membersJson) as unknown;
  if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== "string" || !value)) {
    throw backendFailure("INTERNAL", "Stored ValueGroup members are invalid");
  }
  return parsed;
};

const projectGroups = (db: SurveyDatabase, projectId: string): ValueGroupRecord[] =>
  db
    .select()
    .from(valueGroups)
    .where(eq(valueGroups.projectId, projectId))
    .orderBy(asc(valueGroups.createdAtMs), asc(valueGroups.id))
    .all();

const groupById = (groups: readonly ValueGroupRecord[], id: string): ValueGroupRecord | undefined =>
  groups.find((group) => group.id === id);

const answers = (responses: readonly StoredSourceResponse[], questionId: string) =>
  responses.map((stored) => normalizedResponse(stored.response).answers[questionId as QuestionId]);

const eligible = (slot: AnswerSlot | undefined): boolean =>
  slot?.state === "answered" || slot?.state === "skipped";

const subjectMetric = (
  context: ScopeContext,
  groups: readonly ValueGroupRecord[],
  subject: Extract<TargetDraftTarget, { kind: "count" | "share" }>["subject"],
): { count: number; denominatorCount: number; share: number } | null => {
  if (subject.kind === "option") {
    const question = context.form.questions.find(
      (candidate) => candidate.id === subject.questionId,
    );
    if (!question || question.kind !== "single_choice") return null;
    if (!question.options.some((option) => String(option.key) === subject.optionKey)) return null;
    let count = 0;
    let denominatorCount = 0;
    for (const slot of answers(context.responses, question.id)) {
      if (!eligible(slot)) continue;
      denominatorCount += 1;
      if (
        slot?.state === "answered" &&
        slot.value.kind === "single_choice" &&
        String(slot.value.optionKey) === subject.optionKey
      ) {
        count += 1;
      }
    }
    return {
      count,
      denominatorCount,
      share: denominatorCount === 0 ? 0 : count / denominatorCount,
    };
  }

  if (subject.kind === "checkbox_option") {
    const question = context.form.questions.find(
      (candidate) => candidate.id === subject.questionId,
    );
    if (!question || question.kind !== "multi_choice") return null;
    if (!question.options.some((option) => String(option.key) === subject.optionKey)) return null;
    let count = 0;
    let denominatorCount = 0;
    for (const slot of answers(context.responses, question.id)) {
      if (!eligible(slot)) continue;
      denominatorCount += 1;
      if (
        slot?.state === "answered" &&
        slot.value.kind === "multi_choice" &&
        slot.value.optionKeys.some((key) => String(key) === subject.optionKey)
      ) {
        count += 1;
      }
    }
    return {
      count,
      denominatorCount,
      share: denominatorCount === 0 ? 0 : count / denominatorCount,
    };
  }

  const group = groupById(groups, subject.valueGroupId);
  if (!group) return null;
  const members = new Set(parseMembers(group));
  const question = context.form.questions.find((candidate) => candidate.id === group.questionId);
  if (!question || (question.kind !== "single_choice" && question.kind !== "text")) return null;
  let count = 0;
  let denominatorCount = 0;
  for (const slot of answers(context.responses, question.id)) {
    if (!eligible(slot)) continue;
    denominatorCount += 1;
    if (slot?.state !== "answered") continue;
    let value: string | null = null;
    if (question.kind === "single_choice" && slot.value.kind === "single_choice") {
      value = String(slot.value.optionKey);
    } else if (question.kind === "text" && slot.value.kind === "text") {
      value = slot.value.value;
    }
    if (value !== null && members.has(value)) count += 1;
  }
  return { count, denominatorCount, share: denominatorCount === 0 ? 0 : count / denominatorCount };
};

const meanMetric = (
  context: ScopeContext,
  questionId: string,
): { mean: number; denominatorCount: number } | null => {
  const question = context.form.questions.find((candidate) => candidate.id === questionId);
  if (!question || question.kind !== "ordinal") return null;
  const values: number[] = [];
  for (const slot of answers(context.responses, question.id)) {
    if (slot?.state === "answered" && slot.value.kind === "ordinal") values.push(slot.value.value);
  }
  return {
    mean: values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length,
    denominatorCount: values.length,
  };
};

const conditionalMetric = (
  context: ScopeContext,
  groups: readonly ValueGroupRecord[],
  target: Extract<TargetDraftTarget, { kind: "conditional_share" }>,
): { count: number; denominatorCount: number; share: number } | null => {
  const group = groupById(groups, target.population.valueGroupId);
  if (!group) return null;
  const members = new Set(parseMembers(group));
  const populationQuestion = context.form.questions.find(
    (candidate) => candidate.id === group.questionId,
  );
  const checkboxQuestion = context.form.questions.find(
    (candidate) => candidate.id === target.questionId,
  );
  if (
    !populationQuestion ||
    (populationQuestion.kind !== "single_choice" && populationQuestion.kind !== "text") ||
    !checkboxQuestion ||
    checkboxQuestion.kind !== "multi_choice" ||
    !checkboxQuestion.options.some((option) => String(option.key) === target.optionKey)
  ) {
    return null;
  }

  let count = 0;
  let denominatorCount = 0;
  for (const stored of context.responses) {
    const response = normalizedResponse(stored.response);
    const population = response.answers[populationQuestion.id];
    let raw: string | null = null;
    if (population?.state === "answered") {
      if (
        populationQuestion.kind === "single_choice" &&
        population.value.kind === "single_choice"
      ) {
        raw = String(population.value.optionKey);
      } else if (populationQuestion.kind === "text" && population.value.kind === "text") {
        raw = population.value.value;
      }
    }
    if (raw === null || !members.has(raw)) continue;
    const checkbox = response.answers[checkboxQuestion.id];
    if (!eligible(checkbox)) continue;
    denominatorCount += 1;
    if (
      checkbox?.state === "answered" &&
      checkbox.value.kind === "multi_choice" &&
      checkbox.value.optionKeys.some((key) => String(key) === target.optionKey)
    ) {
      count += 1;
    }
  }
  return { count, denominatorCount, share: denominatorCount === 0 ? 0 : count / denominatorCount };
};

const targetIssue = (
  targetIds: string[],
  code: TargetIssue["code"],
  message: string,
): TargetIssue => ({ targetIds: targetIds as TargetIssue["targetIds"], code, message });

const validateDraft = (
  db: SurveyDatabase,
  draft: TargetDraft,
): { context: ScopeContext; groups: ValueGroupRecord[]; issues: TargetIssue[] } => {
  const context = scopeContext(db, draft.projectId, draft.sourceScope);
  const groups = projectGroups(db, draft.projectId);
  const issues: TargetIssue[] = [];
  const seen = new Set<string>();

  for (const target of draft.targets) {
    const id = String(target.id);
    if (seen.has(id)) issues.push(targetIssue([id], "target_conflict", "TargetId must be unique"));
    seen.add(id);

    if (target.intent === null) continue;
    if (target.kind === "mean") {
      const question = context.form.questions.find(
        (candidate) => candidate.id === target.questionId,
      );
      if (!question || question.kind !== "ordinal") {
        issues.push(
          targetIssue([id], "invalid_subject", "Mean target must reference an ordinal question"),
        );
      } else if (target.intent.kind !== "absolute") {
        issues.push(
          targetIssue([id], "domain_unsupported", "Mean targets support absolute intent only"),
        );
      } else if (target.intent.value < question.min || target.intent.value > question.max) {
        issues.push(
          targetIssue([id], "out_of_range", "Mean target is outside the ordinal question range"),
        );
      }
      continue;
    }

    if (target.kind === "conditional_share") {
      if (!conditionalMetric(context, groups, target)) {
        issues.push(
          targetIssue(
            [id],
            "invalid_subject",
            "Conditional share target is not valid for this Form",
          ),
        );
      }
      if (target.intent.kind === "count_delta") {
        issues.push(
          targetIssue(
            [id],
            "domain_unsupported",
            "Conditional share does not support count delta intent",
          ),
        );
      } else if (
        target.intent.kind === "absolute" &&
        (target.intent.value < 0 || target.intent.value > 1)
      ) {
        issues.push(
          targetIssue([id], "out_of_range", "Conditional share target must be between 0 and 1"),
        );
      }
      continue;
    }

    if (!subjectMetric(context, groups, target.subject)) {
      issues.push(
        targetIssue([id], "invalid_subject", "Target subject is not valid for this Form"),
      );
    }
    if (target.kind === "count") {
      if (target.intent.kind !== "absolute" && target.intent.kind !== "count_delta") {
        issues.push(
          targetIssue(
            [id],
            "domain_unsupported",
            "Count target requires absolute or count_delta intent",
          ),
        );
      } else if (
        target.intent.kind === "absolute" &&
        (!Number.isInteger(target.intent.value) || target.intent.value < 0)
      ) {
        issues.push(
          targetIssue([id], "out_of_range", "Count target must be a non-negative integer"),
        );
      }
    }
    if (target.kind === "share") {
      if (target.intent.kind === "count_delta") {
        issues.push(
          targetIssue([id], "domain_unsupported", "Share target does not support count_delta intent"),
        );
      } else if (
        target.intent.kind === "absolute" &&
        (target.intent.value < 0 || target.intent.value > 1)
      ) {
        issues.push(targetIssue([id], "out_of_range", "Share target must be between 0 and 1"));
      }
    }
  }

  const directByQuestion = new Map<
    string,
    Array<Extract<TargetDraftTarget, { kind: "count" | "share" }>>
  >();
  for (const target of draft.targets) {
    if (
      (target.kind !== "count" && target.kind !== "share") ||
      target.subject.kind !== "option" ||
      target.intent?.kind !== "absolute"
    ) {
      continue;
    }
    const list = directByQuestion.get(target.subject.questionId) ?? [];
    list.push(target);
    directByQuestion.set(target.subject.questionId, list);
  }

  for (const targets of directByQuestion.values()) {
    const shareTotal = targets.reduce(
      (sum, target) => sum + (target.kind === "share" ? target.intent!.value : 0),
      0,
    );
    const ids = targets.map((target) => String(target.id));
    if (shareTotal > 1 + 1e-9) {
      issues.push(
        targetIssue(ids, "target_conflict", "Single-choice share targets exceed 100%"),
      );
      continue;
    }
    if (draft.finalCount !== null && Number.isInteger(draft.finalCount) && draft.finalCount > 0) {
      const requested = targets.reduce(
        (sum, target) =>
          sum +
          (target.kind === "count"
            ? target.intent!.value
            : target.intent!.value * draft.finalCount!),
        0,
      );
      if (requested > draft.finalCount + 1e-9) {
        issues.push(
          targetIssue(
            ids,
            "target_conflict",
            "Single-choice option targets exceed the final response count",
          ),
        );
      }
    }
  }

  return { context, groups, issues };
};

const resolveTarget = (
  context: ScopeContext,
  groups: readonly ValueGroupRecord[],
  target: TargetDraftTarget,
): SynthesisTarget | TargetIssue => {
  const id = String(target.id);
  if (target.intent === null) {
    return targetIssue([id], "domain_unsupported", "Target intent is incomplete");
  }

  if (target.kind === "mean") {
    if (target.intent.kind !== "absolute") {
      return targetIssue([id], "domain_unsupported", "Mean targets support absolute intent only");
    }
    return {
      id: target.id,
      kind: "mean",
      questionId: target.questionId,
      value: target.intent.value,
    };
  }

  const metric =
    target.kind === "conditional_share"
      ? conditionalMetric(context, groups, target)
      : subjectMetric(context, groups, target.subject);
  if (!metric) return targetIssue([id], "invalid_subject", "Target metric could not be profiled");

  let value: number;
  switch (target.intent.kind) {
    case "absolute":
      value = target.intent.value;
      break;
    case "count_delta":
      if (target.kind !== "count") {
        return targetIssue(
          [id],
          "domain_unsupported",
          "count_delta is valid only for count targets",
        );
      }
      value = metric.count + target.intent.value;
      break;
    case "percentage_point_delta":
      if (target.kind === "count") {
        return targetIssue(
          [id],
          "domain_unsupported",
          "percentage_point_delta is valid only for ratio targets",
        );
      }
      value = metric.share + target.intent.value;
      break;
    case "relative_percent_delta":
      if (target.kind === "count") {
        return targetIssue(
          [id],
          "domain_unsupported",
          "relative_percent_delta is valid only for ratio targets",
        );
      }
      value = metric.share * (1 + target.intent.value);
      break;
  }

  if (target.kind === "count") {
    if (!Number.isInteger(value) || value < 0) {
      return targetIssue(
        [id],
        "out_of_range",
        "Resolved count target must be a non-negative integer",
      );
    }
    return { id: target.id, kind: "count", subject: target.subject, value };
  }
  if (value < 0 || value > 1) {
    return targetIssue([id], "out_of_range", "Resolved share target must be between 0 and 1");
  }
  if (target.kind === "share") {
    return { id: target.id, kind: "share", subject: target.subject, value };
  }
  return {
    id: target.id,
    kind: "conditional_share",
    population: target.population,
    questionId: target.questionId,
    optionKey: target.optionKey,
    value,
  };
};

const profile = (
  db: SurveyDatabase,
  projectId: string,
  sourceScope?: SourceScope,
): TargetProfileResult => {
  const context = scopeContext(db, projectId, sourceScope);
  const groups = projectGroups(db, projectId);
  const metrics: TargetProfileResult["metrics"] = [];

  for (const question of context.form.questions) {
    if (question.kind === "single_choice") {
      for (const option of question.options) {
        const subject = {
          kind: "option" as const,
          questionId: String(question.id),
          optionKey: String(option.key),
        };
        const metric = subjectMetric(context, groups, subject);
        if (metric) metrics.push({ kind: "subject", subject, ...metric });
      }
    } else if (question.kind === "multi_choice") {
      for (const option of question.options) {
        const subject = {
          kind: "checkbox_option" as const,
          questionId: String(question.id),
          optionKey: String(option.key),
        };
        const metric = subjectMetric(context, groups, subject);
        if (metric) metrics.push({ kind: "subject", subject, ...metric });
      }
    } else if (question.kind === "ordinal") {
      const metric = meanMetric(context, String(question.id));
      if (metric) metrics.push({ kind: "mean", questionId: String(question.id), ...metric });
    }
  }

  for (const group of groups) {
    const subject = { kind: "value_group" as const, valueGroupId: group.id };
    const metric = subjectMetric(context, groups, subject);
    if (metric) metrics.push({ kind: "subject", subject, ...metric });
  }

  return {
    projectId,
    sourceRevisionId: context.revisionId,
    sourceScope: context.sourceScope,
    responseCount: context.responses.length,
    responseSetHash: context.responseSetHash,
    metrics,
  };
};

export interface TargetService {
  profile(projectId: string, sourceScope?: SourceScope): Promise<TargetProfileResult>;
  validate(draft: TargetDraft): Promise<TargetsValidateResult>;
  getDraft(projectId: string): Promise<TargetDraftView | null>;
  saveDraft(draft: TargetDraft): Promise<TargetDraftView>;
  startDraft(projectId: string, operationId?: string): Promise<SynthesisStartResult>;
}

export const createTargetService = (
  db: SurveyDatabase,
  synthesis: SynthesisService,
): TargetService => ({
  profile: async (projectId, sourceScope) => profile(db, projectId, sourceScope),

  validate: async (draft) => ({ issues: validateDraft(db, draft).issues }),

  getDraft: async (projectId) => {
    const row = db.select().from(targetDrafts).where(eq(targetDrafts.projectId, projectId)).get();
    if (!row) return null;
    return {
      ...(JSON.parse(row.draftJson) as TargetDraft),
      updatedAt: new Date(row.updatedAtMs).toISOString(),
    };
  },

  saveDraft: async (draft) => {
    if (!getProject(db, draft.projectId))
      throw backendFailure("NOT_FOUND", "Project was not found");
    const nowMs = Date.now();
    db.insert(targetDrafts)
      .values({ projectId: draft.projectId, draftJson: JSON.stringify(draft), updatedAtMs: nowMs })
      .onConflictDoUpdate({
        target: targetDrafts.projectId,
        set: { draftJson: JSON.stringify(draft), updatedAtMs: nowMs },
      })
      .run();
    return { ...draft, updatedAt: new Date(nowMs).toISOString() };
  },

  startDraft: async (projectId, operationId) => {
    const row = db.select().from(targetDrafts).where(eq(targetDrafts.projectId, projectId)).get();
    if (!row) throw backendFailure("VALIDATION_FAILED", "Project has no saved target draft");
    const draft = JSON.parse(row.draftJson) as TargetDraft;
    const { context, groups, issues } = validateDraft(db, draft);
    if (draft.finalCount === null || !Number.isInteger(draft.finalCount) || draft.finalCount <= 0) {
      issues.push(targetIssue([], "out_of_range", "Final count must be a positive integer"));
    }
    if (draft.targets.length === 0) {
      issues.push(targetIssue([], "domain_unsupported", "At least one target is required"));
    }
    const resolved: SynthesisTarget[] = [];
    for (const target of draft.targets) {
      const result = resolveTarget(context, groups, target);
      if ("code" in result) issues.push(result);
      else resolved.push(result);
    }
    if (issues.length > 0) return { status: "infeasible", issues };

    return synthesis.start({
      projectId,
      finalCount: draft.finalCount!,
      targets: resolved,
      sourceScope: context.sourceScope,
      seed: draft.seed,
      ...(operationId ? { operationId } : {}),
    });
  },
});
