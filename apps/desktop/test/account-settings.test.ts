import { describe, expect, it } from "vitest";

import type { GoogleAccountListItem } from "@survey-synth/contracts";

import { accountSettingsRows } from "../src/accountSettings";

const account = (
  id: string,
  email: string,
  connected = true,
  displayName?: string,
): GoogleAccountListItem => ({
  id,
  email,
  connected,
  ...(displayName === undefined ? {} : { displayName }),
});

describe("account settings rows", () => {
  it("preserves backend account order, connection state, and the active account", () => {
    const rows = accountSettingsRows(
      [
        account("second", "second@example.com", false),
        account("first", "first@example.com", true),
        account("third", "third@example.com", true),
      ],
      "first",
    );

    expect(rows.map((row) => row.id)).toEqual(["second", "first", "third"]);
    expect(rows.map((row) => row.connected)).toEqual([false, true, true]);
    expect(rows.map((row) => row.current)).toEqual([false, true, false]);
    expect(rows.map((row) => row.canSwitch)).toEqual([false, false, true]);
    expect(rows.map((row) => row.canRevoke)).toEqual([false, true, true]);
  });

  it("uses display metadata without hiding the Google email", () => {
    const [named, unnamed] = accountSettingsRows(
      [
        account("named", "named@example.com", true, "  Research Team  "),
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
