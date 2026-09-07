import { BackendErrorCodeSchema, type BackendErrorCode } from "@survey-synth/contracts";

const backendErrorCode = (cause: unknown): BackendErrorCode | null => {
  if (typeof cause !== "object" || cause === null) return null;
  const backendError = Reflect.get(cause, "backendError");
  if (typeof backendError !== "object" || backendError === null) return null;
  const parsed = BackendErrorCodeSchema.safeParse(Reflect.get(backendError, "code"));
  return parsed.success ? parsed.data : null;
};

export const userFacingErrorMessage = (cause: unknown, fallback: string): string => {
  const code = backendErrorCode(cause);

  if (code === "UNAUTHENTICATED" || code === "REAUTH_REQUIRED") {
    return "Google 계정 연결이 만료되었습니다. 다시 연결해주세요.";
  }
  if (code === "PERMISSION_DENIED") {
    return "이 작업에 필요한 권한이 없습니다.";
  }
  if (code === "NOT_FOUND") {
    return "필요한 정보를 찾지 못했습니다. 다시 열거나 새로고침한 뒤 시도해주세요.";
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

  return fallback;
};
