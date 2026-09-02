import { join } from "node:path";
import { randomUUID } from "node:crypto";

import {
  AuthRevokeAccessParamsSchema,
  AuthSwitchAccountParamsSchema,
  FormsImportCancelParamsSchema,
  FormsImportParamsSchema,
  FormsListParamsSchema,
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

const server = createSidecarServer({
  input: process.stdin,
  output: process.stdout,
  logger: stderrLogger,
  onShutdown: async () => {
    for (const controller of activeImportControllers.values()) controller.abort();
    forms.cancelImports();
    await oauth.close();
    process.stdin.pause();
    await new Promise<void>((resolve) => process.stdout.end(resolve));
    process.exit(0);
  },
  handlers: {
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
        return await forms.importForm(parsed.formId, controller.signal);
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

const signalShutdown = (): void => {
  server.shutdown();
  process.exitCode = 0;
};

process.once("SIGINT", signalShutdown);
process.once("SIGTERM", signalShutdown);
