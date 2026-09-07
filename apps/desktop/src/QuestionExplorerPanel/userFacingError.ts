import { BackendErrorCodeSchema, type BackendErrorCode } from "@survey-synth/contracts";

export type QuestionExplorerOperation =
  | "load_workspace"
  | "save_draft"
  | "reload_distribution"
  | "load_text_values"
  | "save_group"
  | "delete_group"
  | "load_result"
  | "generate"
  | "complete_generation"
  | "export_result";

const OPERATION_FALLBACK: Record<QuestionExplorerOperation, string> = {
  load_workspace: "생성 설정을 불러오지 못했습니다.",
  save_draft: "변경사항을 저장하지 못했습니다.",
  reload_distribution: "분포를 다시 불러오지 못했습니다.",
  load_text_values: "응답 값을 불러오지 못했습니다.",
  save_group: "그룹을 저장하지 못했습니다.",
  delete_group: "그룹을 삭제하지 못했습니다.",
  load_result: "결과를 불러오지 못했습니다.",
  generate: "응답을 생성하지 못했습니다.",
  complete_generation: "생성을 완료하지 못했습니다.",
  export_result: "결과를 내보내지 못했습니다.",
};

const backendErrorCode = (cause: unknown): BackendErrorCode | null => {
  if (typeof cause !== "object" || cause === null) return null;
  const backendError = Reflect.get(cause, "backendError");
  if (typeof backendError !== "object" || backendError === null) return null;
  const parsed = BackendErrorCodeSchema.safeParse(Reflect.get(backendError, "code"));
  return parsed.success ? parsed.data : null;
};

export const questionExplorerErrorMessage = (
  cause: unknown,
  operation: QuestionExplorerOperation,
): string => {
  const code = backendErrorCode(cause);

  if (code === "UNAUTHENTICATED" || code === "REAUTH_REQUIRED") {
    return "Google 계정 연결이 만료되었습니다. 다시 연결해주세요.";
  }
  if (code === "PERMISSION_DENIED") {
    return "이 작업에 필요한 권한이 없습니다.";
  }
  if (code === "NOT_FOUND") {
    return "필요한 정보를 찾지 못했습니다. 프로젝트를 다시 열어주세요.";
  }
  if (code === "GOOGLE_API_ERROR") {
    return "Google Forms 정보를 가져오지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해주세요.";
  }
  if (code === "RATE_LIMITED") {
    return "요청이 많습니다. 잠시 후 다시 시도해주세요.";
  }
  if (code === "JOB_CANCELLED") {
    return "작업이 취소되었습니다.";
  }

  return OPERATION_FALLBACK[operation];
};
