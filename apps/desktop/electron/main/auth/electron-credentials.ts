import { safeStorage } from "electron";

import { FileRefreshTokenStore, type RefreshTokenStore, type SecretCodec } from "./credentials";

const electronSecretCodec: SecretCodec = {
  isAvailable: () =>
    safeStorage.isEncryptionAvailable() &&
    (process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text"),
  encrypt: (value) => safeStorage.encryptString(value),
  decrypt: (value) => safeStorage.decryptString(value),
};

export const createElectronRefreshTokenStore = (filename: string): RefreshTokenStore =>
  new FileRefreshTokenStore(filename, electronSecretCodec);
