import { join } from "node:path";
import { randomUUID } from "node:crypto";

import {
  AuthRevokeAccessParamsSchema,
  AuthSwitchAccountParamsSchema,
  FormsImportCancelParamsSchema,
  FormsImportParamsSchema,
  FormsListParamsSchema,
  ProjectsDeleteParamsSchema,
  ProjectsGetParamsSchema,
  ProjectsRefreshSourceCancelParamsSchema,
  ProjectsRefreshSourceParamsSchema,
  ProjectsResolveMigrationIssueParamsSchema,
  TargetsGetParamsSchema,
  TargetsUpdateParamsSchema,
  TargetsCheckFeasibilityParamsSchema,
  RunsGetParamsSchema,
  RunsExportParamsSchema,
  SynthesisCancelParamsSchema,
  SynthesisStartParamsSchema,
} from "@survey-synth/contracts";
import { checkFeasibility } from "@survey-synth/synthesis-core";

import {
  FileGoogleAccountRepository,
  MemoryGoogleAccountRepository,
} from "./auth/account-store.js";
import { loadGoogleOAuthConfig } from "./auth/config.js";
import { GoogleHttpClient } from "./auth/google.js";
import { BrowserGoogleOAuthFlow } from "./auth/oauth.js";
import { authActionResult, GoogleAuthServiceImpl } from "./auth/service.js";
import { InMemoryGoogleAccessTokenProvider } from "./auth/tokens.js";
import { GoogleFormsApiClient } from "./forms/client.js";
import { FormImportService } from "./forms/service.js";
import {
  createHostCapabilityClient,
  RemoteGoogleTokenStore,
  RemoteSecureSecretStore,
} from "./host.js";
import { stderrLogger } from "./rpc/logger.js";
import { createSidecarServer } from "./rpc/server.js";
import { ProjectDatabase, ProjectRepository, defaultDatabasePath } from "./persistence/index.js";
import { SynthesisJobs } from "./application/synthesis-jobs.js";
import { RefreshService } from "./application/refresh-service.js";
import { ExportService } from "./export/index.js";
import { sidecarError } from "./errors.js";

const hostClient = createHostCapabilityClient(process.stdout);
const accountStatePath = process.env.SURVEY_SYNTH_ACCOUNT_STORE_PATH;
const appDataDirectory = process.env.SURVEY_SYNTH_APP_DATA_DIR;
const accounts =
  accountStatePath !== undefined
    ? new FileGoogleAccountRepository(accountStatePath)
    : appDataDirectory !== undefined
      ? new FileGoogleAccountRepository(join(appDataDirectory, "google-accounts.json"))
      : new MemoryGoogleAccountRepository();
const tokenStore = new RemoteGoogleTokenStore(new RemoteSecureSecretStore(hostClient));
const getConfig = loadGoogleOAuthConfig;
const google = new GoogleHttpClient({ getConfig });
const accessTokens = new InMemoryGoogleAccessTokenProvider(accounts, tokenStore, google);
const oauth = new BrowserGoogleOAuthFlow({ host: hostClient, getConfig });
const formsApi = new GoogleFormsApiClient({ accessTokens });
const forms = new FormImportService({ accounts, google: formsApi, logger: stderrLogger });
const activeImportControllers = new Map<string, AbortController>();
const auth = new GoogleAuthServiceImpl({
  accounts,
  accessTokens,
  google,
  logger: stderrLogger,
  oauth,
  tokenStore,
});
let database: Promise<ProjectDatabase | null> = Promise.resolve(null);
let projects: Promise<ProjectRepository | null> = Promise.resolve(null);
let synthesisJobs: Promise<SynthesisJobs | null> = Promise.resolve(null);
let refreshService: Promise<RefreshService | null> = Promise.resolve(null);
let exportService: Promise<ExportService | null> = Promise.resolve(null);

const server = createSidecarServer({
  input: process.stdin,
  output: process.stdout,
  logger: stderrLogger,
  onShutdown: async () => {
    for (const controller of activeImportControllers.values()) controller.abort();
    (await synthesisJobs)?.shutdown();
    forms.cancelImports();
    await oauth.close();
    try {
      (await database)?.close();
    } catch {
      // Startup failure is already reported through the controlled shutdown path.
    }
    process.stdin.pause();
    await new Promise<void>((resolve) => process.stdout.end(resolve));
    process.exit(0);
  },
  handlers: {
    "projects.list": async () => (await projects)?.list() ?? [],
    "projects.get": async (params) =>
      (await projects)?.get(ProjectsGetParamsSchema.parse(params).projectId as never) ?? null,
    "projects.delete": async (params) => {
      (await projects)?.delete(ProjectsDeleteParamsSchema.parse(params).projectId as never);
      return authActionResult();
    },
    "projects.refreshSource": async (params) => {
      const input = ProjectsRefreshSourceParamsSchema.parse(params);
      const service = await refreshService;
      if (service === null) throw new Error("Refresh service unavailable");
      return service.refreshSource(input);
    },
    "projects.refreshSource.cancel": async (params) => {
      const input = ProjectsRefreshSourceCancelParamsSchema.parse(params);
      const service = await refreshService;
      if (service) service.cancel(input.operationId);
      return authActionResult();
    },
    "projects.resolveMigrationIssue": async (params) => {
      const input = ProjectsResolveMigrationIssueParamsSchema.parse(params);
      const repository = await projects;
      if (repository === null) throw new Error("Project database unavailable");
      repository.resolveMigrationIssue(input.projectId as never, input.issueId);
      return authActionResult();
    },
    "targets.get": async (params) => {
      const input = TargetsGetParamsSchema.parse(params);
      const repository = await projects;
      if (repository === null) throw new Error("Project database unavailable");
      return repository.getTargets(input.projectId as never);
    },
    "targets.update": async (params) => {
      const input = TargetsUpdateParamsSchema.parse(params);
      const repository = await projects;
      if (repository === null) throw new Error("Project database unavailable");
      return repository.updateTargets(
        input.projectId as never,
        input.expectedRevision,
        input.targets as never,
      );
    },
    "targets.checkFeasibility": async (params) => {
      const input = TargetsCheckFeasibilityParamsSchema.parse(params);
      const repository = await projects;
      if (repository === null) throw new Error("Project database unavailable");
      const migrationIssues = repository.getMigrationIssues(input.projectId as never);
      const blockingIssues = migrationIssues.filter((i) => i.severity === "blocking");
      if (blockingIssues.length > 0) {
        return {
          status: "infeasible",
          issues: blockingIssues.map((i) => ({ code: i.code, message: i.message })),
        };
      }
      const source = repository.loadSynthesisSource(input.projectId as never);
      if (source === null)
        throw sidecarError("NOT_FOUND", "Project source revision is unavailable", true);
      const report = checkFeasibility(source.form, source.responses, input.targets as never);
      return {
        status: report.status,
        issues: report.issues.map((issue) => ({ code: issue.code, message: issue.message })),
      };
    },
    "runs.get": async (params) => {
      const input = RunsGetParamsSchema.parse(params);
      const repository = await projects;
      if (repository === null) throw new Error("Project database unavailable");
      const run = repository.getRun(input.runId as never);
      if (run === null) throw sidecarError("NOT_FOUND", "Run was not found", true);
      return run;
    },
    "runs.export": async (params) => {
      const input = RunsExportParamsSchema.parse(params);
      const service = await exportService;
      if (service === null)
        throw sidecarError("BACKEND_UNAVAILABLE", "Project database unavailable", true);
      return service.export(input);
    },
    "synthesis.start": async (params) => {
      const input = SynthesisStartParamsSchema.parse(params);
      const repository = await projects;
      if (repository === null) throw new Error("Project database unavailable");
      const migrationIssues = repository.getMigrationIssues(input.projectId as never);
      const blockingIssues = migrationIssues.filter((i) => i.severity === "blocking");
      if (blockingIssues.length > 0) {
        return {
          status: "infeasible" as const,
          issues: blockingIssues.map((i) => ({ code: i.code, message: i.message })),
        };
      }
      const targetState = repository.getTargets(input.projectId as never);
      if (input.targetRevision !== undefined && input.targetRevision !== targetState.revision)
        throw sidecarError(
          "TARGET_CONFLICT",
          "Target revision changed before synthesis started",
          true,
        );
      const source = repository?.loadSynthesisSource(input.projectId as never) ?? null;
      if (source === null)
        return {
          status: "infeasible" as const,
          issues: [
            { code: "PROJECT_NOT_FOUND", message: "Project source revision is unavailable" },
          ],
        };
      const outcome = await (await synthesisJobs)!.run(
        input.operationId ?? randomUUID(),
        input.projectId,
        source,
        targetState.targets,
        input.seed,
        targetState.revision,
      );
      return "issues" in outcome
        ? { status: outcome.status, issues: outcome.issues }
        : {
            status: "success" as const,
            runId: outcome.runId,
            syntheticResponseCount: outcome.syntheticResponseCount,
            finalResponseCount: outcome.finalResponseCount,
          };
    },
    "synthesis.cancel": (params) => {
      void synthesisJobs.then((jobs) =>
        jobs?.cancel(SynthesisCancelParamsSchema.parse(params).operationId),
      );
      return authActionResult();
    },
    "session.get": () => auth.getSession(),
    "auth.login": async () => {
      forms.cancelImports();
      forms.clearStoredImport();
      return auth.login();
    },
    "auth.accounts": () => auth.getAccounts(),
    "auth.addAccount": async () => {
      forms.cancelImports();
      forms.clearStoredImport();
      return auth.addAccount();
    },
    "auth.switchAccount": async (params) => {
      forms.cancelImports();
      const session = await auth.switchAccount(AuthSwitchAccountParamsSchema.parse(params).id);
      forms.clearStoredImport();
      return session;
    },
    "auth.logout": async () => {
      forms.cancelImports();
      await auth.logout();
      forms.clearStoredImport();
      return authActionResult();
    },
    "auth.revokeAccess": async (params) => {
      forms.cancelImports();
      await auth.revokeAccess(AuthRevokeAccessParamsSchema.parse(params).id);
      forms.clearStoredImport();
      return authActionResult();
    },
    "forms.list": (params) => forms.listForms(FormsListParamsSchema.parse(params)),
    "forms.import": async (params) => {
      const parsed = FormsImportParamsSchema.parse(params);
      const operationId = parsed.operationId ?? randomUUID();
      const controller = new AbortController();
      activeImportControllers.set(operationId, controller);
      try {
        const summary = await forms.importForm(parsed.formId, controller.signal);
        const session = forms.getImport(summary.importId);
        try {
          const repository = await projects;
          if (session !== null && repository !== null) {
            try {
              repository.createFromImport(session.accountId, session.form, session.responses);
            } catch {
              stderrLogger.error("project_import_persistence_failed", {
                errorCode: "PROJECT_PERSISTENCE_FAILED",
              });
              throw sidecarError(
                "BACKEND_UNAVAILABLE",
                "프로젝트를 저장하지 못했습니다. 다시 시도해주세요.",
                true,
              );
            }
          }
        } finally {
          forms.clearStoredImport();
        }
        return summary;
      } finally {
        if (activeImportControllers.get(operationId) === controller) {
          activeImportControllers.delete(operationId);
        }
      }
    },
    "forms.import.cancel": (params) => {
      const { operationId } = FormsImportCancelParamsSchema.parse(params);
      activeImportControllers.get(operationId)?.abort();
      return authActionResult();
    },
  },
  hostClient,
});

const databasePath = defaultDatabasePath();
database =
  databasePath === null
    ? Promise.resolve(null)
    : ProjectDatabase.open(databasePath, new RemoteSecureSecretStore(hostClient));
projects = database.then((db) => (db === null ? null : new ProjectRepository(db)));
synthesisJobs = projects.then((repository) =>
  repository === null ? null : new SynthesisJobs(repository),
);
refreshService = projects.then((repository) =>
  repository === null
    ? null
    : new RefreshService({ projectRepository: repository, formImportService: forms }),
);
exportService = projects.then((repository) =>
  repository === null
    ? null
    : new ExportService({
        projects: repository,
        hostClient,
        logger: stderrLogger,
      }),
);
void database.catch(() => {
  stderrLogger.error("sidecar_startup_failed", { errorCode: "BACKEND_UNAVAILABLE" });
  server.shutdown();
});

const signalShutdown = (): void => {
  server.shutdown();
  process.exitCode = 0;
};

process.once("SIGINT", signalShutdown);
process.once("SIGTERM", signalShutdown);
