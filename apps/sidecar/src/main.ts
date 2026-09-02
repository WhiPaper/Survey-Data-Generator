import { join } from "node:path";

import {
  AuthRevokeAccessParamsSchema,
  AuthSwitchAccountParamsSchema,
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
    await oauth.close();
    process.stdin.pause();
    await new Promise<void>((resolve) => process.stdout.end(resolve));
    process.exit(0);
  },
  handlers: {
    "session.get": () => auth.getSession(),
    "auth.login": () => auth.login(),
    "auth.accounts": () => auth.getAccounts(),
    "auth.addAccount": () => auth.addAccount(),
    "auth.switchAccount": (params) =>
      auth.switchAccount(AuthSwitchAccountParamsSchema.parse(params).id),
    "auth.logout": async () => {
      await auth.logout();
      return authActionResult();
    },
    "auth.revokeAccess": async (params) => {
      await auth.revokeAccess(AuthRevokeAccessParamsSchema.parse(params).id);
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
