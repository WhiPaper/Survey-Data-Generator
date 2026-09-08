import type { SourceScope } from "@survey-synth/contracts";

export const sourceScopesEqual = (left: SourceScope, right: SourceScope): boolean => {
  if (left.kind !== right.kind) return false;
  if (left.kind === "all" || right.kind === "all") return true;
  return left.start === right.start && left.end === right.end;
};

export const sourceScopeEditorError = (scope: SourceScope): string | null => {
  if (scope.kind === "all") return null;
  const startMs = Date.parse(scope.start);
  const endMs = Date.parse(scope.end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return "응답 기간을 확인해주세요.";
  if (startMs > endMs) return "시작 시각은 종료 시각보다 늦을 수 없습니다.";
  return null;
};
