export type DestructiveConfirmationCopy = {
  title: string;
  description: string;
  actionLabel: string;
};

export const projectDeleteConfirmationCopy = (name: string): DestructiveConfirmationCopy => ({
  title: "프로젝트를 삭제할까요?",
  description: `“${name}”의 이 기기 데이터와 생성 결과가 삭제됩니다. Google Form 원본은 변경되지 않습니다.`,
  actionLabel: "프로젝트 삭제",
});

export const accountRevokeConfirmationCopy = (email: string): DestructiveConfirmationCopy => ({
  title: "Google 연결을 해제할까요?",
  description: `“${email}”의 Google 연결을 해제합니다. 이 기기의 프로젝트와 생성 결과는 삭제되지 않습니다.`,
  actionLabel: "연결 해제",
});
