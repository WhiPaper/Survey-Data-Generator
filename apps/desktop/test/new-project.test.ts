import { describe, expect, it } from "vitest";

import {
  MAX_PROJECT_NAME_LENGTH,
  normalizeProjectName,
  projectNameValidationMessage,
} from "../src/newProject";

describe("new project naming", () => {
  it("trims the project name without changing its interior text", () => {
    expect(normalizeProjectName("  Q3 survey copy  ")).toBe("Q3 survey copy");
  });

  it("requires a non-empty project name", () => {
    expect(projectNameValidationMessage("   ")).toBe("프로젝트 이름을 입력해주세요.");
  });

  it("allows names up to 120 characters", () => {
    expect(projectNameValidationMessage("a".repeat(MAX_PROJECT_NAME_LENGTH))).toBeNull();
    expect(projectNameValidationMessage("a".repeat(MAX_PROJECT_NAME_LENGTH + 1))).toContain(
      "120자 이하",
    );
  });
});
