import { useEffect, useState } from "react";

import type { FormImportSummary, FormListItem, SessionView } from "@survey-synth/contracts";

import {
  cancelFormImport,
  getSession,
  importForm,
  listForms,
  login,
  logout,
  pingBackend,
} from "./api/backend";

type RuntimeState = "checking" | "ready" | "error";

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "요청을 처리하지 못했습니다.";

export function AppShell() {
  const [runtimeState, setRuntimeState] = useState<RuntimeState>("checking");
  const [message, setMessage] = useState("Electron Main 연결 확인 중…");
  const [session, setSession] = useState<SessionView | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [forms, setForms] = useState<FormListItem[]>([]);
  const [formsBusy, setFormsBusy] = useState(false);
  const [formsError, setFormsError] = useState<string | null>(null);
  const [importOperationId, setImportOperationId] = useState<string | null>(null);
  const [importingFormId, setImportingFormId] = useState<string | null>(null);
  const [importSummary, setImportSummary] = useState<FormImportSummary | null>(null);

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

  useEffect(() => {
    if (!session) {
      setForms([]);
      return;
    }
    let active = true;
    setFormsBusy(true);
    setFormsError(null);
    void listForms()
      .then((result) => {
        if (active) setForms(result.items);
      })
      .catch((error: unknown) => {
        if (active) setFormsError(errorMessage(error));
      })
      .finally(() => {
        if (active) setFormsBusy(false);
      });
    return () => {
      active = false;
    };
  }, [session?.account.id]);

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
      setImportSummary(null);
    } catch (error: unknown) {
      setAuthError(errorMessage(error));
    } finally {
      setAuthBusy(false);
    }
  };

  const reloadForms = async (): Promise<void> => {
    setFormsBusy(true);
    setFormsError(null);
    try {
      setForms((await listForms()).items);
    } catch (error: unknown) {
      setFormsError(errorMessage(error));
    } finally {
      setFormsBusy(false);
    }
  };

  const handleImport = async (form: FormListItem): Promise<void> => {
    const operationId = `form-import-${Date.now()}`;
    setImportOperationId(operationId);
    setImportingFormId(form.formId);
    setImportSummary(null);
    setFormsError(null);
    try {
      setImportSummary(await importForm(form.formId, operationId));
    } catch (error: unknown) {
      setFormsError(errorMessage(error));
    } finally {
      setImportOperationId(null);
      setImportingFormId(null);
    }
  };

  const handleCancelImport = async (): Promise<void> => {
    if (!importOperationId) return;
    try {
      await cancelFormImport(importOperationId);
    } catch (error: unknown) {
      setFormsError(errorMessage(error));
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
      <section style={{ width: "min(680px, 100%)" }}>
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

            <div style={{ marginTop: 28, borderTop: "1px solid currentColor", paddingTop: 20 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <h2 style={{ margin: 0, fontSize: 18 }}>Google Forms</h2>
                <button type="button" disabled={formsBusy} onClick={() => void reloadForms()}>
                  {formsBusy ? "불러오는 중…" : "새로고침"}
                </button>
              </div>

              {!formsBusy && forms.length === 0 ? (
                <p style={{ fontSize: 13, opacity: 0.65 }}>접근 가능한 Google Form이 없습니다.</p>
              ) : null}

              <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
                {forms.map((form) => (
                  <div
                    key={form.formId}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 16,
                      padding: 12,
                      border: "1px solid currentColor",
                      borderRadius: 8,
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{form.title}</p>
                      {form.modifiedAt ? (
                        <p style={{ margin: "4px 0 0", fontSize: 12, opacity: 0.6 }}>
                          수정: {form.modifiedAt}
                        </p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      disabled={importingFormId !== null}
                      onClick={() => void handleImport(form)}
                    >
                      {importingFormId === form.formId ? "가져오는 중…" : "가져오기"}
                    </button>
                  </div>
                ))}
              </div>

              {importOperationId ? (
                <button type="button" style={{ marginTop: 12 }} onClick={() => void handleCancelImport()}>
                  가져오기 취소
                </button>
              ) : null}

              {importSummary ? (
                <div style={{ marginTop: 16, padding: 12, border: "1px solid currentColor", borderRadius: 8 }}>
                  <p style={{ margin: 0, fontWeight: 600 }}>프로젝트 생성 완료</p>
                  <p style={{ margin: "6px 0 0", fontSize: 13 }}>
                    {importSummary.title} · 응답 {importSummary.responseCount}개 · 질문 {importSummary.questionCount}개
                  </p>
                  <p style={{ margin: "4px 0 0", fontSize: 12, opacity: 0.6 }}>
                    프로젝트 ID: {importSummary.importId}
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {authError ? (
          <p role="alert" style={{ marginTop: 16, fontSize: 13 }}>
            {authError}
          </p>
        ) : null}
        {formsError ? (
          <p role="alert" style={{ marginTop: 16, fontSize: 13 }}>
            {formsError}
          </p>
        ) : null}
      </section>
    </main>
  );
}
