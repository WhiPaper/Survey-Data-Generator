import { useEffect, useState } from "react";

import type { SessionView } from "@survey-synth/contracts";

import { getSession, login, logout, pingBackend } from "./api/backend";

type RuntimeState = "checking" | "ready" | "error";

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "요청을 처리하지 못했습니다.";

export function AppShell() {
  const [runtimeState, setRuntimeState] = useState<RuntimeState>("checking");
  const [message, setMessage] = useState("Electron Main 연결 확인 중…");
  const [session, setSession] = useState<SessionView | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    void pingBackend()
      .then(async (result) => {
        const restored = await getSession();
        if (!active) return;
        setSession(restored);
        setRuntimeState("ready");
        setMessage(result.message === "pong" ? "Electron Main 연결됨" : "Electron Main 응답 확인됨");
      })
      .catch((error: unknown) => {
        if (!active) return;
        setRuntimeState("error");
        setMessage(errorMessage(error));
      });

    return () => {
      active = false;
    };
  }, []);

  const handleLogin = async (): Promise<void> => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      setSession(await login());
    } catch (error: unknown) {
      setAuthError(errorMessage(error));
    } finally {
      setAuthBusy(false);
    }
  };

  const handleLogout = async (): Promise<void> => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      await logout();
      setSession(null);
    } catch (error: unknown) {
      setAuthError(errorMessage(error));
    } finally {
      setAuthBusy(false);
    }
  };

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 32,
        background: "var(--background)",
        color: "var(--foreground)",
      }}
    >
      <section style={{ width: "min(520px, 100%)" }}>
        <p style={{ margin: 0, fontSize: 14, opacity: 0.6 }}>Survey Synth v2</p>
        <h1 style={{ margin: "8px 0 12px", fontSize: 28, fontWeight: 600 }}>Desktop runtime</h1>
        <p style={{ margin: 0, fontSize: 15 }}>{message}</p>

        {runtimeState === "ready" && session === null ? (
          <div style={{ marginTop: 24 }}>
            <button type="button" disabled={authBusy} onClick={() => void handleLogin()}>
              {authBusy ? "Google 로그인 중…" : "Google로 로그인"}
            </button>
            <p style={{ marginTop: 12, fontSize: 13, opacity: 0.6 }}>
              로그인은 시스템 브라우저에서 진행되고 토큰은 Renderer에 전달되지 않습니다.
            </p>
          </div>
        ) : null}

        {runtimeState === "ready" && session !== null ? (
          <div style={{ marginTop: 24 }}>
            <p style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
              {session.account.displayName ?? session.account.email}
            </p>
            <p style={{ margin: "4px 0 12px", fontSize: 13, opacity: 0.65 }}>
              {session.account.email}
            </p>
            <button type="button" disabled={authBusy} onClick={() => void handleLogout()}>
              로그아웃
            </button>
            <p style={{ marginTop: 16, fontSize: 13, opacity: 0.6 }}>
              계정 연결 완료. 다음 단계에서 Google Forms 목록과 import를 연결합니다.
            </p>
          </div>
        ) : null}

        {authError ? (
          <p role="alert" style={{ marginTop: 16, fontSize: 13 }}>
            {authError}
          </p>
        ) : null}
      </section>
    </main>
  );
}
