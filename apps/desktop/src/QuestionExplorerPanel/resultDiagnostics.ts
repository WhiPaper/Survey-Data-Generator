import type { RunsGetResult, SourceScope } from "@survey-synth/contracts";

const datePart = (value: string): string => value.slice(0, 10);

export const resultSourceScopeLabel = (scope: SourceScope): string =>
  scope.kind === "all" ? "전체 응답" : `${datePart(scope.start)} ~ ${datePart(scope.end)}`;

export const resultDiagnosticsLines = (run: RunsGetResult): string[] => {
  const diagnostics = run.diagnostics;
  const replacement =
    diagnostics.replacementCount > 0 ? ` · 원본 대체 ${diagnostics.replacementCount}명` : "";
  const structure = diagnostics.structuralValidation === "passed" ? "완료" : "정보 없음";
  return [
    `생성 당시 범위 ${resultSourceScopeLabel(run.targetSnapshot.sourceScope)} · 원본 ${diagnostics.sourceResponseCount}명`,
    `새로 만든 응답 ${diagnostics.syntheticResponseCount}명${replacement} · 구조 확인 ${structure}`,
  ];
};
