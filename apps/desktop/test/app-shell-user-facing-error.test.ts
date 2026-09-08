import { describe, expect, it } from "vitest";

import { appShellErrorMessage } from "../src/appShellError";
import { userFacingErrorMessage } from "../src/userFacingError";

const backendFailure = (code: string, message = "Backend SourceScope engine failure") => ({
  backendError: { code, message, recoverable: true },
});

describe("App shell user-facing errors", () => {
  it("uses operation-specific fallbacks without exposing raw technical messages", () => {
    const startup = appShellErrorMessage(
      new Error("Backend unavailable while opening SourceRevision"),
      "startup",
    );
    const imported = appShellErrorMessage(backendFailure("INTERNAL"), "import_form");

    expect(startup).toBe("앱을 시작하지 못했습니다. 다시 실행해주세요.");
    expect(imported).toBe("Google Form을 가져오지 못했습니다.");
    const switchAccount = appShellErrorMessage(
      new Error("credential provider implementation detail"),
      "switch_account",
    );

    expect(switchAccount).toBe("Google 계정을 전환하지 못했습니다.");
    const revokeAccount = appShellErrorMessage(
      new Error("OAuth token provider implementation detail"),
      "revoke_account",
    );

    expect(revokeAccount).toBe("Google 계정 연결을 해제하지 못했습니다.");
    expect(`${startup} ${imported} ${switchAccount} ${revokeAccount}`).not.toMatch(
      /Backend|SourceRevision|SourceScope|engine|credential provider|OAuth token provider/,
    );
  });

  it("shares safe actionable copy for structured account and service errors", () => {
    expect(appShellErrorMessage(backendFailure("REAUTH_REQUIRED"), "load_home")).toBe(
      "Google 계정 연결이 만료되었습니다. 다시 연결해주세요.",
    );
    expect(appShellErrorMessage(backendFailure("RATE_LIMITED"), "import_form")).toBe(
      "요청이 많습니다. 잠시 후 다시 시도해주세요.",
    );
    expect(appShellErrorMessage(backendFailure("PERMISSION_DENIED"), "delete_project")).toBe(
      "이 작업에 필요한 권한이 없습니다.",
    );
  });

  it("never uses the backend message even when the code is unknown", () => {
    expect(
      userFacingErrorMessage(
        backendFailure("SOMETHING_NEW", "candidate_support denominator internal message"),
        "요청을 처리하지 못했습니다.",
      ),
    ).toBe("요청을 처리하지 못했습니다.");
  });
});
