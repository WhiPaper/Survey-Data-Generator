import { randomUUID } from "node:crypto";

import { asc, eq } from "drizzle-orm";

import type { ValueGroupObservedValue, ValueGroupView } from "@survey-synth/contracts";
import type { FormSnapshot, NormalizedResponse, QuestionId } from "@survey-synth/domain";

import { backendFailure } from "../errors";
import type { SurveyDatabase } from "../persistence/database";
import { formSnapshots, valueGroups } from "../persistence/schema";
import { getProject, getSourceRevision, listSourceResponses } from "../persistence/store";

export interface ValueGroupService {
  list(projectId: string): Promise<ValueGroupView[]>;
  values(projectId: string, questionId: string): Promise<ValueGroupObservedValue[]>;
  create(input: {
    projectId: string;
    questionId: string;
    name: string;
    members: string[];
  }): Promise<ValueGroupView>;
  delete(valueGroupId: string): Promise<void>;
}

const parseMembers = (membersJson: string): string[] => {
  const parsed = JSON.parse(membersJson) as unknown;
  if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== "string" || !value)) {
    throw backendFailure("INTERNAL", "Stored ValueGroup members are invalid");
  }
  return parsed;
};

const view = (row: typeof valueGroups.$inferSelect): ValueGroupView => ({
  id: row.id,
  projectId: row.projectId,
  questionId: row.questionId,
  name: row.name,
  members: parseMembers(row.membersJson),
  createdAt: new Date(row.createdAtMs).toISOString(),
  updatedAt: new Date(row.updatedAtMs).toISOString(),
});

const loadCurrentForm = (
  db: SurveyDatabase,
  projectId: string,
): { form: FormSnapshot; revisionId: string } => {
  const project = getProject(db, projectId);
  if (!project) throw backendFailure("NOT_FOUND", "Project was not found");
  if (!project.currentSourceRevisionId) {
    throw backendFailure("VALIDATION_FAILED", "Project has no imported source revision");
  }
  const revision = getSourceRevision(db, project.currentSourceRevisionId);
  if (!revision || revision.projectId !== projectId) {
    throw backendFailure("INTERNAL", "Project source revision is invalid");
  }
  const snapshot = db
    .select()
    .from(formSnapshots)
    .where(eq(formSnapshots.id, revision.formSnapshotId))
    .get();
  if (!snapshot) throw backendFailure("INTERNAL", "Project Form snapshot is missing");

  const parsed = JSON.parse(snapshot.schemaJson) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw backendFailure("INTERNAL", "Stored Form snapshot is invalid");
  }
  const form = parsed as FormSnapshot;
  if (!Array.isArray(form.questions)) {
    throw backendFailure("INTERNAL", "Stored Form snapshot is invalid");
  }
  return { form, revisionId: revision.id };
};

const singleChoiceQuestion = (form: FormSnapshot, questionId: string) => {
  const question = form.questions.find((candidate) => candidate.id === questionId);
  if (!question) throw backendFailure("VALIDATION_FAILED", "ValueGroup question was not found");
  if (question.kind !== "single_choice") {
    throw backendFailure("VALIDATION_FAILED", "M5 ValueGroup supports single-choice questions only");
  }
  return question;
};

const response = (value: unknown): NormalizedResponse => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw backendFailure("INTERNAL", "Stored normalized response is invalid");
  }
  return value as NormalizedResponse;
};

export const createValueGroupService = (db: SurveyDatabase): ValueGroupService => ({
  list: async (projectId) => {
    if (!getProject(db, projectId)) throw backendFailure("NOT_FOUND", "Project was not found");
    return db
      .select()
      .from(valueGroups)
      .where(eq(valueGroups.projectId, projectId))
      .orderBy(asc(valueGroups.createdAtMs), asc(valueGroups.id))
      .all()
      .map(view);
  },

  values: async (projectId, questionId) => {
    const { form, revisionId } = loadCurrentForm(db, projectId);
    const question = singleChoiceQuestion(form, questionId);
    const counts = new Map<string, number>();
    for (const stored of listSourceResponses(db, revisionId)) {
      const slot = response(stored.response).answers[question.id as QuestionId];
      if (slot?.state === "answered" && slot.value.kind === "single_choice") {
        const key = String(slot.value.optionKey);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    return question.options.map((option) => ({
      value: String(option.key),
      label: option.label,
      count: counts.get(String(option.key)) ?? 0,
    }));
  },

  create: async (input) => {
    const name = input.name.trim();
    if (!name) throw backendFailure("VALIDATION_FAILED", "ValueGroup name is required");
    const members = [...new Set(input.members.map((member) => member.trim()).filter(Boolean))];
    if (members.length === 0) {
      throw backendFailure("VALIDATION_FAILED", "ValueGroup must contain at least one value");
    }

    const { form } = loadCurrentForm(db, input.projectId);
    const question = singleChoiceQuestion(form, input.questionId);
    const allowed = new Set(question.options.map((option) => String(option.key)));
    const unknown = members.filter((member) => !allowed.has(member));
    if (unknown.length > 0) {
      throw backendFailure("VALIDATION_FAILED", "ValueGroup contains values outside the Form structure");
    }

    const nowMs = Date.now();
    const row: typeof valueGroups.$inferInsert = {
      id: randomUUID(),
      projectId: input.projectId,
      questionId: input.questionId,
      name,
      membersJson: JSON.stringify(members),
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
    };
    db.insert(valueGroups).values(row).run();
    return view(row as typeof valueGroups.$inferSelect);
  },

  delete: async (valueGroupId) => {
    const existing = db.select().from(valueGroups).where(eq(valueGroups.id, valueGroupId)).get();
    if (!existing) throw backendFailure("NOT_FOUND", "ValueGroup was not found");
    db.delete(valueGroups).where(eq(valueGroups.id, valueGroupId)).run();
  },
});
