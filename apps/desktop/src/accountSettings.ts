import type { GoogleAccountId, GoogleAccountView } from "@survey-synth/contracts";

export type AccountSettingsRow = {
  id: GoogleAccountId;
  account: GoogleAccountView;
  primaryLabel: string;
  secondaryLabel: string | null;
  current: boolean;
};

export const accountSettingsRows = (
  accounts: GoogleAccountView[],
  currentAccountId: GoogleAccountId | null,
): AccountSettingsRow[] =>
  accounts.map((account) => {
    const displayName = account.displayName?.trim();
    return {
      id: account.id,
      account,
      primaryLabel: displayName || account.email,
      secondaryLabel: displayName ? account.email : null,
      current: account.id === currentAccountId,
    };
  });
