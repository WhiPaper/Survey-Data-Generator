import { describe, expect, it } from "vitest";
import {
  isFormulaDangerous,
  sanitizeFilename,
  sanitizeFormulaInjection,
} from "../src/export/safety.js";

describe("export safety", () => {
  it("detects dangerous formula prefixes", () => {
    expect(isFormulaDangerous("=SUM(A1:A10)")).toBe(true);
    expect(isFormulaDangerous("+12345")).toBe(true);
    expect(isFormulaDangerous("-12345")).toBe(true);
    expect(isFormulaDangerous("@lookup(A1)")).toBe(true);
    expect(isFormulaDangerous("\t=1+1")).toBe(true);
    expect(isFormulaDangerous("  +1+1")).toBe(true);
    expect(isFormulaDangerous("\r=cmd|' /C calc'!A0")).toBe(true);
    expect(isFormulaDangerous("\n=1+1")).toBe(true);

    expect(isFormulaDangerous("Normal text")).toBe(false);
    expect(isFormulaDangerous("12345")).toBe(false);
    expect(isFormulaDangerous("user@example.com")).toBe(false);
    expect(isFormulaDangerous("")).toBe(false);
  });

  it("escapes dangerous formula prefixes with single quote", () => {
    expect(sanitizeFormulaInjection("=1+1")).toBe("'=1+1");
    expect(sanitizeFormulaInjection("+100")).toBe("'+100");
    expect(sanitizeFormulaInjection("-50")).toBe("'-50");
    expect(sanitizeFormulaInjection("@import")).toBe("'@import");
    expect(sanitizeFormulaInjection("\t=calc")).toBe("'\t=calc");
    expect(sanitizeFormulaInjection("\n=1")).toBe("'\n=1");

    expect(sanitizeFormulaInjection("Hello world")).toBe("Hello world");
    expect(sanitizeFormulaInjection("42")).toBe("42");
  });

  it("sanitizes filename for filesystem safety", () => {
    expect(sanitizeFilename("Survey: Customer Satisfaction? (v1) *final*")).toBe(
      "Survey_ Customer Satisfaction_ (v1) _final_",
    );
    expect(sanitizeFilename("path/with\\invalid|chars<test>")).toBe(
      "path_with_invalid_chars_test_",
    );
    expect(sanitizeFilename("   ")).toBe("survey-responses");
    expect(sanitizeFilename("")).toBe("survey-responses");
    expect(sanitizeFilename("CON")).toBe("_CON");
    expect(sanitizeFilename("report. ")).toBe("report");
    expect(sanitizeFilename("x".repeat(300)).length).toBeLessThanOrEqual(120);
  });
});
