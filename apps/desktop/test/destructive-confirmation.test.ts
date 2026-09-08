import { describe, expect, it } from "vitest";

import {
  accountRevokeConfirmationCopy,
  projectDeleteConfirmationCopy,
} from "../src/destructiveConfirmation";

describe("destructive confirmation copy", () => {
  it("states the local project deletion scope and preserves the Google Form", () => {
    expect(projectDeleteConfirmationCopy("가을 설문")).toEqual({
      title: "프로젝트를 삭제할까요?",
      description:
        "“가을 설문”의 이 기기 데이터와 생성 결과가 삭제됩니다. Google Form 원본은 변경되지 않습니다.",
      actionLabel: "프로젝트 삭제",
    });
  });

  it("states that revoking Google access retains local project data", () => {
    expect(accountRevokeConfirmationCopy("user@example.com")).toEqual({
      title: "Google 연결을 해제할까요?",
      description:
        "“user@example.com”의 Google 연결을 해제합니다. 이 기기의 프로젝트와 생성 결과는 삭제되지 않습니다.",
      actionLabel: "연결 해제",
    });
  });
});
