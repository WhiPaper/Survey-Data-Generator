import { describe, expect, it } from "vitest";

import type { GoogleAccountView } from "@survey-synth/contracts";

import { accountSettingsRows } from "../src/accountSettings";

const account = (id: string, email: string, displayName?: string): GoogleAccountView => ({
  id,
  email,
  ...(displayName === undefined ? {} : { displayName }),
});

describe("account settings rows", () => {
  it("preserves backend account order and marks the active account", () => {
    const rows = accountSettingsRows(
      [account("second", "second@example.com"), account("first", "first@example.com")],
      "first",
    );

    expect(rows.map((row) => row.id)).toEqual(["second", "first"]);
    expect(rows.map((row) => row.current)).toEqual([false, true]);
  });

  it("uses display metadata without hiding the Google email", () => {
    const [named, unnamed] = accountSettingsRows(
      [
        account("named", "named@example.com", "  Research Team  "),
        account("plain", "plain@example.com"),
      ],
      null,
    );

    expect(named).toMatchObject({
      primaryLabel: "Research Team",
      secondaryLabel: "named@example.com",
    });
    expect(unnamed).toMatchObject({ primaryLabel: "plain@example.com", secondaryLabel: null });
  });
});
