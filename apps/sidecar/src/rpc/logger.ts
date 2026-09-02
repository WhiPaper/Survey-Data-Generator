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
];

export interface SafeLogger {
  info(event: string, fields?: SafeLogFields): void;
  error(event: string, fields?: SafeLogFields): void;
}

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
