import { describe, expect, it } from "vitest";

import { parseRpcResult } from "../src/index.js";

describe("Google account list connection state", () => {
  it("accepts backend-owned connection state on auth.accounts", () => {
    expect(
      parseRpcResult("auth.accounts", [
        { id: "account-1", email: "user@example.com", connected: false },
      ]),
    ).toEqual([{ id: "account-1", email: "user@example.com", connected: false }]);
  });

  it("rejects account-list items that omit connection state", () => {
    expect(() =>
      parseRpcResult("auth.accounts", [{ id: "account-1", email: "user@example.com" }]),
    ).toThrow();
  });

  it("keeps session account identity free of list-only connection metadata", () => {
    expect(
      parseRpcResult("session.get", { account: { id: "account-1", email: "user@example.com" } }),
    ).toEqual({ account: { id: "account-1", email: "user@example.com" } });
  });
});
