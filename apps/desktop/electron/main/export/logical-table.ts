import type {
  AnswerSlot,
  DateQuestion,
  FormSnapshot,
  MultiChoiceQuestion,
  NormalizedResponse,
  Question,
  TimeQuestion,
} from "@survey-synth/domain";

export type ExportCell =
  | { kind: "empty" }
  | { kind: "text"; value: string }
  | { kind: "number"; value: number }
  | { kind: "date"; value: Date }
  | { kind: "time"; seconds: number; duration: boolean }
  | { kind: "datetime"; value: Date; isoWithOffset: string };

export type ExportColumn = {
  key: string;
  header: string;
};

export type ExportRow = {
  cells: readonly ExportCell[];
};

export type LogicalExportTable = {
  columns: readonly ExportColumn[];
  rows: readonly ExportRow[];
};

export type PersistedExportRow = {
  responseId: string;
  submittedAtMs: number;
  response: NormalizedResponse;
};

const emptyCell = (): ExportCell => ({ kind: "empty" });

const parseDateCell = (question: DateQuestion, value: string): ExportCell => {
  if (!question.includeYear) return { kind: "text", value };

  const match = question.includeTime
    ? /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(value)
    : /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return { kind: "text", value };

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4] ?? 0);
  const minute = Number(match[5] ?? 0);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute
  ) {
    return { kind: "text", value };
  }

  return question.includeTime
    ? { kind: "datetime", value: date, isoWithOffset: date.toISOString() }
    : { kind: "date", value: date };
};

const parseTimeCell = (question: TimeQuestion, value: string): ExportCell => {
  const match = /^(\d+):(\d{2})$/.exec(value);
  if (!match) return { kind: "text", value };
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (minutes > 59 || (!question.duration && hours > 23)) return { kind: "text", value };
  return { kind: "time", seconds: hours * 3600 + minutes * 60, duration: question.duration };
};

const orderedCheckboxText = (
  question: MultiChoiceQuestion,
  optionKeys: readonly string[],
  otherValue?: string,
): string => {
  const selected = new Set(optionKeys);
  const values = question.options
    .filter((option) => selected.has(option.key))
    .map((option) => option.label);
  if (otherValue) values.push(otherValue);
  return values.join(", ");
};

const answerCell = (question: Question, slot: AnswerSlot | undefined): ExportCell => {
  if (!slot || slot.state !== "answered") return emptyCell();
  const answer = slot.value;

  switch (answer.kind) {
    case "single_choice":
      return { kind: "text", value: answer.otherValue ?? answer.label };
    case "multi_choice":
      return {
        kind: "text",
        value: orderedCheckboxText(question as MultiChoiceQuestion, answer.optionKeys, answer.otherValue),
      };
    case "ordinal":
      return { kind: "number", value: answer.value };
    case "text":
      return { kind: "text", value: answer.value };
    case "date":
      return parseDateCell(question as DateQuestion, answer.value);
    case "time":
      return parseTimeCell(question as TimeQuestion, answer.value);
    case "file":
      return emptyCell();
    case "unsupported":
      return { kind: "text", value: answer.values.join(", ") };
  }
};

const disambiguateHeaders = (headers: readonly string[]): string[] => {
  const counts = new Map<string, number>();
  return headers.map((header) => {
    const count = (counts.get(header) ?? 0) + 1;
    counts.set(header, count);
    return count === 1 ? header : `${header} (${count})`;
  });
};

const questionHeaders = (form: FormSnapshot): string[] => {
  const groups = new Map(form.groups.map((group) => [group.id, group]));
  return form.questions.map((question) => {
    if (!question.groupId) return question.title;
    const group = groups.get(question.groupId);
    return group ? `${group.title} — ${question.title}` : question.title;
  });
};

export const buildLogicalExportTable = (
  form: FormSnapshot,
  persistedRows: readonly PersistedExportRow[],
): LogicalExportTable => {
  const headers = disambiguateHeaders(["응답 제출 시간", ...questionHeaders(form)]);
  const columns: ExportColumn[] = headers.map((header, index) => ({
    key: index === 0 ? "submittedAt" : String(form.questions[index - 1]!.id),
    header,
  }));

  const sortedRows = [...persistedRows].sort(
    (left, right) =>
      left.submittedAtMs - right.submittedAtMs || left.responseId.localeCompare(right.responseId),
  );
  const rows = sortedRows.map((row): ExportRow => {
    const submittedAt = new Date(row.submittedAtMs);
    return {
      cells: [
        { kind: "datetime", value: submittedAt, isoWithOffset: submittedAt.toISOString() },
        ...form.questions.map((question) => answerCell(question, row.response.answers[question.id])),
      ],
    };
  });

  return { columns, rows };
};
