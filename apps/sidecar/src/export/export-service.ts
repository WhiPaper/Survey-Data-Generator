import {
  HostDialogSaveResultSchema,
  type RunExportFormat,
  type RunsExportParams,
  type RunsExportResult,
} from "@survey-synth/contracts";
import type { RunId } from "@survey-synth/domain";
import type { ProjectRepository } from "../persistence/projects.js";
import type { HostCapabilityClient } from "../host.js";
import type { SafeLogger } from "../rpc/logger.js";
import { sidecarError } from "../errors.js";
import { sanitizeFilename } from "./safety.js";
import { compileExportSchema } from "./schema.js";
import { writeCsvExport } from "./csv-writer.js";
import { writeXlsxExport } from "./xlsx-writer.js";

const extensionFor = (format: RunExportFormat): "csv" | "xlsx" =>
  format === "csv" ? "csv" : "xlsx";

const stripExportExtensions = (name: string): string => name.replace(/(?:\.(?:csv|xlsx))+$/iu, "");

const suggestedFilename = (title: string, format: RunExportFormat): string => {
  const ext = extensionFor(format);
  return `${stripExportExtensions(sanitizeFilename(title))}.${ext}`;
};

export const ensureExportExtension = (destination: string, format: RunExportFormat): string => {
  const ext = extensionFor(format);
  const expected = `.${ext}`;
  const withoutExportExtensions = destination.replace(/(?:\.(?:csv|xlsx))+$/iu, "");
  return `${withoutExportExtensions}${expected}`;
};

export interface ExportServiceOptions {
  readonly projects: ProjectRepository;
  readonly hostClient?: HostCapabilityClient;
  readonly logger: SafeLogger;
}

export class ExportService {
  public constructor(private readonly options: ExportServiceOptions) {}

  public async export(params: RunsExportParams): Promise<RunsExportResult> {
    const historicalData = this.options.projects.loadHistoricalRunExportData(params.runId as RunId);

    const ext = extensionFor(params.format);
    const filterName =
      params.format === "csv" ? "CSV (쉼표로 분리) (*.csv)" : "Excel 통합 문서 (*.xlsx)";
    const defaultName = suggestedFilename(historicalData.form.title, params.format);

    if (!this.options.hostClient) {
      throw sidecarError("BACKEND_UNAVAILABLE", "Save dialog host capability is unavailable", true);
    }

    const hostResponse = HostDialogSaveResultSchema.parse(
      await this.options.hostClient.call("host.dialog.save", {
        defaultName,
        filterName,
        filterExtension: ext,
      }),
    );

    if (hostResponse.path === null) {
      return { ok: true, cancelled: true };
    }

    return this.writeHistoricalData(
      historicalData,
      params.format,
      ensureExportExtension(hostResponse.path, params.format),
    );
  }

  public async exportToFile(options: {
    readonly runId: string;
    readonly format: RunExportFormat;
    readonly destination: string;
  }): Promise<RunsExportResult> {
    const historicalData = this.options.projects.loadHistoricalRunExportData(
      options.runId as RunId,
    );
    return this.writeHistoricalData(
      historicalData,
      options.format,
      ensureExportExtension(options.destination, options.format),
    );
  }

  private async writeHistoricalData(
    historicalData: ReturnType<ProjectRepository["loadHistoricalRunExportData"]>,
    format: RunExportFormat,
    destination: string,
  ): Promise<RunsExportResult> {
    const schema = compileExportSchema({
      form: historicalData.form,
      originalResponses: historicalData.originalResponses,
      syntheticResponses: historicalData.syntheticResponses,
      timeZone: historicalData.timeZone,
      semanticInferences: historicalData.semanticInferences,
      semanticOverrides: historicalData.semanticOverrides,
    });
    if (schema.rowCount !== historicalData.run.finalResponseCount) {
      throw sidecarError(
        "INTERNAL",
        `Export row count mismatch: expected ${historicalData.run.finalResponseCount}, found ${schema.rowCount}`,
        false,
      );
    }

    const startTime = Date.now();
    let result: {
      destination: string;
      rowCount: number;
      columnCount: number;
      bytesWritten: number;
    };

    if (format === "csv") {
      result = await writeCsvExport(schema, destination);
    } else {
      result = await writeXlsxExport(schema, destination);
    }

    this.options.logger.info("run_export_completed", {
      format,
      rowCount: result.rowCount,
      columnCount: result.columnCount,
      durationMs: Date.now() - startTime,
      bytesWritten: result.bytesWritten,
    });

    return {
      ok: true,
      cancelled: false,
      destination: result.destination,
      rowCount: result.rowCount,
      columnCount: result.columnCount,
      bytesWritten: result.bytesWritten,
    };
  }
}
