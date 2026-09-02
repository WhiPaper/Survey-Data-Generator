import { useEffect, useState } from "react";

import type { GoogleAccountId, GoogleAccountView, SessionView } from "@survey-synth/contracts";

import {
  BackendClientError,
  addAccount,
  getAccounts,
  getSession,
  login,
  logout,
  revokeAccess,
  switchAccount,
} from "./api/backend";

type AuthState =
  | { status: "loading" }
  | { status: "signed_out"; error?: string }
  | { status: "signed_in"; session: SessionView; accounts: GoogleAccountView[]; error?: string };

type BusyAction = "login" | "add_account" | "switch_account" | "logout" | "revoke" | null;
type SignedInState = Extract<AuthState, { status: "signed_in" }>;

const errorMessage = (error: unknown): string => {
  if (error instanceof BackendClientError) return error.backendError.message;
  return "Backend unavailable";
};

const withActiveAccount = (
  accounts: readonly GoogleAccountView[],
  active: GoogleAccountView,
): GoogleAccountView[] => {
  const existing = accounts.findIndex((account) => account.id === active.id);
  if (existing === -1) return [...accounts, active];
  return accounts.map((account, index) => (index === existing ? active : account));
};

const signedInState = async (
  session: SessionView,
  fallbackAccounts: readonly GoogleAccountView[],
): Promise<SignedInState> => {
  try {
    return { status: "signed_in", session, accounts: await getAccounts() };
  } catch (error: unknown) {
    return {
      status: "signed_in",
      session,
      accounts: withActiveAccount(fallbackAccounts, session.account),
      error: errorMessage(error),
    };
  }
};

export function App() {
  const [auth, setAuth] = useState<AuthState>({ status: "loading" });
  const [busy, setBusy] = useState<BusyAction>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const session = await getSession();
        if (!active) return;
        if (session === null) {
          setAuth({ status: "signed_out" });
          return;
        }
        const nextAuth = await signedInState(session, []);
        if (active) setAuth(nextAuth);
      } catch (error: unknown) {
        if (active) setAuth({ status: "signed_out", error: errorMessage(error) });
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const handleLogin = async (): Promise<void> => {
    setBusy("login");
    try {
      const session = await login();
      setAuth(await signedInState(session, []));
    } catch (error: unknown) {
      setAuth({ status: "signed_out", error: errorMessage(error) });
    } finally {
      setBusy(null);
    }
  };

  const handleAddAccount = async (): Promise<void> => {
    if (auth.status !== "signed_in") return;
    const previous = auth;
    setBusy("add_account");
    try {
      const session = await addAccount();
      setAuth(await signedInState(session, previous.accounts));
    } catch (error: unknown) {
      setAuth({ ...previous, error: errorMessage(error) });
    } finally {
      setBusy(null);
    }
  };

  const handleSwitchAccount = async (id: GoogleAccountId): Promise<void> => {
    if (auth.status !== "signed_in") return;
    const previous = auth;
    setBusy("switch_account");
    try {
      const session = await switchAccount(id);
      setAuth(await signedInState(session, previous.accounts));
    } catch (error: unknown) {
      setAuth({ ...previous, error: errorMessage(error) });
    } finally {
      setBusy(null);
    }
  };

  const handleLogout = async (): Promise<void> => {
    setBusy("logout");
    try {
      await logout();
      setAuth({ status: "signed_out" });
    } catch (error: unknown) {
      if (auth.status === "signed_in") setAuth({ ...auth, error: errorMessage(error) });
    } finally {
      setBusy(null);
    }
  };

  const handleRevoke = async (): Promise<void> => {
    if (auth.status !== "signed_in") return;
    if (!window.confirm("Google 접근 권한을 해제하시겠습니까?")) return;
    const previous = auth;
    setBusy("revoke");
    try {
      await revokeAccess(auth.session.account.id);
      setAuth({ status: "signed_out" });
    } catch (error: unknown) {
      setAuth({ ...previous, error: errorMessage(error) });
    } finally {
      setBusy(null);
    }
  };

  if (auth.status === "loading") {
    return (
      <main>
        <h1>Survey Synth</h1>
        <p>Loading…</p>
      </main>
    );
  }

  if (auth.status === "signed_out") {
    return (
      <main>
        <h1>Survey Synth</h1>
        <button type="button" onClick={() => void handleLogin()} disabled={busy !== null}>
          {busy === "login" ? "Google 로그인 중…" : "Google로 계속하기"}
        </button>
        {auth.error !== undefined && <p role="alert">{auth.error}</p>}
      </main>
    );
  }

  return (
    <main>
      <h1>Survey Synth</h1>
      <p>{auth.session.account.email}</p>
      <details>
        <summary>계정 메뉴</summary>
        <div className="account-menu">
          <p>저장된 Google 계정</p>
          <ul>
            {auth.accounts.map((account) => (
              <li key={account.id}>
                <button
                  type="button"
                  onClick={() => void handleSwitchAccount(account.id)}
                  disabled={busy !== null || account.id === auth.session.account.id}
                >
                  {account.email}
                </button>
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => void handleAddAccount()} disabled={busy !== null}>
            {busy === "add_account" ? "Google 계정 추가 중…" : "Google 계정 추가"}
          </button>
          <button type="button" onClick={() => void handleLogout()} disabled={busy !== null}>
            로그아웃
          </button>
          <button type="button" onClick={() => void handleRevoke()} disabled={busy !== null}>
            Google 접근 권한 해제
          </button>
        </div>
      </details>
      {auth.error !== undefined && <p role="alert">{auth.error}</p>}
    </main>
  );
}
