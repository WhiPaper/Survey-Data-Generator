import type { ProjectSummaryView } from "@survey-synth/contracts";

export const recentProjectChoices = (
  projects: readonly ProjectSummaryView[],
  currentProjectId: string | null,
  limit = 5,
): ProjectSummaryView[] =>
  projects.filter((project) => project.id !== currentProjectId).slice(0, Math.max(0, limit));

export const filterProjectChoices = (
  projects: readonly ProjectSummaryView[],
  query: string,
): ProjectSummaryView[] => {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return [...projects];
  return projects.filter((project) => project.name.toLocaleLowerCase().includes(normalized));
};

export const promoteProjectChoice = (
  projects: readonly ProjectSummaryView[],
  projectId: string,
): ProjectSummaryView[] => {
  const project = projects.find((candidate) => candidate.id === projectId);
  return project
    ? [project, ...projects.filter((candidate) => candidate.id !== projectId)]
    : [...projects];
};
