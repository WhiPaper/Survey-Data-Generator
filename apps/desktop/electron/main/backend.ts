import {
  parseRpcRequest,
  type FormsImportCancelParams,
  type FormsImportParams,
  type FormsListParams,
  type GoogleAccountId,
} from "@survey-synth/contracts";

import { backendFailure } from "./errors";
import type { GoogleAuthService } from "./auth/service";
import type { FormsService } from "./forms/service";

export type BackendServices = {
  auth?: GoogleAuthService;
  forms?: FormsService;
};

const requireAuth = (services: BackendServices): GoogleAuthService => {
  if (!services.auth) throw backendFailure("BACKEND_UNAVAILABLE", "Google authentication is not initialized");
  return services.auth;
};

const requireForms = (services: BackendServices): FormsService => {
  if (!services.forms) throw backendFailure("BACKEND_UNAVAILABLE", "Google Forms is not initialized");
  return services.forms;
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
    default:
      throw new Error(`Backend method is not implemented in the Electron v2 shell: ${request.method}`);
  }
};
