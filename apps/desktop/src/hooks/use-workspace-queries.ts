import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { GoogleAccountId } from "@survey-synth/contracts";

import { accountsQueryKey, formsQueryKey, projectsQueryKey } from "@/lib/query-keys";
import { getAccounts, getProject, getTargets, listForms, listProjects } from "../api/backend";

export function useWorkspaceQueries({
  activeAccountId,
  selectedProjectId,
  formQuery,
}: {
  readonly activeAccountId: GoogleAccountId | null;
  readonly selectedProjectId: string | null;
  readonly formQuery: string;
}) {
  const projectsQuery = useQuery({
    queryKey: projectsQueryKey,
    queryFn: () => listProjects(),
    retry: false,
  });
  const projectQuery = useQuery({
    queryKey: ["projects.get", selectedProjectId],
    queryFn: () => getProject(selectedProjectId ?? ""),
    enabled: selectedProjectId !== null,
    retry: false,
  });
  const targetsQuery = useQuery({
    queryKey: ["targets.get", selectedProjectId],
    queryFn: () => getTargets(selectedProjectId ?? ""),
    enabled: selectedProjectId !== null,
    retry: false,
  });
  const accountsQuery = useQuery({
    queryKey: accountsQueryKey(activeAccountId),
    queryFn: () => getAccounts(),
    enabled: activeAccountId !== null,
    retry: false,
  });
  const formsQuery = useInfiniteQuery({
    queryKey: formsQueryKey(activeAccountId, formQuery),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      listForms({
        ...(formQuery.length === 0 ? {} : { query: formQuery }),
        ...(pageParam === undefined ? {} : { cursor: pageParam }),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: activeAccountId !== null,
    retry: false,
  });

  return { projectsQuery, projectQuery, targetsQuery, accountsQuery, formsQuery } as const;
}
