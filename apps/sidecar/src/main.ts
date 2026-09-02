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
} from "@survey-synth/contracts";

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

const server = createSidecarServer({
  input: process.stdin,
  output: process.stdout,
  logger: stderrLogger,
  onShutdown: async () => {
    for (const controller of activeImportControllers.values()) controller.abort();
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
          if (session !== null && repository !== null)
            repository.createFromImport(session.accountId, session.form, session.responses);
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
