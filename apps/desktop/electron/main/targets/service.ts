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
  LikertScoreMapping,
  TargetProfileResult,
  TargetsValidateResult,
} from "@survey-synth/contracts";
import type {
  AnswerSlot,
  FormSnapshot,
  NormalizedResponse,
  QuestionId,
} from "@survey-synth/domain";

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

const scoreMappingFor = (
  mappings: readonly LikertScoreMapping[] | undefined,
  questionId: string,
): LikertScoreMapping | undefined => mappings?.find((mapping) => mapping.questionId === questionId);

const scoreBounds = (
  question: FormSnapshot["questions"][number] | undefined,
  mapping: LikertScoreMapping | undefined,
): { min: number; max: number } | null => {
  if (question?.kind === "ordinal") return { min: question.min, max: question.max };
  if (question?.kind !== "single_choice" || !mapping) return null;
  const keys = new Set(mapping.optionScores.map((entry) => entry.optionKey));
  const scores = new Set(mapping.optionScores.map((entry) => entry.score));
  if (
    keys.size !== 5 ||
    scores.size !== 5 ||
    [1, 2, 3, 4, 5].some((score) => !scores.has(score)) ||
    question.options.length !== 5 ||
    question.options.some((option) => !keys.has(String(option.key)))
  ) {
    return null;
  }
  return { min: 1, max: 5 };
};

const normalizeLikertLabel = (value: string): string =>
  value.trim().replaceAll(/\s+/g, " ").toLocaleLowerCase();

const supportedLikertLabels = [
  ["매우 그렇다", "그렇다", "보통이다", "그렇지 않다", "전혀 그렇지 않다"],
  ["Strongly Agree", "Agree", "Neutral", "Disagree", "Strongly Disagree"],
  ["非常认同", "比较认同", "一般", "比较不认同", "非常不认同"],
  [
    "非常にそう思う",
    "ややそう思う",
    "どちらともいえない",
    "あまりそう思わない",
    "全くそう思わない",
  ],
] as const;

const isRecognizedLikertMapping = (
  question: FormSnapshot["questions"][number] | undefined,
  mapping: LikertScoreMapping | undefined,
): boolean => {
  if (
    question?.kind !== "single_choice" ||
    question.affectsNavigation ||
    !mapping ||
    !scoreBounds(question, mapping)
  )
    return false;
  const byKey = new Map(
    question.options.map((option) => [String(option.key), normalizeLikertLabel(option.label)]),
  );
  return supportedLikertLabels.some((labels) =>
    labels.every((label, index) =>
      mapping.optionScores.some(
        (entry) =>
          entry.score === 5 - index && byKey.get(entry.optionKey) === normalizeLikertLabel(label),
      ),
    ),
  );
};

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
  return {
    count,
    denominatorCount,
    share: denominatorCount === 0 ? 0 : count / denominatorCount,
  };
};

const meanMetric = (
  context: ScopeContext,
  questionId: string,
  mappings?: readonly LikertScoreMapping[],
): { mean: number; denominatorCount: number } | null => {
  const question = context.form.questions.find((candidate) => candidate.id === questionId);
  const mapping = scoreMappingFor(mappings, questionId);
  if (!scoreBounds(question, mapping)) return null;
  if (!question) return null;
  const scores = new Map(mapping?.optionScores.map((entry) => [entry.optionKey, entry.score]));
  const values: number[] = [];
  for (const slot of answers(context.responses, question.id)) {
    if (slot?.state !== "answered") continue;
    if (slot.value.kind === "ordinal") values.push(slot.value.value);
    if (slot.value.kind === "single_choice") {
      const score = scores.get(String(slot.value.optionKey));
      if (score !== undefined) values.push(score);
    }
  }
  return {
    mean: values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length,
    denominatorCount: values.length,
  };
};

const ordinalDistributionMetric = (
  context: ScopeContext,
  questionId: string,
  mappings?: readonly LikertScoreMapping[],
): {
  denominatorCount: number;
  values: Array<{ value: number; count: number; share: number }>;
} | null => {
  const question = context.form.questions.find((candidate) => candidate.id === questionId);
  const mapping = scoreMappingFor(mappings, questionId);
  const bounds = scoreBounds(question, mapping);
  if (!question || !bounds) return null;
  const scores = new Map(mapping?.optionScores.map((entry) => [entry.optionKey, entry.score]));
  const counts = new Map<number, number>();
  let denominatorCount = 0;
  for (const slot of answers(context.responses, question.id)) {
    if (slot?.state !== "answered") continue;
    const value =
      slot.value.kind === "ordinal"
        ? slot.value.value
        : slot.value.kind === "single_choice"
          ? scores.get(String(slot.value.optionKey))
          : undefined;
    if (value === undefined) continue;
    denominatorCount += 1;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const values: Array<{ value: number; count: number; share: number }> = [];
  for (let value = Math.ceil(bounds.min); value <= Math.floor(bounds.max); value += 1) {
    const count = counts.get(value) ?? 0;
    values.push({
      value,
      count,
      share: denominatorCount === 0 ? 0 : count / denominatorCount,
    });
  }
  return { denominatorCount, values };
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
  return {
    count,
    denominatorCount,
    share: denominatorCount === 0 ? 0 : count / denominatorCount,
  };
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
      const bounds = scoreBounds(question, target.scoreMapping);
      if (
        !bounds ||
        (question?.kind === "single_choice" &&
          !isRecognizedLikertMapping(question, target.scoreMapping))
      ) {
        issues.push(
          targetIssue([id], "invalid_subject", "Mean target must reference an ordinal question"),
        );
      } else if (target.intent.kind !== "absolute") {
        issues.push(
          targetIssue([id], "domain_unsupported", "Mean targets support absolute intent only"),
        );
      } else if (target.intent.value < bounds.min || target.intent.value > bounds.max) {
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
          targetIssue(
            [id],
            "domain_unsupported",
            "Share target does not support count_delta intent",
          ),
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
    const shareTargets = targets.filter((target) => target.kind === "share");
    const shareTotal = shareTargets.reduce((sum, target) => sum + target.intent!.value, 0);
    if (shareTotal > 1 + 1e-9) {
      issues.push(
        targetIssue(
          shareTargets.map((target) => String(target.id)),
          "target_conflict",
          "Single-choice share targets exceed 100%",
        ),
      );
    }

    if (draft.finalCount !== null && Number.isInteger(draft.finalCount) && draft.finalCount > 0) {
      const countTargets = targets.filter((target) => target.kind === "count");
      const countTotal = countTargets.reduce((sum, target) => sum + target.intent!.value, 0);
      if (countTotal > draft.finalCount) {
        issues.push(
          targetIssue(
            countTargets.map((target) => String(target.id)),
            "target_conflict",
            "Single-choice count targets exceed the final response count",
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
      ...(target.scoreMapping ? { scoreMapping: target.scoreMapping } : {}),
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
  scoreMappings?: readonly LikertScoreMapping[],
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
    }
    if (question.kind === "ordinal" || scoreMappingFor(scoreMappings, String(question.id))) {
      const metric = meanMetric(context, String(question.id), scoreMappings);
      if (metric) metrics.push({ kind: "mean", questionId: String(question.id), ...metric });
      const distribution = ordinalDistributionMetric(context, String(question.id), scoreMappings);
      if (distribution) {
        metrics.push({
          kind: "ordinal_distribution",
          questionId: String(question.id),
          ...distribution,
        });
      }
    }
  }

  for (const group of groups) {
    const subject = { kind: "value_group" as const, valueGroupId: group.id };
    const metric = subjectMetric(context, groups, subject);
    if (metric) metrics.push({ kind: "subject", subject, ...metric });

    for (const question of context.form.questions) {
      if (question.kind !== "multi_choice") continue;
      for (const option of question.options) {
        const target: Extract<TargetDraftTarget, { kind: "conditional_share" }> = {
          id: `profile:${group.id}:${String(question.id)}:${String(option.key)}` as never,
          kind: "conditional_share",
          population: { kind: "value_group", valueGroupId: group.id },
          questionId: String(question.id),
          optionKey: String(option.key),
          intent: null,
        };
        const conditional = conditionalMetric(context, groups, target);
        if (conditional) {
          metrics.push({
            kind: "conditional_share",
            population: target.population,
            questionId: target.questionId,
            optionKey: target.optionKey,
            ...conditional,
          });
        }
      }
    }
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
  profile(
    projectId: string,
    sourceScope?: SourceScope,
    scoreMappings?: LikertScoreMapping[],
  ): Promise<TargetProfileResult>;
  validate(draft: TargetDraft): Promise<TargetsValidateResult>;
  getDraft(projectId: string): Promise<TargetDraftView | null>;
  saveDraft(draft: TargetDraft): Promise<TargetDraftView>;
  startDraft(projectId: string, operationId?: string): Promise<SynthesisStartResult>;
}

export const createTargetService = (
  db: SurveyDatabase,
  synthesis: SynthesisService,
): TargetService => ({
  profile: async (projectId, sourceScope, scoreMappings) =>
    profile(db, projectId, sourceScope, scoreMappings),

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
    if (!getProject(db, draft.projectId)) {
      throw backendFailure("NOT_FOUND", "Project was not found");
    }
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
    if (
      draft.targets.length === 0 &&
      draft.finalCount !== null &&
      draft.finalCount <= context.responses.length
    ) {
      issues.push(
        targetIssue(
          [],
          "out_of_range",
          "Targetless generation requires the final count to exceed the source response count",
        ),
      );
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
      scoreMappings: draft.targets.flatMap((target) =>
        target.kind === "mean" && target.scoreMapping ? [target.scoreMapping] : [],
      ),
      targetIntents: draft.targets.flatMap((target) =>
        target.intent ? [{ targetId: target.id, intent: target.intent }] : [],
      ),
      sourceScope: context.sourceScope,
      seed: draft.seed,
      ...(operationId ? { operationId } : {}),
    });
  },
});
