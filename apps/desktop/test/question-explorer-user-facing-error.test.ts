import { describe, expect, it } from "vitest";

import { questionExplorerErrorMessage } from "../src/QuestionExplorerPanel/userFacingError";

const backendFailure = (code: string, message = "Backend SourceScope candidate_support failure") => ({
  backendError: { code, message, recoverable: true },
});

describe("Question Explorer user-facing errors", () => {
  it("never exposes raw internal exception text for generic failures", () => {
    const message = questionExplorerErrorMessage(
      new Error("Backend returned invalid Target draft candidate_support"),
      "generate",
    );

    expect(message).toBe("응답을 생성하지 못했습니다.");
    expect(message).not.toMatch(/Backend|Target|candidate_support|SourceScope/);
  });

  it("uses operation-specific copy when the structured code is not actionable", () => {
    expect(questionExplorerErrorMessage(backendFailure("INTERNAL"), "save_draft")).toBe(
      "변경사항을 저장하지 못했습니다.",
    );
    expect(questionExplorerErrorMessage(backendFailure("VALIDATION_FAILED"), "save_group")).toBe(
      "그룹을 저장하지 못했습니다.",
    );
    expect(questionExplorerErrorMessage(backendFailure("TARGET_CONFLICT"), "generate")).toBe(
      "응답을 생성하지 못했습니다.",
    );
  });

  it("surfaces safe actionable guidance for account and service conditions", () => {
    expect(questionExplorerErrorMessage(backendFailure("REAUTH_REQUIRED"), "load_workspace")).toBe(
      "Google 계정 연결이 만료되었습니다. 다시 연결해주세요.",
    );
    expect(questionExplorerErrorMessage(backendFailure("PERMISSION_DENIED"), "load_workspace")).toBe(
      "이 작업에 필요한 권한이 없습니다.",
    );
    expect(questionExplorerErrorMessage(backendFailure("RATE_LIMITED"), "generate")).toBe(
      "요청이 많습니다. 잠시 후 다시 시도해주세요.",
    );
    expect(questionExplorerErrorMessage(backendFailure("GOOGLE_API_ERROR"), "reload_distribution")).toBe(
      "Google Forms 정보를 가져오지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해주세요.",
    );
  });
});
