export type DomainPackage = "domain";

export type Brand<T, B extends string> = T & { readonly __brand: B };

export type FormId = Brand<string, "FormId">;
export type SectionId = Brand<string, "SectionId">;
export type QuestionId = Brand<string, "QuestionId">;
export type GroupId = Brand<string, "GroupId">;
export type OptionKey = Brand<string, "OptionKey">;
export type ResponseId = Brand<string, "ResponseId">;
export type ProjectId = Brand<string, "ProjectId">;
export type RunId = Brand<string, "RunId">;
export type GoogleAccountId = Brand<string, "GoogleAccountId">;
export type SourceRevisionId = Brand<string, "SourceRevisionId">;
export type FormSnapshotId = Brand<string, "FormSnapshotId">;

export interface SynthesisProject {
  id: ProjectId;
  googleAccountId: GoogleAccountId;
  googleFormId: FormId;
  name: string;
  currentSourceRevisionId: SourceRevisionId;
  createdAt: string;
  updatedAt: string;
}

export type ProjectSummary = SynthesisProject & {
  responseCount: number;
  questionCount: number;
  profileCount: number;
};

export interface SourceRevision {
  id: SourceRevisionId;
  projectId: ProjectId;
  formSnapshotId: FormSnapshotId;
  sourceResponseCount: number;
  responseSetHash: string;
  schemaHash: string;
  capturedAt: string;
  importedAt: string;
  previousRevisionId?: SourceRevisionId;
}

export interface ProfileBase {
  questionId: QuestionId;
  answeredCount: number;
  skippedCount: number;
  notReachedCount: number;
  indeterminateCount: number;
  confirmedEligibleCount: number;
  responseRate: number;
}

export interface GoogleAccount {
  id: GoogleAccountId;
  subject: string;
  email: string;
  displayName?: string;
  createdAt: string;
  lastUsedAt: string;
}

export interface Section {
  id: SectionId;
  title: string;
  description?: string;
  order: number;
  questionIds: readonly QuestionId[];
}

export interface ChoiceOption {
  key: OptionKey;
  label: string;
  isOther?: boolean;
}

export interface QuestionBase {
  id: QuestionId;
  title: string;
  description?: string;
  sectionId: SectionId;
  required: boolean;
  affectsNavigation: boolean;
  groupId?: GroupId;
}

export interface SingleChoiceQuestion extends QuestionBase {
  kind: "single_choice";
  presentation: "radio" | "dropdown";
  options: readonly ChoiceOption[];
  shuffle: boolean;
}

export interface MultiChoiceQuestion extends QuestionBase {
  kind: "multi_choice";
  presentation: "checkbox";
  options: readonly ChoiceOption[];
  shuffle: boolean;
}

export interface OrdinalQuestion extends QuestionBase {
  kind: "ordinal";
  presentation: "linear_scale" | "rating_star" | "rating_heart" | "rating_thumb_up";
  min: number;
  max: number;
  lowLabel?: string;
  highLabel?: string;
}

export interface TextQuestion extends QuestionBase {
  kind: "text";
  presentation: "short" | "paragraph";
}

export interface DateQuestion extends QuestionBase {
  kind: "date";
  includeTime: boolean;
  includeYear: boolean;
}

export interface TimeQuestion extends QuestionBase {
  kind: "time";
  duration: boolean;
}

export interface FileQuestion extends QuestionBase {
  kind: "file";
  allowedTypes: readonly string[];
  maxFiles: number;
  maxFileSizeBytes?: string;
}

export interface UnsupportedQuestion extends QuestionBase {
  kind: "unsupported";
  sourceType: string;
}

export type Question =
  | SingleChoiceQuestion
  | MultiChoiceQuestion
  | OrdinalQuestion
  | TextQuestion
  | DateQuestion
  | TimeQuestion
  | FileQuestion
  | UnsupportedQuestion;

export interface QuestionGroup {
  id: GroupId;
  title: string;
  description?: string;
  kind: "grid";
  presentation: "radio" | "checkbox";
  options: readonly ChoiceOption[];
  questionIds: readonly QuestionId[];
  shuffleQuestions: boolean;
}

export interface SectionNode {
  id: SectionId;
  order: number;
  questionIds: readonly QuestionId[];
  nextSectionId?: SectionId;
}

export type LogicDestination =
  | { type: "next_section" }
  | { type: "section"; sectionId: SectionId }
  | { type: "submit" }
  | { type: "restart" };

export interface LogicTransition {
  sourceQuestionId: QuestionId;
  optionKey: OptionKey;
  destination: LogicDestination;
  evidence: "api_confirmed";
}

export interface FormLogic {
  entrySectionId: SectionId;
  sections: readonly SectionNode[];
  transitions: readonly LogicTransition[];
  coverage: "none" | "partial";
  hasRestartFlow: boolean;
}

export interface FormSnapshot {
  formId: FormId;
  title: string;
  description?: string;
  capturedAt: string;
  schemaHash: string;
  sections: readonly Section[];
  questions: readonly Question[];
  groups: readonly QuestionGroup[];
  logic: FormLogic;
}

export interface FileAnswer {
  fileName?: string;
  mimeType?: string;
}

export type AnswerValue =
  | { kind: "single_choice"; optionKey: OptionKey; label: string }
  | { kind: "multi_choice"; optionKeys: readonly OptionKey[]; labels: readonly string[] }
  | { kind: "ordinal"; value: number }
  | { kind: "text"; value: string }
  | { kind: "date"; value: string; includeTime: boolean; includeYear: boolean }
  | { kind: "time"; value: string; duration: boolean }
  | { kind: "file"; files: readonly FileAnswer[] }
  | { kind: "unsupported"; values: readonly string[] };

export type AnswerSlot =
  | { state: "answered"; value: AnswerValue }
  | { state: "skipped" }
  | { state: "not_reached" }
  | { state: "indeterminate" };

export interface PathResolution {
  questions: Readonly<Record<QuestionId, "reached" | "not_reached" | "indeterminate">>;
  confidence: "certain" | "partial" | "ambiguous";
}

export interface NormalizedResponse {
  responseId: ResponseId;
  createdAt?: string;
  lastSubmittedAt?: string;
  answers: Readonly<Record<QuestionId, AnswerSlot>>;
  origin: "original";
  path: PathResolution;
}

const answeredQuestionIds = (
  answers: Readonly<Record<QuestionId, AnswerSlot>>,
): ReadonlySet<QuestionId> =>
  new Set(
    Object.entries(answers)
      .filter(([, slot]) => slot.state === "answered")
      .map(([questionId]) => questionId as QuestionId),
  );

type SectionReachability = "reached" | "not_reached" | "unknown";

/** Resolve only reachability supported by observed answers and explicit form routing. */
export const resolveResponsePath = (
  form: FormSnapshot,
  answers: Readonly<Record<QuestionId, AnswerSlot>>,
): PathResolution => {
  const answeredIds = answeredQuestionIds(answers);
  const sectionByQuestion = new Map<QuestionId, SectionId>();
  const sectionById = new Map<SectionId, SectionNode>();
  const sectionState = new Map<SectionId, SectionReachability>();
  const answeredSections = new Set<SectionId>();

  for (const section of form.logic.sections) {
    sectionById.set(section.id, section);
    sectionState.set(section.id, "unknown");
    for (const questionId of section.questionIds) sectionByQuestion.set(questionId, section.id);
  }
  sectionState.set(form.logic.entrySectionId, "reached");

  for (const questionId of answeredIds) {
    const sectionId = sectionByQuestion.get(questionId);
    if (sectionId === undefined) continue;
    answeredSections.add(sectionId);
    sectionState.set(sectionId, "reached");
  }

  const transitionsByQuestion = new Map<QuestionId, Map<OptionKey, LogicTransition>>();
  for (const transition of form.logic.transitions) {
    const byOption = transitionsByQuestion.get(transition.sourceQuestionId) ?? new Map();
    byOption.set(transition.optionKey, transition);
    transitionsByQuestion.set(transition.sourceQuestionId, byOption);
  }

  let routingConflict = false;
  let restartObserved = false;
  const markReached = (sectionId: SectionId): void => {
    if (!sectionById.has(sectionId)) return;
    sectionState.set(sectionId, "reached");
  };
  const markNotReached = (sectionId: SectionId): void => {
    if (!sectionById.has(sectionId)) return;
    if (answeredSections.has(sectionId)) {
      routingConflict = true;
      sectionState.set(sectionId, "reached");
      return;
    }
    if (sectionState.get(sectionId) !== "reached") sectionState.set(sectionId, "not_reached");
  };

  for (const [questionId, slot] of Object.entries(answers)) {
    if (slot.state !== "answered" || slot.value.kind !== "single_choice") continue;
    const byOption = transitionsByQuestion.get(questionId as QuestionId);
    const transition = byOption?.get(slot.value.optionKey);
    if (transition === undefined) continue;

    const sourceSectionId = sectionByQuestion.get(questionId as QuestionId);
    if (sourceSectionId === undefined) continue;
    const sourceSection = sectionById.get(sourceSectionId);
    if (sourceSection === undefined) continue;

    switch (transition.destination.type) {
      case "next_section": {
        if (sourceSection.nextSectionId !== undefined) markReached(sourceSection.nextSectionId);
        break;
      }
      case "section": {
        const destinationSection = sectionById.get(transition.destination.sectionId);
        if (destinationSection === undefined) break;
        markReached(destinationSection.id);
        if (destinationSection.order > sourceSection.order) {
          for (const section of form.logic.sections) {
            if (section.order > sourceSection.order && section.order < destinationSection.order) {
              markNotReached(section.id);
            }
          }
        } else if (destinationSection.order < sourceSection.order) {
          routingConflict = true;
        }
        break;
      }
      case "submit": {
        for (const section of form.logic.sections) {
          if (section.order > sourceSection.order) markNotReached(section.id);
        }
        break;
      }
      case "restart":
        restartObserved = true;
        break;
    }
  }

  const questions: Record<QuestionId, "reached" | "not_reached" | "indeterminate"> = {};
  let hasIndeterminate = false;
  for (const question of form.questions) {
    if (answeredIds.has(question.id)) {
      questions[question.id] = "reached";
      continue;
    }
    const reachability = sectionState.get(question.sectionId) ?? "unknown";
    if (reachability === "reached") questions[question.id] = "reached";
    else if (reachability === "not_reached") questions[question.id] = "not_reached";
    else {
      questions[question.id] = "indeterminate";
      hasIndeterminate = true;
    }
  }

  const restartSourceQuestionIds = new Set(
    form.logic.transitions
      .filter((transition) => transition.destination.type === "restart")
      .map((transition) => transition.sourceQuestionId),
  );
  const restartProvablyIrrelevant =
    !form.logic.hasRestartFlow ||
    [...restartSourceQuestionIds].every((questionId) => {
      const slot = answers[questionId];
      if (slot?.state === "answered" && slot.value.kind === "single_choice") {
        return (
          transitionsByQuestion.get(questionId)?.get(slot.value.optionKey)?.destination.type !==
          "restart"
        );
      }
      return questions[questionId] === "not_reached";
    });

  let confidence: PathResolution["confidence"] = "certain";
  if (
    restartObserved ||
    (form.logic.hasRestartFlow && hasIndeterminate && !restartProvablyIrrelevant)
  ) {
    confidence = "ambiguous";
  } else if (hasIndeterminate || routingConflict) {
    confidence = form.logic.transitions.length > 0 ? "partial" : "ambiguous";
  }
  return { questions, confidence };
};
