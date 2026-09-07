import { userFacingErrorMessage } from "../userFacingError";

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

export const questionExplorerErrorMessage = (
  cause: unknown,
  operation: QuestionExplorerOperation,
): string => userFacingErrorMessage(cause, OPERATION_FALLBACK[operation]);
