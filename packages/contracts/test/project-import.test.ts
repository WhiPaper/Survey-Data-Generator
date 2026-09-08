import { describe, expect, it } from "vitest";

import { FormsImportParamsSchema } from "../src/protocol";

describe("project import contract", () => {
  it("accepts a trimmed custom project name", () => {
    expect(
      FormsImportParamsSchema.parse({ formId: "form-1", projectName: "  Research copy  " }),
    ).toMatchObject({ projectName: "Research copy" });
  });

  it("keeps projectName optional for the legacy Form-title default", () => {
    expect(FormsImportParamsSchema.safeParse({ formId: "form-1" }).success).toBe(true);
  });

  it("rejects blank or overlong project names", () => {
    expect(
      FormsImportParamsSchema.safeParse({ formId: "form-1", projectName: "   " }).success,
    ).toBe(false);
    expect(
      FormsImportParamsSchema.safeParse({ formId: "form-1", projectName: "a".repeat(121) }).success,
    ).toBe(false);
  });
});
