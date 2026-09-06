import { describe, expect, it, vi } from "vitest";

import { createRequest, parseRpcRequest } from "@survey-synth/contracts";

import { handleBackendCall } from "../electron/main/backend";
import { exportRun } from "../src/api/backend";

const serialize = (request: ReturnType<typeof createRequest>) => JSON.stringify(request);

describe("M9 export backend boundary", () => {
  it("keeps the renderer request small and typed", async () => {
    const invoke = vi.fn(async (_command: string, args?: Record<string, unknown>) => {
      const request = parseRpcRequest(JSON.parse(String(args?.request)) as unknown);
      expect(request).toMatchObject({
        method: "runs.export",
        params: { runId: "run-1", format: "xlsx" },
      });
      return { status: "saved" };
    });

    await expect(exportRun("run-1", "xlsx", { invoke })).resolves.toEqual({ status: "saved" });
  });

  it("lets Electron Main choose the destination before writing the saved Run", async () => {
    const exportTo = vi.fn(async () => undefined);
    const pickRunExportDestination = vi.fn(async () => "C:/tmp/result.csv");

    await expect(
      handleBackendCall(
        serialize(createRequest("export", "runs.export", { runId: "run-1", format: "csv" })),
        {
          runExports: {
            buildTable: vi.fn(),
            exportTo,
          },
          pickRunExportDestination,
        },
      ),
    ).resolves.toEqual({ status: "saved" });

    expect(pickRunExportDestination).toHaveBeenCalledWith({ runId: "run-1", format: "csv" });
    expect(exportTo).toHaveBeenCalledWith("run-1", "csv", "C:/tmp/result.csv");
  });

  it("does not write a file when the save dialog is cancelled", async () => {
    const exportTo = vi.fn(async () => undefined);

    await expect(
      handleBackendCall(
        serialize(createRequest("export", "runs.export", { runId: "run-1", format: "xlsx" })),
        {
          runExports: {
            buildTable: vi.fn(),
            exportTo,
          },
          pickRunExportDestination: async () => null,
        },
      ),
    ).resolves.toEqual({ status: "cancelled" });

    expect(exportTo).not.toHaveBeenCalled();
  });
});
