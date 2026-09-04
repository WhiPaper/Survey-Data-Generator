export type SafeLogValue = string | number | boolean;

export interface SafeLogFields {
  readonly appVersion?: string;
  readonly protocolVersion?: number;
  readonly databaseSchemaVersion?: number;
  readonly domainSchemaVersion?: number;
  readonly engineVersion?: number;
  readonly profilerVersion?: number;
  readonly responses?: number;
  readonly questions?: number;
  readonly durationMs?: number;
  readonly errorCode?: string;
  readonly scopesGranted?: number;
  readonly rowCount?: number;
  readonly columnCount?: number;
  readonly bytesWritten?: number;
  readonly format?: string;
  readonly batchCount?: number;
  readonly fieldCount?: number;
  readonly model?: string;
  readonly promptVersion?: number;
  readonly retryCount?: number;
  readonly runId?: string;
  readonly method?: string;
  readonly requestId?: string;
  readonly phase?: string;
  readonly errorKind?: string;
  readonly causeCode?: string;
  readonly causeKind?: string;
  readonly persistenceTable?: string;
  readonly persistenceOperation?: string;
  readonly responseIndex?: number;
  readonly questionIndex?: number;
  readonly operationId?: string;
  readonly step?: string;
  readonly pageNumber?: number;
  readonly itemCount?: number;
  readonly status?: string;
  readonly workerCode?: string;
  readonly exitCode?: number;
}

type SafeLogField = keyof SafeLogFields;

const safeLogFields: readonly SafeLogField[] = [
  "appVersion",
  "protocolVersion",
  "databaseSchemaVersion",
  "domainSchemaVersion",
  "engineVersion",
  "profilerVersion",
  "responses",
  "questions",
  "durationMs",
  "errorCode",
  "scopesGranted",
  "rowCount",
  "columnCount",
  "bytesWritten",
  "format",
  "batchCount",
  "fieldCount",
  "model",
  "promptVersion",
  "retryCount",
  "runId",
  "method",
  "requestId",
  "phase",
  "errorKind",
  "causeCode",
  "causeKind",
  "persistenceTable",
  "persistenceOperation",
  "responseIndex",
  "questionIndex",
  "operationId",
  "step",
  "pageNumber",
  "itemCount",
  "status",
  "workerCode",
  "exitCode",
];

export interface SafeLogger {
  info(event: string, fields?: SafeLogFields): void;
  error(event: string, fields?: SafeLogFields): void;
}

export const safeErrorKind = (error: unknown): string =>
  error instanceof Error ? error.name : typeof error;

const safeCode = (value: unknown): string | undefined =>
  typeof value === "string" && /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/.test(value) ? value : undefined;

export const safeErrorContext = (
  error: unknown,
): Pick<
  SafeLogFields,
  | "errorKind"
  | "causeCode"
  | "causeKind"
  | "persistenceTable"
  | "persistenceOperation"
  | "responseIndex"
  | "questionIndex"
  | "operationId"
  | "step"
  | "pageNumber"
  | "itemCount"
  | "status"
> => {
  if (typeof error !== "object" || error === null) {
    return { errorKind: safeErrorKind(error) };
  }
  const record = error as {
    code?: unknown;
    kind?: unknown;
    persistenceTable?: unknown;
    persistenceOperation?: unknown;
    responseIndex?: unknown;
    questionIndex?: unknown;
    operationId?: unknown;
    step?: unknown;
    pageNumber?: unknown;
    itemCount?: unknown;
    status?: unknown;
  };
  const causeCode = safeCode(record.code);
  const causeKind = safeCode(record.kind);
  return {
    errorKind: safeErrorKind(error),
    ...(causeCode === undefined ? {} : { causeCode }),
    ...(causeKind === undefined ? {} : { causeKind }),
    ...(typeof record.persistenceTable === "string"
      ? { persistenceTable: record.persistenceTable }
      : {}),
    ...(typeof record.persistenceOperation === "string"
      ? { persistenceOperation: record.persistenceOperation }
      : {}),
    ...(typeof record.responseIndex === "number" ? { responseIndex: record.responseIndex } : {}),
    ...(typeof record.questionIndex === "number" ? { questionIndex: record.questionIndex } : {}),
    ...(typeof record.operationId === "string" ? { operationId: record.operationId } : {}),
    ...(typeof record.step === "string" ? { step: record.step } : {}),
    ...(typeof record.pageNumber === "number" ? { pageNumber: record.pageNumber } : {}),
    ...(typeof record.itemCount === "number" ? { itemCount: record.itemCount } : {}),
    ...(typeof record.status === "string" ? { status: record.status } : {}),
  };
};

const write = (level: "info" | "error", event: string, fields: SafeLogFields | undefined): void => {
  const safeFields: Record<string, SafeLogValue> = {};
  for (const [key, value] of Object.entries(fields ?? {})) {
    if (value !== undefined && safeLogFields.includes(key as SafeLogField)) {
      safeFields[key] = value;
    }
  }
  const payload = { level, event, ...safeFields };
  process.stderr.write(`${JSON.stringify(payload)}\n`);
};

export const stderrLogger: SafeLogger = {
  info: (event, fields) => write("info", event, fields),
  error: (event, fields) => write("error", event, fields),
};
