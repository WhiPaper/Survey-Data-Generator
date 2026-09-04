import type { GoogleAccountId } from "@survey-synth/contracts";

export const sessionQueryKey = ["session.get"] as const;
export const accountsQueryKey = (accountId: GoogleAccountId | null) =>
  ["auth.accounts", accountId] as const;
export const formsQueryKey = (accountId: GoogleAccountId | null, query: string) =>
  ["forms.list", accountId, query] as const;
export const projectsQueryKey = ["projects.list"] as const;
