export const MAX_PROJECT_NAME_LENGTH = 120;

export const normalizeProjectName = (value: string): string => value.trim();

export const projectNameValidationMessage = (value: string): string | null => {
  const normalized = normalizeProjectName(value);
  if (!normalized) return "프로젝트 이름을 입력해주세요.";
  if (normalized.length > MAX_PROJECT_NAME_LENGTH) {
    return `프로젝트 이름은 ${MAX_PROJECT_NAME_LENGTH}자 이하로 입력해주세요.`;
  }
  return null;
};
