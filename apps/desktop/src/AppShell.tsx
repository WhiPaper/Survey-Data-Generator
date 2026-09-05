import { useEffect, useState } from "react";

import { pingBackend } from "./api/backend";

type RuntimeState = "checking" | "ready" | "error";

export function AppShell() {
  const [runtimeState, setRuntimeState] = useState<RuntimeState>("checking");
  const [message, setMessage] = useState("Electron Main 연결 확인 중…");

  useEffect(() => {
    let active = true;

    void pingBackend()
      .then((result) => {
        if (!active) return;
        setRuntimeState("ready");
        setMessage(result.message === "pong" ? "Electron Main 연결됨" : "Electron Main 응답 확인됨");
      })
      .catch((error: unknown) => {
        if (!active) return;
        setRuntimeState("error");
        setMessage(error instanceof Error ? error.message : "Electron Main 연결 실패");
      });

    return () => {
      active = false;
    };
  }, []);

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
        {runtimeState === "ready" ? (
          <p style={{ marginTop: 20, fontSize: 13, opacity: 0.6 }}>
            Google 계정과 프로젝트 기능은 다음 persistence/import 단계에서 연결합니다.
          </p>
        ) : null}
      </section>
    </main>
  );
}
