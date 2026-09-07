import { describe, expect, it } from "vitest";

import { RunResultDiagnosticsSchema } from "../src/protocol";

describe("Run result diagnostics contract", () => {
  it("accepts narrow persisted diagnostics", () => {
    expect(
      RunResultDiagnosticsSchema.parse({
        sourceResponseCount: 80,
        syntheticResponseCount: 42,
        replacementCount: 2,
        structuralValidation: "passed",
      }),
    ).toEqual({
      sourceResponseCount: 80,
      syntheticResponseCount: 42,
      replacementCount: 2,
      structuralValidation: "passed",
    });
  });

  it("rejects implementation-specific validation states", () => {
    expect(
      RunResultDiagnosticsSchema.safeParse({
        sourceResponseCount: 80,
        syntheticResponseCount: 40,
        replacementCount: 0,
        structuralValidation: "solver_ok",
      }).success,
    ).toBe(false);
  });
});
