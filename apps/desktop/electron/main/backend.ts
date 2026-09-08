import {
  parseRpcRequest,
  type FormsImportCancelParams,
  type FormsImportParams,
  type FormsListParams,
  type GoogleAccountId,
  type ProjectSourceRefreshParams,
  type RunsExportParams,
  type SourceScope,
  type SynthesisResolveEditPlanParams,
  type SynthesisStartParams,
  type TargetDraft,
} from "@survey-synth/contracts";

import type { GoogleAuthService } from "./auth/service";
import { backendFailure } from "./errors";
import type { RunExportService } from "./export/service";
import type { FormsService } from "./forms/service";
import type { ProjectService } from "./projects/service";
import type { SynthesisService } from "./synthesis/service";
import type { TargetService } from "./targets/service";
import { semanticDuplicateTargetIssues } from "./targets/semantic-key";
import type { ValueGroupService } from "./value-groups/service";

export type RunExportDestinationPicker = (params: RunsExportParams) => Promise<string | null>;

export type BackendServices = {
  auth?: GoogleAuthService;
  forms?: FormsService;
  projects?: ProjectService;
  valueGroups?: ValueGroupService;
  targets?: TargetService;
  synthesis?: SynthesisService;
  runExports?: RunExportService;
  pickRunExportDestination?: RunExportDestinationPicker;
};

const requireAuth = (services: BackendServices): GoogleAuthService => {
  if (!services.auth)
    throw backendFailure("BACKEND_UNAVAILABLE", "Google authentication is not initialized");
  return services.auth;
};
const requireForms = (services: BackendServices): FormsService => {
  if (!services.forms)
    throw backendFailure("BACKEND_UNAVAILABLE", "Google Forms is not initialized");
  return services.forms;
};
const requireProjects = (services: BackendServices): ProjectService => {
  if (!services.projects)
    throw backendFailure("BACKEND_UNAVAILABLE", "Projects are not initialized");
  return services.projects;
};
const requireValueGroups = (services: BackendServices): ValueGroupService => {
  if (!services.valueGroups)
    throw backendFailure("BACKEND_UNAVAILABLE", "Value groups are not initialized");
  return services.valueGroups;
};
const requireTargets = (services: BackendServices): TargetService => {
  if (!services.targets)
    throw backendFailure("BACKEND_UNAVAILABLE", "Target service is not initialized");
  return services.targets;
};
const requireSynthesis = (services: BackendServices): SynthesisService => {
  if (!services.synthesis)
    throw backendFailure("BACKEND_UNAVAILABLE", "Synthesis engine is not initialized");
  return services.synthesis;
};
const requireRunExports = (services: BackendServices): RunExportService => {
  if (!services.runExports)
    throw backendFailure("BACKEND_UNAVAILABLE", "Run export is not initialized");
  return services.runExports;
};
const requireRunExportDestinationPicker = (
  services: BackendServices,
): RunExportDestinationPicker => {
  if (!services.pickRunExportDestination)
    throw backendFailure("BACKEND_UNAVAILABLE", "Run export dialog is not initialized");
  return services.pickRunExportDestination;
};

const sourceReviewForProject = async (services: BackendServices, projectId: string) => {
  const source = await requireProjects(services).sourceReview(projectId);
  const targetService = requireTargets(services);
  const draft = await targetService.getDraft(projectId);
  const targetIssues = draft
    ? [
        ...semanticDuplicateTargetIssues(draft.targets),
        ...(await targetService.validate(draft)).issues,
      ]
    : [];
  return {
    projectId,
    sourceRevisionId: source.sourceRevisionId,
    invalidValueGroupIds: source.invalidValueGroupIds,
    targetIssues,
  };
};

export const handleBackendCall = async (
  serializedRequest: string,
  services: BackendServices = {},
): Promise<unknown> => {
  const request = parseRpcRequest(JSON.parse(serializedRequest) as unknown);

  switch (request.method) {
    case "system.ping":
      return { ok: true, message: "pong" };
    case "session.get":
      return services.auth ? services.auth.getSession() : null;
    case "auth.login":
      return requireAuth(services).login();
    case "auth.accounts":
      return requireAuth(services).getAccounts();
    case "auth.addAccount":
      return requireAuth(services).addAccount();
    case "auth.switchAccount":
      return requireAuth(services).switchAccount((request.params as { id: GoogleAccountId }).id);
    case "auth.logout":
      await requireAuth(services).logout();
      return { ok: true };
    case "auth.revokeAccess":
      await requireAuth(services).revokeAccess((request.params as { id: GoogleAccountId }).id);
      return { ok: true };
    case "auth.deleteAccountData":
      await requireAuth(services).deleteAccountData((request.params as { id: GoogleAccountId }).id);
      return { ok: true };
    case "forms.list":
      return requireForms(services).listForms(request.params as FormsListParams);
    case "forms.import":
      return requireForms(services).importForm(request.params as FormsImportParams);
    case "forms.import.cancel":
      requireForms(services).cancelImport((request.params as FormsImportCancelParams).operationId);
      return { ok: true };
    case "projects.list":
      return requireProjects(services).list();
    case "projects.get":
      return requireProjects(services).get((request.params as { projectId: string }).projectId);
    case "projects.open":
      return requireProjects(services).open((request.params as { projectId: string }).projectId);
    case "projects.sourceReview":
      return sourceReviewForProject(services, (request.params as { projectId: string }).projectId);
    case "projects.refreshSource": {
      const params = request.params as ProjectSourceRefreshParams;
      const refreshed = await requireForms(services).refreshProjectSource(params);
      const project = await requireProjects(services).get(params.projectId);
      if (!project) throw backendFailure("INTERNAL", "Refreshed project could not be reloaded");
      const review = await sourceReviewForProject(services, params.projectId);

      return {
        project,
        previousSourceRevisionId: refreshed.previousSourceRevisionId,
        sourceRevisionId: review.sourceRevisionId,
        invalidValueGroupIds: review.invalidValueGroupIds,
        targetIssues: review.targetIssues,
      };
    }
    case "projects.delete":
      await requireProjects(services).delete((request.params as { projectId: string }).projectId);
      return { ok: true };
    case "valueGroups.list":
      return requireValueGroups(services).list((request.params as { projectId: string }).projectId);
    case "valueGroups.values": {
      const params = request.params as { projectId: string; questionId: string };
      return requireValueGroups(services).values(params.projectId, params.questionId);
    }
    case "valueGroups.create":
      return requireValueGroups(services).create(
        request.params as {
          projectId: string;
          questionId: string;
          name: string;
          members: string[];
        },
      );
    case "valueGroups.delete":
      await requireValueGroups(services).delete(
        (request.params as { valueGroupId: string }).valueGroupId,
      );
      return { ok: true };
    case "targets.profile": {
      const params = request.params as {
        projectId: string;
        sourceScope?: SourceScope;
        scoreMappings?: import("@survey-synth/contracts").LikertScoreMapping[];
      };
      return requireTargets(services).profile(
        params.projectId,
        params.sourceScope,
        params.scoreMappings,
      );
    }
    case "targets.validate": {
      const params = request.params as TargetDraft;
      const result = await requireTargets(services).validate(params);
      return {
        issues: [...semanticDuplicateTargetIssues(params.targets), ...result.issues],
      };
    }
    case "targets.draft.get":
      return requireTargets(services).getDraft((request.params as { projectId: string }).projectId);
    case "targets.draft.save":
      return requireTargets(services).saveDraft(request.params as TargetDraft);
    case "targets.draft.start": {
      const params = request.params as { projectId: string; operationId?: string };
      const targetService = requireTargets(services);
      const draft = await targetService.getDraft(params.projectId);
      if (draft) {
        const issues = semanticDuplicateTargetIssues(draft.targets);
        if (issues.length > 0) return { status: "infeasible", issues };
      }
      return targetService.startDraft(params.projectId, params.operationId);
    }
    case "synthesis.start": {
      const params = request.params as SynthesisStartParams;
      const issues = semanticDuplicateTargetIssues(params.targets);
      if (issues.length > 0) return { status: "infeasible", issues };
      return requireSynthesis(services).start(params);
    }
    case "synthesis.resolveEditPlan":
      return requireSynthesis(services).resolveEditPlan(
        request.params as SynthesisResolveEditPlanParams,
      );
    case "synthesis.cancel":
      requireSynthesis(services).cancel((request.params as { operationId: string }).operationId);
      return { ok: true };
    case "runs.list": {
      const synthesis = requireSynthesis(services);
      if (!synthesis.listRuns) {
        throw backendFailure("BACKEND_UNAVAILABLE", "Run listing is not initialized");
      }
      return synthesis.listRuns((request.params as { projectId: string }).projectId);
    }
    case "runs.get": {
      const run = await requireSynthesis(services).getRun(
        (request.params as { runId: string }).runId,
      );
      const presentations = await requireProjects(services).runTargetPresentations(
        run.projectId,
        run.sourceRevisionId,
        run.targetSnapshot.targets,
      );
      return { ...run, presentations };
    }
    case "runs.export": {
      const params = request.params as RunsExportParams;
      const destination = await requireRunExportDestinationPicker(services)(params);
      if (destination === null) return { status: "cancelled" };
      await requireRunExports(services).exportTo(params.runId, params.format, destination);
      return { status: "saved" };
    }
  }
};
