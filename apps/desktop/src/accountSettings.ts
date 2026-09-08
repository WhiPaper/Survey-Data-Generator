import type { GoogleAccountId, GoogleAccountListItem } from "@survey-synth/contracts";

export type AccountSettingsRow = {
  id: GoogleAccountId;
  account: GoogleAccountListItem;
  primaryLabel: string;
  secondaryLabel: string | null;
  current: boolean;
  connected: boolean;
  canSwitch: boolean;
  canRevoke: boolean;
};

export const accountSettingsRows = (
  accounts: GoogleAccountListItem[],
  currentAccountId: GoogleAccountId | null,
): AccountSettingsRow[] =>
  accounts.map((account) => {
    const displayName = account.displayName?.trim();
    const current = account.id === currentAccountId;
    return {
      id: account.id,
      account,
      primaryLabel: displayName || account.email,
      secondaryLabel: displayName ? account.email : null,
      current,
      connected: account.connected,
      canSwitch: account.connected && !current,
      canRevoke: account.connected,
    };
  });
