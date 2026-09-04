import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

export type AuthLoadingScreenProps = Record<string, never>;

export function AuthLoadingScreen() {
  return (
    <main className="auth-shell">
      <section className="auth-panel" aria-live="polite">
        <h1 className="auth-title">Survey Synth</h1>
        <Spinner aria-label="불러오는 중" />
      </section>
    </main>
  );
}

export type AuthLoginScreenProps = {
  readonly onLogin: () => void;
  readonly loginPending: boolean;
  readonly busy: boolean;
  readonly error?: string;
};

export function AuthLoginScreen({
  onLogin,
  loginPending,
  busy,
  error,
}: AuthLoginScreenProps) {
  return (
    <main className="auth-shell">
      <section className="auth-panel" aria-labelledby="auth-title">
        <h1 id="auth-title" className="auth-title">
          Survey Synth
        </h1>
        <Button type="button" onClick={onLogin} disabled={busy}>
          {loginPending ? "Google 로그인 중…" : "Google로 계속하기"}
        </Button>
        {error !== undefined && <p role="alert">{error}</p>}
      </section>
    </main>
  );
}

