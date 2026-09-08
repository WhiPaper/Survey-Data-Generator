import { userFacingErrorMessage } from "./userFacingError";

export type AppShellOperation =
  | "startup"
  | "load_home"
  | "open_project"
  | "login"
  | "logout"
  | "load_accounts"
  | "add_account"
  | "switch_account"
  | "import_form"
  | "refresh_source"
  | "delete_project"
  | "cancel_import";

const OPERATION_FALLBACK: Record<AppShellOperation, string> = {
  startup: "앱을 시작하지 못했습니다. 다시 실행해주세요.",
  load_home: "Google Forms와 프로젝트를 불러오지 못했습니다.",
  open_project: "프로젝트를 열지 못했습니다.",
  login: "Google 계정에 연결하지 못했습니다.",
  logout: "로그아웃하지 못했습니다.",
  load_accounts: "Google 계정 목록을 불러오지 못했습니다.",
  add_account: "Google 계정을 추가하지 못했습니다.",
  switch_account: "Google 계정을 전환하지 못했습니다.",
  import_form: "Google Form을 가져오지 못했습니다.",
  refresh_source: "원본을 업데이트하지 못했습니다.",
  delete_project: "프로젝트를 삭제하지 못했습니다.",
  cancel_import: "가져오기를 취소하지 못했습니다.",
};

export const appShellErrorMessage = (cause: unknown, operation: AppShellOperation): string =>
  userFacingErrorMessage(cause, OPERATION_FALLBACK[operation]);
