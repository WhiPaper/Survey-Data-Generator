import type {
  DomainSemanticOverride,
  FormSnapshot,
  NormalizedResponse,
  OptionKey,
  Question,
  QuestionId,
} from "@survey-synth/domain";
import { sidecarError } from "../errors.js";

export interface ExportColumn {
  readonly id: string;
  readonly header: string;
  readonly questionId?: QuestionId;
  readonly type: "datetime" | "date" | "time" | "number" | "string";
}

export type ExportCell =
  | { readonly kind: "empty" }
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "number"; readonly value: number }
  | {
      readonly kind: "date";
      readonly year: number;
      readonly month: number;
      readonly day: number;
      readonly formatted: string;
    }
  | {
      readonly kind: "time";
      readonly value: string;
      readonly seconds: number;
      readonly duration: boolean;
    }
  | { readonly kind: "datetime"; readonly value: Date; readonly isoWithOffset: string };

export interface ExportSchema {
  readonly columns: readonly ExportColumn[];
  readonly rowCount: number;
  readonly getRows: () => Iterable<readonly ExportCell[]>;
}

export interface ExportSemanticType {
  readonly questionId: QuestionId;
  readonly value: string;
}

export const formatTimestampInTimezone = (
  dateInput: string | Date,
  timeZone: string,
): { readonly date: Date; readonly isoWithOffset: string } => {
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  if (Number.isNaN(date.getTime())) {
    return { date: new Date(0), isoWithOffset: "" };
  }
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZoneName: "longOffset",
  });
  const parts = formatter.formatToParts(date);
  const getPart = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const year = getPart("year");
  const month = getPart("month");
  const day = getPart("day");
  const hour = getPart("hour");
  const minute = getPart("minute");
  const second = getPart("second");
  let offset = getPart("timeZoneName").replace("GMT", "");
  if (!offset || offset === "") offset = "+00:00";
  const isoWithOffset = `${year}-${month}-${day}T${hour}:${minute}:${second}${offset}`;
  const localDate = new Date(0);
  localDate.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  localDate.setUTCHours(Number(hour), Number(minute), Number(second), 0);
  return { date: localDate, isoWithOffset };
};

const isLeadingZeroNumber = (value: string): boolean => {
  const trimmed = value.trim();
  return /^0\d+/.test(trimmed) || /^-0\d+/.test(trimmed);
};

const dateFromParts = (
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): Date => {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  return date;
};

const isValidCalendarDate = (year: number, month: number, day: number): boolean => {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = dateFromParts(year, month, day);
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
};

const parseTime = (
  rawValue: string,
  duration: boolean,
): { readonly value: string; readonly seconds: number } | null => {
  const match = /^(\d{1,})(?::(\d{2}))(?::(\d{2}))?$/.exec(rawValue.trim());
  if (match === null) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = match[3] === undefined ? 0 : Number(match[3]);
  if (!Number.isSafeInteger(hours) || minutes > 59 || seconds > 59) return null;
  if (!duration && hours > 23) return null;
  const paddedHours = String(hours).padStart(2, "0");
  const value = duration
    ? `${paddedHours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${paddedHours}:${String(minutes).padStart(2, "0")}${
        seconds === 0 ? "" : `:${String(seconds).padStart(2, "0")}`
      }`;
  return { value, seconds: hours * 3600 + minutes * 60 + seconds };
};

const mapAnswerCell = (
  question: Question,
  response: NormalizedResponse,
  semanticType?: string,
): ExportCell => {
  const slot = response.answers[question.id];
  if (slot === undefined || slot.state !== "answered") {
    return { kind: "empty" };
  }

  const value = slot.value;
  switch (value.kind) {
    case "single_choice": {
      if (question.kind === "single_choice") {
        const option = question.options.find((opt) => opt.key === value.optionKey);
        if (option !== undefined) {
          if (option.isOther && value.label.startsWith("기타:")) {
            return { kind: "text", value: value.label };
          }
          if (option.isOther && !value.label.startsWith("기타:")) {
            return { kind: "text", value: `기타: ${value.otherValue ?? value.label}` };
          }
          return { kind: "text", value: option.label };
        }
      }
      return { kind: "text", value: value.label };
    }
    case "multi_choice": {
      if (question.kind === "multi_choice") {
        const selectedKeySet = new Set<OptionKey>(value.optionKeys);
        const orderedLabels: string[] = [];
        const knownKeys = new Set<OptionKey>();
        for (const opt of question.options) {
          knownKeys.add(opt.key);
          if (selectedKeySet.has(opt.key)) {
            orderedLabels.push(opt.isOther === true ? (value.otherValue ?? opt.label) : opt.label);
          }
        }
        if (value.optionKeys.length === 0) {
          orderedLabels.push(...value.labels);
        } else {
          for (let i = 0; i < value.optionKeys.length; i += 1) {
            const key = value.optionKeys[i];
            if (key !== undefined && !knownKeys.has(key)) {
              const label = value.labels[i];
              if (label !== undefined) orderedLabels.push(label);
            }
          }
        }
        return { kind: "text", value: orderedLabels.join(", ") };
      }
      return { kind: "text", value: value.labels.join(", ") };
    }
    case "ordinal": {
      return { kind: "number", value: value.value };
    }
    case "text": {
      const text = value.value;
      const trimmed = text.trim();
      const numericValue = Number(trimmed);
      if (
        semanticType === "numeric" &&
        trimmed.length > 0 &&
        !isLeadingZeroNumber(text) &&
        !Number.isNaN(numericValue) &&
        Number.isFinite(numericValue)
      ) {
        return { kind: "number", value: numericValue };
      }
      return { kind: "text", value: text };
    }
    case "date": {
      const rawDate = value.value.trim();
      if (!value.includeYear) {
        return { kind: "text", value: rawDate };
      }
      const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(rawDate);
      if (match) {
        const year = Number(match[1]);
        const month = Number(match[2]);
        const day = Number(match[3]);
        if (!isValidCalendarDate(year, month, day)) return { kind: "text", value: rawDate };
        if (value.includeTime && match[4] !== undefined && match[5] !== undefined) {
          const hour = Number(match[4]);
          const minute = Number(match[5]);
          const second = match[6] ? Number(match[6]) : 0;
          if (hour > 23 || minute > 59 || second > 59) return { kind: "text", value: rawDate };
          const dt = dateFromParts(year, month, day, hour, minute, second);
          return { kind: "datetime", value: dt, isoWithOffset: rawDate };
        }
        return {
          kind: "date",
          year,
          month,
          day,
          formatted: `${match[1]}-${match[2]}-${match[3]}`,
        };
      }
      return { kind: "text", value: rawDate };
    }
    case "time": {
      const parsed = parseTime(value.value, question.kind === "time" && question.duration);
      if (parsed === null) return { kind: "text", value: value.value };
      return {
        kind: "time",
        value: parsed.value,
        seconds: parsed.seconds,
        duration: question.kind === "time" && question.duration,
      };
    }
    case "file": {
      if (response.origin === "synthetic") {
        return { kind: "empty" };
      }
      const names = value.files
        .map((f) => f.fileName)
        .filter((name): name is string => typeof name === "string" && name.length > 0);
      return names.length > 0 ? { kind: "text", value: names.join(", ") } : { kind: "empty" };
    }
    case "unsupported": {
      return value.values.length > 0
        ? { kind: "text", value: value.values.join(", ") }
        : { kind: "empty" };
    }
  }
};

interface TaggedRow {
  readonly internalRowKey: string;
  readonly origin: "original" | "synthetic";
  readonly index: number;
  readonly responseId: string;
  readonly timestampEpoch: number;
  readonly response: NormalizedResponse;
}

const headerFamily = (header: string): string => {
  const match = /^(.*) \((\d+)\)$/.exec(header);
  return match !== null && Number(match[2]) >= 2 ? match[1]! : header;
};

const disambiguateHeaders = (rawHeaders: readonly { readonly header: string }[]): string[] => {
  const groups = new Map<string, number[]>();
  rawHeaders.forEach((item, index) => {
    const family = headerFamily(item.header);
    const group = groups.get(family) ?? [];
    group.push(index);
    groups.set(family, group);
  });

  const headers = rawHeaders.map((item) => item.header);
  for (const [family, indexes] of groups) {
    const hasBareFamily = indexes.some((index) => rawHeaders[index]!.header === family);
    if (indexes.length > 1 && hasBareFamily) {
      indexes.forEach((index, occurrence) => {
        headers[index] = occurrence === 0 ? family : `${family} (${occurrence + 1})`;
      });
    }
  }

  const used = new Set<string>();
  return headers.map((header) => {
    if (!used.has(header)) {
      used.add(header);
      return header;
    }
    const family = headerFamily(header);
    let suffix = 2;
    let candidate = `${family} (${suffix})`;
    while (used.has(candidate)) {
      suffix += 1;
      candidate = `${family} (${suffix})`;
    }
    used.add(candidate);
    return candidate;
  });
};

const compareStableText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export const compareExportRows = (a: TaggedRow, b: TaggedRow): number => {
  if (a.timestampEpoch !== b.timestampEpoch) return a.timestampEpoch - b.timestampEpoch;
  if (a.origin !== b.origin) return a.origin === "original" ? -1 : 1;
  if (a.origin === "original") {
    const responseIdOrder = compareStableText(a.responseId, b.responseId);
    if (responseIdOrder !== 0) return responseIdOrder;
  }
  return a.index - b.index;
};

export const assertExportRowShape = (
  schema: Pick<ExportSchema, "columns">,
  cells: readonly ExportCell[],
): void => {
  if (cells.length !== schema.columns.length) {
    throw sidecarError("INTERNAL", "Export row column count does not match its schema", false);
  }
};

export const assertExportRowCount = (schema: ExportSchema, actualRowCount: number): void => {
  if (actualRowCount !== schema.rowCount) {
    throw sidecarError(
      "INTERNAL",
      `Export row count mismatch: expected ${schema.rowCount}, found ${actualRowCount}`,
      false,
    );
  }
};

export const compileExportSchema = (input: {
  readonly form: FormSnapshot;
  readonly originalResponses: readonly NormalizedResponse[];
  readonly syntheticResponses: readonly NormalizedResponse[];
  readonly timeZone: string;
  readonly semanticInferences?: readonly ExportSemanticType[];
  readonly semanticOverrides?: readonly DomainSemanticOverride[];
}): ExportSchema => {
  const {
    form,
    originalResponses,
    syntheticResponses,
    timeZone,
    semanticInferences,
    semanticOverrides,
  } = input;

  const groupMap = new Map(form.groups.map((group) => [group.id, group]));
  const semanticMap = new Map(
    (semanticInferences ?? []).map((inference) => [inference.questionId, inference.value]),
  );
  for (const override of semanticOverrides ?? []) {
    semanticMap.set(override.questionId, override.value);
  }

  const columns: ExportColumn[] = [
    {
      id: "response_timestamp",
      header: "Response Timestamp",
      type: "datetime",
    },
  ];

  const rawHeaders: { id: string; header: string; question: Question }[] = [];
  for (const question of form.questions) {
    let headerTitle = question.title;
    if (question.groupId && groupMap.has(question.groupId)) {
      const group = groupMap.get(question.groupId)!;
      headerTitle = `${group.title} [${question.title}]`;
    }
    rawHeaders.push({ id: question.id, header: headerTitle, question });
  }

  const disambiguatedHeaders = disambiguateHeaders([
    { header: "Response Timestamp" },
    ...rawHeaders,
  ]).slice(1);
  for (const [index, item] of rawHeaders.entries()) {
    const disambiguated = disambiguatedHeaders[index]!;
    let colType: ExportColumn["type"] = "string";
    if (item.question.kind === "ordinal") colType = "number";
    else if (item.question.kind === "date") colType = item.question.includeYear ? "date" : "string";
    else if (item.question.kind === "time") colType = "time";
    else if (semanticMap.get(item.question.id) === "numeric") colType = "number";

    columns.push({
      id: item.id,
      header: disambiguated,
      questionId: item.question.id,
      type: colType,
    });
  }

  const taggedRows: TaggedRow[] = [];
  let index = 0;
  for (const resp of originalResponses) {
    const rawTs = resp.lastSubmittedAt ?? resp.createdAt ?? "";
    const parsed = Date.parse(rawTs);
    const tsEpoch = Number.isNaN(parsed) ? 0 : parsed;
    taggedRows.push({
      internalRowKey: `orig:${index}:${resp.responseId}`,
      origin: "original",
      index,
      responseId: String(resp.responseId),
      timestampEpoch: tsEpoch,
      response: resp,
    });
    index += 1;
  }
  let synthIndex = 0;
  for (const resp of syntheticResponses) {
    const rawTs = resp.lastSubmittedAt ?? resp.createdAt ?? "";
    const parsed = Date.parse(rawTs);
    const tsEpoch = Number.isNaN(parsed) ? 0 : parsed;
    taggedRows.push({
      internalRowKey: `synth:${synthIndex}:${resp.responseId}`,
      origin: "synthetic",
      index: synthIndex,
      responseId: String(resp.responseId),
      timestampEpoch: tsEpoch,
      response: resp,
    });
    synthIndex += 1;
  }

  taggedRows.sort(compareExportRows);

  const rowCount = taggedRows.length;

  const getRows = function* (): Iterable<readonly ExportCell[]> {
    for (const tagged of taggedRows) {
      const resp = tagged.response;
      const rawTs = resp.lastSubmittedAt ?? resp.createdAt ?? "";
      const tsInfo = formatTimestampInTimezone(rawTs, timeZone);
      const cells: ExportCell[] =
        tsInfo.isoWithOffset === ""
          ? [{ kind: "empty" }]
          : [{ kind: "datetime", value: tsInfo.date, isoWithOffset: tsInfo.isoWithOffset }];

      for (const item of rawHeaders) {
        const cell = mapAnswerCell(item.question, resp, semanticMap.get(item.question.id));
        cells.push(cell);
      }
      yield cells;
    }
  };

  return {
    columns,
    rowCount,
    getRows,
  };
};
