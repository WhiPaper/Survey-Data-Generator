import { useCallback, useEffect, useState } from "react";

export type WorkspaceView = "home" | "survey" | "targets" | "results";

export type WorkspaceRoute = {
  readonly projectId: string | null;
  readonly view: WorkspaceView;
  readonly questionId: string | null;
  readonly runId: string | null;
};

const decodePart = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

export const parseWorkspaceRoute = (pathname: string): WorkspaceRoute => {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "projects" || parts[1] === undefined)
    return { projectId: null, view: "home", questionId: null, runId: null };
  const projectId = decodePart(parts[1]);
  if (parts[2] === "runs" && parts[3] !== undefined)
    return { projectId, view: "results", questionId: null, runId: decodePart(parts[3]) };
  if (parts[2] === "survey" && parts[3] !== undefined)
    return { projectId, view: "survey", questionId: decodePart(parts[3]), runId: null };
  if (parts[2] === "targets") return { projectId, view: "targets", questionId: null, runId: null };
  return { projectId, view: "home", questionId: null, runId: null };
};

export const workspaceRoutePath = (route: WorkspaceRoute): string => {
  if (route.projectId === null) return "/projects";
  const project = encodeURIComponent(route.projectId);
  if (route.view === "results" && route.runId !== null)
    return `/projects/${project}/runs/${encodeURIComponent(route.runId)}`;
  if (route.view === "survey" && route.questionId !== null)
    return `/projects/${project}/survey/${encodeURIComponent(route.questionId)}`;
  if (route.view === "targets") return `/projects/${project}/targets`;
  return `/projects/${project}`;
};

export function useWorkspaceRoute() {
  const [route, setRoute] = useState<WorkspaceRoute>(() =>
    parseWorkspaceRoute(window.location.pathname),
  );

  useEffect(() => {
    const handlePopState = () => setRoute(parseWorkspaceRoute(window.location.pathname));
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const navigate = useCallback((next: WorkspaceRoute) => {
    const nextPath = workspaceRoutePath(next);
    if (window.location.pathname === nextPath) return;
    window.history.pushState({}, "", nextPath);
    setRoute(next);
  }, []);

  return { route, navigate } as const;
}
