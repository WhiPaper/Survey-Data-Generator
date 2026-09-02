import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import type { GoogleAccountId } from "@survey-synth/contracts";

import { accountsQueryKey, formsQueryKey, sessionQueryKey } from "../src/App";

describe("desktop backend query keys", () => {
  it("keeps session, account, and form data in separate query domains", () => {
    const client = new QueryClient();
    const accountA = "account-a" as GoogleAccountId;
    const accountB = "account-b" as GoogleAccountId;

    client.setQueryData(sessionQueryKey, { account: { id: accountA, email: "a@example.com" } });
    client.setQueryData(accountsQueryKey(accountA), [{ id: accountA, email: "a@example.com" }]);
    client.setQueryData(formsQueryKey(accountA, "customer"), {
      pages: [{ items: [{ formId: "form-a", title: "A" }] }],
    });

    expect(client.getQueryData(sessionQueryKey)).toBeDefined();
    expect(client.getQueryData(accountsQueryKey(accountB))).toBeUndefined();
    expect(client.getQueryData(formsQueryKey(accountB, "customer"))).toBeUndefined();
    expect(client.getQueryData(formsQueryKey(accountA, "other"))).toBeUndefined();
  });

  it("does not let an older query result populate the current search state", async () => {
    const client = new QueryClient();
    const accountId = "account-a" as GoogleAccountId;
    let resolveOld!: (value: { items: string[] }) => void;
    const oldResult = new Promise<{ items: string[] }>((resolve) => {
      resolveOld = resolve;
    });

    const oldQuery = client.fetchQuery({
      queryKey: formsQueryKey(accountId, "old"),
      queryFn: () => oldResult,
      retry: false,
    });
    await client.fetchQuery({
      queryKey: formsQueryKey(accountId, "new"),
      queryFn: async () => ({ items: ["new"] }),
      retry: false,
    });
    expect(client.getQueryData(formsQueryKey(accountId, "new"))).toEqual({ items: ["new"] });

    resolveOld({ items: ["old"] });
    await oldQuery;
    expect(client.getQueryData(formsQueryKey(accountId, "new"))).toEqual({ items: ["new"] });
  });

  it("exposes pending and success states for an import mutation", async () => {
    const client = new QueryClient();
    const observer = new MutationObserver<string, Error, string>(client, {
      mutationFn: async (formId) => formId,
    });
    const statuses: string[] = [];
    const unsubscribe = observer.subscribe((result) => statuses.push(result.status));

    await observer.mutate("form-1");

    expect(statuses).toContain("pending");
    expect(observer.getCurrentResult()).toMatchObject({ status: "success", data: "form-1" });
    unsubscribe();
  });
});
