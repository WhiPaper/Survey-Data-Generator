import type {
  ChoiceOption,
  ConditionPredicate,
  FormSnapshot,
  OptionKey,
  ProjectTargets,
  Question,
  QuestionId,
  QuestionTarget,
} from "./index.js";

export type TargetLocator =
  | {
      readonly kind: "question_target";
      readonly questionId: QuestionId;
      readonly optionKey?: OptionKey;
    }
  | { readonly kind: "detailed_goal"; readonly goalId: string }
  | { readonly kind: "semantic_override"; readonly questionId: QuestionId };

export interface TargetMigrationIssue {
  readonly id: string;
  readonly code:
    | "question_deleted"
    | "question_type_changed"
    | "option_removed"
    | "option_ambiguous"
    | "semantic_incompatible"
    | "form_logic_changed"
    | "group_changed"
    | "unsupported";
  readonly message: string;
  readonly questionId?: QuestionId;
  readonly optionKey?: OptionKey;
  readonly severity: "warning" | "blocking";
  readonly targetLocator?: TargetLocator;
  readonly originalTarget?: Record<string, unknown>;
}

export interface DomainSemanticOverride {
  readonly questionId: QuestionId;
  readonly value: string;
  readonly updatedAt: string;
}

export type SchemaDiffSeverity = "none" | "compatible" | "breaking";

export interface SchemaChange {
  readonly kind:
    | "question_added"
    | "question_removed"
    | "question_title_changed"
    | "question_description_changed"
    | "question_type_changed"
    | "question_required_changed"
    | "options_changed"
    | "group_changed"
    | "logic_changed";
  readonly severity: SchemaDiffSeverity;
  readonly questionId?: QuestionId;
  readonly details: string;
}

export interface SchemaDiffResult {
  readonly severity: SchemaDiffSeverity;
  readonly changes: readonly SchemaChange[];
}

export interface OptionMapping {
  readonly oldKey: OptionKey;
  readonly newKey?: OptionKey;
  readonly confidence: "exact" | "probable" | "ambiguous";
  readonly reason: string;
}

export interface TargetMigrationResult {
  readonly status: "clean" | "compatible_with_warnings" | "blocking";
  readonly migratedTargets: ProjectTargets;
  readonly issues: readonly TargetMigrationIssue[];
}

export interface SemanticOverrideMigrationResult {
  readonly migratedOverrides: readonly DomainSemanticOverride[];
  readonly issues: readonly TargetMigrationIssue[];
}

export const diffFormSchemas = (oldForm: FormSnapshot, newForm: FormSnapshot): SchemaDiffResult => {
  if (oldForm.schemaHash === newForm.schemaHash) {
    return { severity: "none", changes: [] };
  }

  const changes: SchemaChange[] = [];
  const oldQuestionMap = new Map<QuestionId, Question>(oldForm.questions.map((q) => [q.id, q]));
  const newQuestionMap = new Map<QuestionId, Question>(newForm.questions.map((q) => [q.id, q]));

  // Check for deleted or modified questions
  for (const [id, oldQ] of oldQuestionMap.entries()) {
    const newQ = newQuestionMap.get(id);
    if (!newQ) {
      changes.push({
        kind: "question_removed",
        severity: "breaking",
        questionId: id,
        details: `Question '${oldQ.title}' (${id}) was removed`,
      });
      continue;
    }

    if (oldQ.kind !== newQ.kind) {
      changes.push({
        kind: "question_type_changed",
        severity: "breaking",
        questionId: id,
        details: `Question '${id}' type changed from ${oldQ.kind} to ${newQ.kind}`,
      });
    }

    if (oldQ.title !== newQ.title) {
      changes.push({
        kind: "question_title_changed",
        severity: "compatible",
        questionId: id,
        details: `Question '${id}' title changed from '${oldQ.title}' to '${newQ.title}'`,
      });
    }

    if (oldQ.description !== newQ.description) {
      changes.push({
        kind: "question_description_changed",
        severity: "compatible",
        questionId: id,
        details: `Question '${id}' description changed`,
      });
    }

    if (oldQ.required !== newQ.required) {
      changes.push({
        kind: "question_required_changed",
        severity: "compatible",
        questionId: id,
        details: `Question '${id}' required changed to ${newQ.required}`,
      });
    }

    // Check options if choice question
    if ("options" in oldQ && "options" in newQ) {
      const oldOpts = (oldQ.options as readonly ChoiceOption[]) ?? [];
      const newOpts = (newQ.options as readonly ChoiceOption[]) ?? [];
      const oldKeys = new Set(oldOpts.map((o: ChoiceOption) => o.key));
      const newKeys = new Set(newOpts.map((o: ChoiceOption) => o.key));
      const removedCount = oldOpts.filter((o: ChoiceOption) => !newKeys.has(o.key)).length;
      const addedCount = newOpts.filter((o: ChoiceOption) => !oldKeys.has(o.key)).length;

      if (removedCount > 0 || addedCount > 0) {
        changes.push({
          kind: "options_changed",
          severity: removedCount > 0 ? "breaking" : "compatible",
          questionId: id,
          details: `Question '${id}' options changed (+${addedCount}, -${removedCount})`,
        });
      }
    }
  }

  // Check for newly added questions
  for (const [id, newQ] of newQuestionMap.entries()) {
    if (!oldQuestionMap.has(id)) {
      changes.push({
        kind: "question_added",
        severity: "compatible",
        questionId: id,
        details: `Question '${newQ.title}' (${id}) was added`,
      });
    }
  }

  // Check groups (grids) using semantic comparison, not raw JSON
  const oldGroupMap = new Map((oldForm.groups ?? []).map((g) => [g.id, g]));
  const newGroupMap = new Map((newForm.groups ?? []).map((g) => [g.id, g]));

  for (const [id, oldGroup] of oldGroupMap.entries()) {
    const newGroup = newGroupMap.get(id);
    if (!newGroup) {
      changes.push({
        kind: "group_changed",
        severity: "breaking",
        details: `Question group '${oldGroup.title}' (${id}) was removed`,
      });
      continue;
    }

    const oldQIds = new Set(oldGroup.questionIds);
    const newQIds = new Set(newGroup.questionIds);
    const removedQCount = oldGroup.questionIds.filter((qid) => !newQIds.has(qid)).length;
    const addedQCount = newGroup.questionIds.filter((qid) => !oldQIds.has(qid)).length;

    const oldOptionKeys = new Set(oldGroup.options.map((o) => o.key));
    const newOptionKeys = new Set(newGroup.options.map((o) => o.key));
    const removedOptCount = oldGroup.options.filter((o) => !newOptionKeys.has(o.key)).length;
    const addedOptCount = newGroup.options.filter((o) => !oldOptionKeys.has(o.key)).length;

    if (removedQCount > 0 || removedOptCount > 0) {
      changes.push({
        kind: "group_changed",
        severity: "breaking",
        details: `Grid '${oldGroup.title}' structure changed (-${removedQCount} rows, -${removedOptCount} columns)`,
      });
    } else if (addedQCount > 0 || addedOptCount > 0) {
      changes.push({
        kind: "group_changed",
        severity: "compatible",
        details: `Grid '${newGroup.title}' expanded (+${addedQCount} rows, +${addedOptCount} columns)`,
      });
    } else if (
      oldGroup.title !== newGroup.title ||
      oldGroup.description !== newGroup.description ||
      oldGroup.presentation !== newGroup.presentation
    ) {
      changes.push({
        kind: "group_changed",
        severity: "compatible",
        details: `Grid '${newGroup.title}' presentation/title changed`,
      });
    }
  }

  for (const [id, newGroup] of newGroupMap.entries()) {
    if (!oldGroupMap.has(id)) {
      changes.push({
        kind: "group_changed",
        severity: "compatible",
        details: `Question group '${newGroup.title}' (${id}) was added`,
      });
    }
  }

  // Check logic / flow changes
  const oldLogic = oldForm.logic;
  const newLogic = newForm.logic;
  if (oldLogic && newLogic) {
    const restartChanged = oldLogic.hasRestartFlow !== newLogic.hasRestartFlow;
    const entryChanged = oldLogic.entrySectionId !== newLogic.entrySectionId;
    const oldTransStr = JSON.stringify(oldLogic.transitions ?? []);
    const newTransStr = JSON.stringify(newLogic.transitions ?? []);
    const transitionsChanged = oldTransStr !== newTransStr;

    if (restartChanged || entryChanged) {
      changes.push({
        kind: "logic_changed",
        severity: "breaking",
        details: "Form entry section or restart flow changed",
      });
    } else if (transitionsChanged) {
      changes.push({
        kind: "logic_changed",
        severity: "breaking",
        details: "Form branching transitions changed",
      });
    }
  }

  let severity: SchemaDiffSeverity = "none";
  if (changes.some((c) => c.severity === "breaking")) {
    severity = "breaking";
  } else if (changes.some((c) => c.severity === "compatible")) {
    severity = "compatible";
  }

  return { severity, changes };
};

export const mapChoiceOptions = (
  oldOptions: readonly ChoiceOption[],
  newOptions: readonly ChoiceOption[],
): OptionMapping[] => {
  const result: OptionMapping[] = [];

  const normalize = (s: string) => s.trim().toLowerCase();

  const oldExactFreq = new Map<string, number>();
  const oldNormFreq = new Map<string, number>();
  for (const opt of oldOptions) {
    oldExactFreq.set(opt.label, (oldExactFreq.get(opt.label) ?? 0) + 1);
    const norm = normalize(opt.label);
    oldNormFreq.set(norm, (oldNormFreq.get(norm) ?? 0) + 1);
  }

  const newExactFreq = new Map<string, number>();
  const newNormFreq = new Map<string, number>();
  for (const opt of newOptions) {
    newExactFreq.set(opt.label, (newExactFreq.get(opt.label) ?? 0) + 1);
    const norm = normalize(opt.label);
    newNormFreq.set(norm, (newNormFreq.get(norm) ?? 0) + 1);
  }

  const newKeyMap = new Map<OptionKey, ChoiceOption>(newOptions.map((o) => [o.key, o]));
  const uniqueNewExactLabelMap = new Map<string, OptionKey>();
  const uniqueNewNormLabelMap = new Map<string, OptionKey>();
  for (const opt of newOptions) {
    if (newExactFreq.get(opt.label) === 1) {
      uniqueNewExactLabelMap.set(opt.label, opt.key);
    }
    const norm = normalize(opt.label);
    if (newNormFreq.get(norm) === 1) {
      uniqueNewNormLabelMap.set(norm, opt.key);
    }
  }

  for (const oldOpt of oldOptions) {
    const directMatch = newKeyMap.get(oldOpt.key);
    if (directMatch && directMatch.label === oldOpt.label) {
      result.push({
        oldKey: oldOpt.key,
        newKey: oldOpt.key,
        confidence: "exact",
        reason: "exact_match",
      });
      continue;
    }

    // Check unique exact label match (reordered option)
    const isOldExactUnique = (oldExactFreq.get(oldOpt.label) ?? 0) === 1;
    const isNewExactUnique = (newExactFreq.get(oldOpt.label) ?? 0) === 1;
    if (isOldExactUnique && isNewExactUnique) {
      const mappedKey = uniqueNewExactLabelMap.get(oldOpt.label);
      if (mappedKey) {
        result.push({
          oldKey: oldOpt.key,
          newKey: mappedKey,
          confidence: "probable",
          reason: "unique_label_match",
        });
        continue;
      }
    }

    const norm = normalize(oldOpt.label);
    const isOldNormUnique = (oldNormFreq.get(norm) ?? 0) === 1;
    const isNewNormUnique = (newNormFreq.get(norm) ?? 0) === 1;

    // Check collision in normalized labels (multiple options sharing normalized string)
    if ((newNormFreq.get(norm) ?? 0) > 1 || (oldNormFreq.get(norm) ?? 0) > 1) {
      result.push({
        oldKey: oldOpt.key,
        confidence: "ambiguous",
        reason: "duplicate_labels",
      });
      continue;
    }

    // Check unique normalized match (whitespace/case-insensitivity difference)
    if (isOldNormUnique && isNewNormUnique) {
      const mappedKey = uniqueNewNormLabelMap.get(norm);
      if (mappedKey) {
        result.push({
          oldKey: oldOpt.key,
          newKey: mappedKey,
          confidence: "probable",
          reason: "normalized_label_match",
        });
        continue;
      }
    }

    result.push({
      oldKey: oldOpt.key,
      confidence: "ambiguous",
      reason: "option_missing_or_renamed",
    });
  }

  return result;
};

// Conservative check: a question is provably unaffected by logic changes only if:
// 1. Neither form has restart flow
// 2. Entry section is unchanged
// 3. Question is in the entry section in both forms
// 4. Question's own transitions (if any) are identical
const isQuestionProvablyUnaffectedByLogic = (
  questionId: QuestionId,
  oldForm: FormSnapshot,
  newForm: FormSnapshot,
): boolean => {
  if (JSON.stringify(oldForm.logic ?? {}) === JSON.stringify(newForm.logic ?? {})) {
    return true;
  }
  if (oldForm.logic?.hasRestartFlow || newForm.logic?.hasRestartFlow) {
    return false;
  }
  if (oldForm.logic?.entrySectionId !== newForm.logic?.entrySectionId) {
    return false;
  }
  const entrySectionId = newForm.logic.entrySectionId;
  const oldQ = oldForm.questions.find((q) => q.id === questionId);
  const newQ = newForm.questions.find((q) => q.id === questionId);
  if (!oldQ || !newQ) return false;

  const inEntry = oldQ.sectionId === entrySectionId && newQ.sectionId === entrySectionId;
  if (!inEntry) return false;

  const oldTransitions = (oldForm.logic.transitions ?? []).filter(
    (t) => t.sourceQuestionId === questionId,
  );
  const newTransitions = (newForm.logic.transitions ?? []).filter(
    (t) => t.sourceQuestionId === questionId,
  );
  return JSON.stringify(oldTransitions) === JSON.stringify(newTransitions);
};

export const migrateProjectTargets = (
  oldTargets: ProjectTargets,
  oldForm: FormSnapshot,
  newForm: FormSnapshot,
  overrides: readonly DomainSemanticOverride[] = [],
): TargetMigrationResult => {
  const issues: TargetMigrationIssue[] = [];
  const migratedQuestionTargets: QuestionTarget[] = [];

  const oldQuestionMap = new Map<QuestionId, Question>(oldForm.questions.map((q) => [q.id, q]));
  const newQuestionMap = new Map<QuestionId, Question>(newForm.questions.map((q) => [q.id, q]));

  let issueCounter = 0;
  const makeIssueId = (code: string, qId?: string): string => {
    issueCounter += 1;
    return `issue_${code}_${qId ?? "global"}_${issueCounter}`;
  };

  const oldGroupMap = new Map((oldForm.groups ?? []).map((g) => [g.id, g]));
  const newGroupMap = new Map((newForm.groups ?? []).map((g) => [g.id, g]));

  for (const target of oldTargets.questionTargets) {
    const oldQ = oldQuestionMap.get(target.questionId);
    const newQ = newQuestionMap.get(target.questionId);
    const locator: TargetLocator = {
      kind: "question_target",
      questionId: target.questionId,
      optionKey: "optionKey" in target ? target.optionKey : undefined,
    };

    if (!newQ) {
      issues.push({
        id: makeIssueId("question_deleted", target.questionId),
        code: "question_deleted",
        message: `Question '${oldQ?.title ?? target.questionId}' was deleted from the form.`,
        questionId: target.questionId,
        severity: "blocking",
        targetLocator: locator,
        originalTarget: target as unknown as Record<string, unknown>,
      });
      continue;
    }

    if (oldQ && oldQ.kind !== newQ.kind) {
      issues.push({
        id: makeIssueId("question_type_changed", target.questionId),
        code: "question_type_changed",
        message: `Question '${newQ.title}' type changed from ${oldQ.kind} to ${newQ.kind}.`,
        questionId: target.questionId,
        severity: "blocking",
        targetLocator: locator,
        originalTarget: target as unknown as Record<string, unknown>,
      });
      continue;
    }

    // Check if question belongs to a group whose rows or columns were removed
    if (newQ.groupId) {
      const oldGroup = oldGroupMap.get(newQ.groupId);
      const newGroup = newGroupMap.get(newQ.groupId);
      if (!newGroup || (oldGroup && oldGroup.options.length > newGroup.options.length)) {
        issues.push({
          id: makeIssueId("group_changed", target.questionId),
          code: "group_changed",
          message: `Grid structure for '${newQ.title}' was modified.`,
          questionId: target.questionId,
          severity: "blocking",
          targetLocator: locator,
          originalTarget: target as unknown as Record<string, unknown>,
        });
        continue;
      }
    }

    // Check conservative FormLogic scoping
    if (!isQuestionProvablyUnaffectedByLogic(target.questionId, oldForm, newForm)) {
      issues.push({
        id: makeIssueId("form_logic_changed", target.questionId),
        code: "form_logic_changed",
        message: `Branching logic affecting '${newQ.title}' was modified.`,
        questionId: target.questionId,
        severity: "blocking",
        targetLocator: locator,
        originalTarget: target as unknown as Record<string, unknown>,
      });
      continue;
    }

    if (target.kind === "option") {
      const oldOptions = (oldQ && "options" in oldQ ? oldQ.options : []) ?? [];
      const newOptions = ("options" in newQ ? newQ.options : []) ?? [];

      const mapping = mapChoiceOptions(oldOptions, newOptions).find(
        (m) => m.oldKey === target.optionKey,
      );

      if (!mapping || mapping.confidence === "ambiguous" || !mapping.newKey) {
        issues.push({
          id: makeIssueId(
            mapping?.reason === "duplicate_labels" ? "option_ambiguous" : "option_removed",
            target.questionId,
          ),
          code: mapping?.reason === "duplicate_labels" ? "option_ambiguous" : "option_removed",
          message:
            mapping?.reason === "duplicate_labels"
              ? `Option with label matches multiple options in question '${newQ.title}'.`
              : `Option '${target.optionKey}' in question '${newQ.title}' is no longer available.`,
          questionId: target.questionId,
          optionKey: target.optionKey,
          severity: "blocking",
          targetLocator: locator,
          originalTarget: target as unknown as Record<string, unknown>,
        });
        continue;
      }

      if (mapping.confidence === "probable") {
        issues.push({
          id: makeIssueId("option_probable", target.questionId),
          code: "option_ambiguous",
          message: `Option key moved from '${target.optionKey}' to '${mapping.newKey}' based on matching label.`,
          questionId: target.questionId,
          optionKey: mapping.newKey,
          severity: "warning",
          targetLocator: {
            kind: "question_target",
            questionId: target.questionId,
            optionKey: mapping.newKey,
          },
          originalTarget: target as unknown as Record<string, unknown>,
        });
      }

      migratedQuestionTargets.push({
        ...target,
        optionKey: mapping.newKey,
      });
    } else {
      migratedQuestionTargets.push(target);
    }
  }

  // Detailed / Conditional goals migration
  let migratedDetailedGoals: ProjectTargets["detailedGoals"] = undefined;
  if (oldTargets.detailedGoals && oldTargets.detailedGoals.length > 0) {
    const goals: NonNullable<ProjectTargets["detailedGoals"]> = [];

    const migrateCondition = (
      cond: ConditionPredicate,
      goalId: string,
      goal: unknown,
    ): { condition?: ConditionPredicate; issue?: TargetMigrationIssue } => {
      if (cond.kind === "answered") {
        if (!newQuestionMap.has(cond.questionId)) {
          return {
            issue: {
              id: makeIssueId("question_deleted", cond.questionId),
              code: "question_deleted",
              message: `Conditional target refers to deleted question '${cond.questionId}'.`,
              questionId: cond.questionId,
              severity: "blocking",
              targetLocator: { kind: "detailed_goal", goalId },
              originalTarget: goal as Record<string, unknown>,
            },
          };
        }
        return { condition: cond };
      }
      if (cond.kind === "option_selected") {
        const oldQ = oldQuestionMap.get(cond.questionId);
        const newQ = newQuestionMap.get(cond.questionId);
        if (!newQ) {
          return {
            issue: {
              id: makeIssueId("question_deleted", cond.questionId),
              code: "question_deleted",
              message: `Condition refers to deleted question '${cond.questionId}'.`,
              questionId: cond.questionId,
              severity: "blocking",
              targetLocator: { kind: "detailed_goal", goalId },
              originalTarget: goal as Record<string, unknown>,
            },
          };
        }
        const oldOpts = (oldQ && "options" in oldQ ? oldQ.options : []) ?? [];
        const newOpts = ("options" in newQ ? newQ.options : []) ?? [];
        const mapping = mapChoiceOptions(oldOpts, newOpts).find((m) => m.oldKey === cond.optionKey);
        if (!mapping || mapping.confidence === "ambiguous" || !mapping.newKey) {
          return {
            issue: {
              id: makeIssueId("option_removed", cond.questionId),
              code: mapping?.reason === "duplicate_labels" ? "option_ambiguous" : "option_removed",
              message: `Condition refers to unavailable option '${cond.optionKey}' in question '${newQ.title}'.`,
              questionId: cond.questionId,
              optionKey: cond.optionKey,
              severity: "blocking",
              targetLocator: { kind: "detailed_goal", goalId },
              originalTarget: goal as Record<string, unknown>,
            },
          };
        }
        if (mapping.confidence === "probable") {
          issues.push({
            id: makeIssueId("option_probable", cond.questionId),
            code: "option_ambiguous",
            message: `Condition option key moved to '${mapping.newKey}' based on matching label.`,
            questionId: cond.questionId,
            optionKey: mapping.newKey,
            severity: "warning",
            targetLocator: { kind: "detailed_goal", goalId },
            originalTarget: goal as Record<string, unknown>,
          });
        }
        return { condition: { ...cond, optionKey: mapping.newKey } };
      }
      if (cond.kind === "and" || cond.kind === "or") {
        const childConds: ConditionPredicate[] = [];
        for (const c of cond.conditions) {
          const res = migrateCondition(c, goalId, goal);
          if (res.issue) return { issue: res.issue };
          if (res.condition) childConds.push(res.condition);
        }
        return { condition: { ...cond, conditions: childConds } };
      }
      return { condition: cond };
    };

    for (const goal of oldTargets.detailedGoals) {
      const condResult = migrateCondition(goal.condition, goal.id, goal);
      if (condResult.issue) {
        issues.push(condResult.issue);
        continue;
      }
      const migratedCond = condResult.condition!;

      // Outcome migration
      const outOldQ = oldQuestionMap.get(goal.outcome.questionId);
      const outNewQ = newQuestionMap.get(goal.outcome.questionId);
      if (!outNewQ) {
        issues.push({
          id: makeIssueId("question_deleted", goal.outcome.questionId),
          code: "question_deleted",
          message: `Detailed goal outcome refers to deleted question '${goal.outcome.questionId}'.`,
          questionId: goal.outcome.questionId,
          severity: "blocking",
          targetLocator: { kind: "detailed_goal", goalId: goal.id },
          originalTarget: goal as unknown as Record<string, unknown>,
        });
        continue;
      }

      if (outOldQ && outOldQ.kind !== outNewQ.kind) {
        issues.push({
          id: makeIssueId("question_type_changed", goal.outcome.questionId),
          code: "question_type_changed",
          message: `Question '${outNewQ.title}' type changed from ${outOldQ.kind} to ${outNewQ.kind}.`,
          questionId: goal.outcome.questionId,
          severity: "blocking",
          targetLocator: { kind: "detailed_goal", goalId: goal.id },
          originalTarget: goal as unknown as Record<string, unknown>,
        });
        continue;
      }

      let migratedOutcome = goal.outcome;
      const outcome = goal.outcome;
      if (outcome.kind === "option") {
        const oldOpts = (outOldQ && "options" in outOldQ ? outOldQ.options : []) ?? [];
        const newOpts = ("options" in outNewQ ? outNewQ.options : []) ?? [];
        const mapping = mapChoiceOptions(oldOpts, newOpts).find(
          (m) => m.oldKey === outcome.optionKey,
        );
        if (!mapping || mapping.confidence === "ambiguous" || !mapping.newKey) {
          issues.push({
            id: makeIssueId("option_removed", outcome.questionId),
            code: mapping?.reason === "duplicate_labels" ? "option_ambiguous" : "option_removed",
            message: `Detailed goal outcome refers to unavailable option '${outcome.optionKey}' in question '${outNewQ.title}'.`,
            questionId: outcome.questionId,
            optionKey: outcome.optionKey,
            severity: "blocking",
            targetLocator: { kind: "detailed_goal", goalId: goal.id },
            originalTarget: goal as unknown as Record<string, unknown>,
          });
          continue;
        }
        if (mapping.confidence === "probable") {
          issues.push({
            id: makeIssueId("option_probable", outcome.questionId),
            code: "option_ambiguous",
            message: `Detailed goal outcome option key moved to '${mapping.newKey}' based on matching label.`,
            questionId: outcome.questionId,
            optionKey: mapping.newKey,
            severity: "warning",
            targetLocator: { kind: "detailed_goal", goalId: goal.id },
            originalTarget: goal as unknown as Record<string, unknown>,
          });
        }
        migratedOutcome = { ...outcome, optionKey: mapping.newKey };
      }

      goals.push({
        ...goal,
        condition: migratedCond,
        outcome: migratedOutcome,
      });
    }
    migratedDetailedGoals = goals;
  }

  const overrideResults = migrateSemanticOverrides(overrides, oldForm, newForm);
  issues.push(...overrideResults.issues);

  // Deterministic sorting of issues
  const qOrder = new Map<QuestionId, number>(newForm.questions.map((q, idx) => [q.id, idx]));
  const oldQOrder = new Map<QuestionId, number>(oldForm.questions.map((q, idx) => [q.id, idx]));
  const getOrder = (qId?: QuestionId): number => {
    if (!qId) return 999999;
    return qOrder.get(qId) ?? oldQOrder.get(qId) ?? 999990;
  };

  issues.sort((a, b) => {
    const orderA = getOrder(a.questionId);
    const orderB = getOrder(b.questionId);
    if (orderA !== orderB) return orderA - orderB;
    const qCmp = String(a.questionId ?? "").localeCompare(String(b.questionId ?? ""));
    if (qCmp !== 0) return qCmp;
    const optCmp = String(a.optionKey ?? "").localeCompare(String(b.optionKey ?? ""));
    if (optCmp !== 0) return optCmp;
    const codeCmp = a.code.localeCompare(b.code);
    if (codeCmp !== 0) return codeCmp;
    return a.id.localeCompare(b.id);
  });

  let status: "clean" | "compatible_with_warnings" | "blocking" = "clean";
  if (issues.some((i) => i.severity === "blocking")) {
    status = "blocking";
  } else if (issues.some((i) => i.severity === "warning")) {
    status = "compatible_with_warnings";
  }

  const migratedTargets: ProjectTargets = {
    targetResponseCount: oldTargets.targetResponseCount,
    questionTargets: migratedQuestionTargets,
    ...(migratedDetailedGoals ? { detailedGoals: migratedDetailedGoals } : {}),
  };

  return {
    status,
    migratedTargets,
    issues,
  };
};

export const migrateSemanticOverrides = (
  overrides: readonly DomainSemanticOverride[],
  oldForm: FormSnapshot,
  newForm: FormSnapshot,
): SemanticOverrideMigrationResult => {
  const migratedOverrides: DomainSemanticOverride[] = [];
  const issues: TargetMigrationIssue[] = [];

  const newQuestionMap = new Map<QuestionId, Question>(newForm.questions.map((q) => [q.id, q]));

  let issueCounter = 0;
  for (const override of overrides) {
    const newQ = newQuestionMap.get(override.questionId);
    const locator: TargetLocator = {
      kind: "semantic_override",
      questionId: override.questionId,
    };

    if (!newQ) {
      issueCounter += 1;
      issues.push({
        id: `override_q_deleted_${override.questionId}_${issueCounter}`,
        code: "semantic_incompatible",
        message: `Semantic override target question '${override.questionId}' was deleted`,
        questionId: override.questionId,
        severity: "blocking",
        targetLocator: locator,
      });
      continue;
    }

    if (newQ.kind !== "text") {
      issueCounter += 1;
      issues.push({
        id: `override_type_incompatible_${override.questionId}_${issueCounter}`,
        code: "semantic_incompatible",
        message: `Question '${newQ.title}' kind changed to ${newQ.kind}, incompatible with text override '${override.value}'`,
        questionId: override.questionId,
        severity: "blocking",
        targetLocator: locator,
      });
      continue;
    }

    migratedOverrides.push(override);
  }

  return { migratedOverrides, issues };
};
