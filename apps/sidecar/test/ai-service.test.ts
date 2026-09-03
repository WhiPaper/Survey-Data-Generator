import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  FormId,
  FormSnapshot,
  GoogleAccountId,
  NormalizedResponse,
  ProjectId,
  QuestionId,
  ResponseId,
  RunId,
  SectionId,
  SourceRevisionId,
} from "@survey-synth/domain";
import type { ValidationResult } from "@survey-synth/synthesis-core";
import type { SecureSecretStore } from "../src/host.js";
import { ProjectDatabase } from "../src/persistence/database.js";
import { ProjectRepository } from "../src/persistence/projects.js";
import { LlmCredentialStore } from "../src/ai/credentials.js";
import { AiTextService } from "../src/ai/service.js";
import type { LlmGateway, LlmGenerationRequest, LlmGenerationResponse } from "../src/ai/gateway.js";
import { sidecarError } from "../src/errors.js";

class MemorySecretStore implements SecureSecretStore {
  public readonly values = new Map<string, Uint8Array>();
  public get(key: string): Promise<Uint8Array | null> {
    return Promise.resolve(this.values.get(key) ?? null);
  }
  public set(key: string, value: Uint8Array): Promise<void> {
    this.values.set(key, value);
    return Promise.resolve();
  }
  public delete(key: string): Promise<void> {
    this.values.delete(key);
    return Promise.resolve();
  }
}

class FakeLlmGateway implements LlmGateway {
  public requests: LlmGenerationRequest[] = [];
  public currentConcurrent = 0;
  public maxConcurrent = 0;
  public delayMs = 10;
  public customHandler?: (
    request: LlmGenerationRequest,
    signal?: AbortSignal,
  ) => Promise<LlmGenerationResponse>;

  async generateText(
    request: LlmGenerationRequest,
    _apiKey: string,
    signal?: AbortSignal,
  ): Promise<LlmGenerationResponse> {
    this.requests.push(request);
    this.currentConcurrent++;
    if (this.currentConcurrent > this.maxConcurrent) {
      this.maxConcurrent = this.currentConcurrent;
    }

    try {
      if (this.delayMs > 0) {
        await new Promise((r) => setTimeout(r, this.delayMs));
      }
      if (signal?.aborted) {
        throw sidecarError("JOB_CANCELLED", "Request aborted", true);
      }
      if (this.customHandler) {
        return await this.customHandler(request, signal);
      }
      return {
        items: request.items.map((item) => ({
          id: item.id,
          text: `인공지능이 생성한 자연스러운 응답입니다 (${item.id}).`,
        })),
      };
    } finally {
      this.currentConcurrent--;
    }
  }
}

const makeValidation = (count: number): ValidationResult => ({
  valid: true,
  originalMutationCount: 0,
  finalResponseCount: count,
  metrics: [],
  errors: [],
});

describe("AiTextService & Overlay Lifecycle", () => {
  let tempDir: string;
  let db: ProjectDatabase;
  let repo: ProjectRepository;
  let secrets: MemorySecretStore;
  let credentials: LlmCredentialStore;
  let gateway: FakeLlmGateway;
  let service: AiTextService;
  const testFiles: string[] = [];

  let projectId: ProjectId;
  let runId: RunId;
  let sourceRevisionId: SourceRevisionId;

  const form: FormSnapshot = {
    formId: "form_ai_1" as FormId,
    title: "AI 테스트 설문",
    description: "설명",
    schemaHash: "hash_ai_1",
    capturedAt: "2026-09-01T00:00:00Z",
    sections: [
      {
        id: "sec_1" as SectionId,
        index: 0,
        title: "기본 섹션",
        questions: ["q_rating" as QuestionId, "q_feedback" as QuestionId, "q_name" as QuestionId],
      },
    ],
    questions: [
      {
        id: "q_rating" as QuestionId,
        sectionId: "sec_1" as SectionId,
        index: 0,
        kind: "ordinal",
        title: "만족도",
        scale: { min: 1, max: 5 },
        presentation: "linear_scale",
      },
      {
        id: "q_feedback" as QuestionId,
        sectionId: "sec_1" as SectionId,
        index: 1,
        kind: "text",
        title: "개선 의견",
        presentation: "paragraph",
      },
      {
        id: "q_name" as QuestionId,
        sectionId: "sec_1" as SectionId,
        index: 2,
        kind: "text",
        title: "성함",
        presentation: "short_answer",
      },
    ],
    groups: [],
    logic: {},
  };

  const originalResponses: NormalizedResponse[] = [
    {
      responseId: "orig_1" as ResponseId,
      origin: "original",
      createdAt: "2026-09-01T10:00:00Z",
      submittedAt: "2026-09-01T10:00:00Z",
      path: {
        confidence: "certain",
        sections: { sec_1: "reached" },
        questions: { q_feedback: "reached" },
      },
      answers: {
        q_rating: { state: "answered", value: { kind: "ordinal", value: 4 } },
        q_feedback: {
          state: "answered",
          value: { kind: "text", value: "배송이 신속하고 상품 품질이 우수함." },
        },
      },
    },
  ];

  const syntheticResponses: NormalizedResponse[] = [
    {
      responseId: "synth_1" as ResponseId,
      origin: "synthetic",
      createdAt: "2026-09-01T11:00:00Z",
      submittedAt: "2026-09-01T11:00:00Z",
      path: {
        confidence: "certain",
        sections: { sec_1: "reached" },
        questions: { q_feedback: "reached" },
      },
      answers: {
        q_rating: { state: "answered", value: { kind: "ordinal", value: 5 } },
        // Empty text on reached question -> eligible for AI generation
        q_feedback: { state: "answered", value: { kind: "text", value: "" } },
      },
    },
  ];

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "ai-service-test-"));
    const dbPath = join(tempDir, "projects.db");
    secrets = new MemorySecretStore();
    db = await ProjectDatabase.open(dbPath, secrets);
    repo = new ProjectRepository(db);
    credentials = new LlmCredentialStore(secrets);
    gateway = new FakeLlmGateway();
    service = new AiTextService({
      repository: repo,
      credentials,
      gateway,
      isFeatureEnabled: () => true,
    });

    // Create project, revision, profiles, and run
    repo.createFromImport("acc_1" as GoogleAccountId, form, originalResponses);
    const proj = repo.list()[0]!;
    projectId = proj.id;
    const projDetail = repo.get(projectId)!;
    sourceRevisionId = projDetail.currentSourceRevisionId;

    db.prepare("UPDATE projects SET time_zone='Asia/Seoul' WHERE id=?").run(projectId);

    // Ensure profile has free_text inference
    const profileJson = JSON.stringify({
      questionId: "q_feedback",
      kind: "text",
      summary: {},
      semanticInference: {
        inferred: "free_text",
        confidence: 0.95,
        sampleSize: 1,
      },
    });
    db.prepare(
      "INSERT OR REPLACE INTO question_profiles (revision_id, question_id, profiler_version, payload_json) VALUES (?, ?, 1, ?)",
    ).run(sourceRevisionId, "q_feedback", profileJson);

    const savedRun = repo.saveRun({
      projectId,
      sourceRevisionId,
      targets: { targetResponseCount: 2, questionTargets: [] },
      targetRevision: 1,
      seed: 42,
      validation: makeValidation(2),
      synthetic: syntheticResponses,
      semanticOverrides: [],
    });
    runId = savedRun.id;
  });

  afterEach(async () => {
    service.shutdown();
    db.close();
    await rm(tempDir, { recursive: true, force: true });
    for (const f of testFiles) {
      try {
        await rm(f, { force: true });
      } catch {
        // ignore
      }
    }
  });

  it("manages credential and disclosure status correctly", async () => {
    expect(await credentials.hasApiKey()).toBe(false);
    const status1 = await service.getStatus();
    expect(status1.configured).toBe(false);
    expect(status1.disclosed).toBe(false);

    await service.configure("sk-test-key-12345");
    expect(await credentials.hasApiKey()).toBe(true);
    expect(await credentials.getApiKey()).toBe("sk-test-key-12345");

    service.acknowledgeDisclosure();
    const status2 = await service.getStatus();
    expect(status2.configured).toBe(true);
    expect(status2.disclosed).toBe(true);

    await service.clearCredentials();
    expect(await credentials.hasApiKey()).toBe(false);
  });

  it("fails if API key is missing", async () => {
    service.acknowledgeDisclosure();
    await expect(service.generateText(runId)).rejects.toMatchObject({
      backendError: {
        code: "BACKEND_UNAVAILABLE",
        details: { reason: "ai_credential_missing" },
      },
    });
  });

  it("fails if disclosure has not been acknowledged before generation", async () => {
    await service.configure("sk-test-key");
    await expect(service.generateText(runId)).rejects.toMatchObject({
      backendError: {
        code: "PERMISSION_DENIED",
        details: { reason: "ai_disclosure_required" },
      },
    });
    // No provider call should have been made
    expect(gateway.requests.length).toBe(0);
  });

  it("fails if release policy gate is OFF", async () => {
    const gatedService = new AiTextService({
      repository: repo,
      credentials,
      gateway,
      isFeatureEnabled: () => false,
    });
    await expect(gatedService.generateText(runId)).rejects.toMatchObject({
      backendError: { code: "PERMISSION_DENIED" },
    });
  });

  it("generates and persists AI overlay transactionally without mutating baseline synthetic rows", async () => {
    await service.configure("sk-test-key");
    service.acknowledgeDisclosure();

    const result = await service.generateText(runId);
    expect(result.status).toBe("completed");
    expect(result.generatedFieldCount).toBe(1);
    expect(result.totalEligibleFieldCount).toBe(1);

    // Verify baseline synthetic response in DB is UNCHANGED (still "")
    const syntheticDbRow = db
      .prepare<{ payload_json: string }>(
        "SELECT payload_json FROM synthetic_responses WHERE run_id=? AND response_id=?",
      )
      .get(runId, "synth_1");
    expect(syntheticDbRow).toBeDefined();
    const parsedBaseline = JSON.parse(syntheticDbRow!.payload_json);
    expect(parsedBaseline.answers.q_feedback.value.value).toBe("");

    // Verify AI overlay is persisted in run_ai_texts
    const texts = repo.getRunAiTexts(runId);
    expect(texts.size).toBe(1);
    const key = `synth_1:q_feedback`;
    expect(texts.has(key)).toBe(true);
    expect(texts.get(key)).toContain("인공지능이 생성한");

    // Verify run_ai_metadata is persisted with frozen settings
    const metadata = repo.getRunAiMetadata(runId);
    expect(metadata).not.toBeNull();
    expect(metadata?.status).toBe("completed");
    expect(metadata?.provider).toBe("openai");
    expect(metadata?.model).toBe("gpt-4o-mini");
    expect(metadata?.promptVersion).toBe(1);
    expect(metadata?.settingsHash).toBeDefined();

    // Verify context minimization: opaque item IDs, no raw response/question ID in prompt
    const promptItem = gateway.requests[0]!.items[0]!;
    expect(promptItem.id).toBe("item_1");
    expect(promptItem.id).not.toContain("synth_1");
    expect(promptItem.questionTitle).toBe("개선 의견");
    // q_name should NOT be in structuredContext because it is PII
    expect(promptItem.structuredContext.some((c) => c.title === "성함")).toBe(false);
  });

  it("rejects provider returning exact source example and retries up to maxRetries", async () => {
    await service.configure("sk-test-key");
    service.acknowledgeDisclosure();

    let attempts = 0;
    gateway.customHandler = async (req) => {
      attempts++;
      // Return exact source example
      return {
        items: req.items.map((it) => ({
          id: it.id,
          text: "배송이 신속하고 상품 품질이 우수함.",
        })),
      };
    };

    const result = await service.generateText(runId);
    // 1 initial + 2 retries = 3 attempts total
    expect(attempts).toBe(3);
    // Rejected, so status is partial with 0 generated
    expect(result.status).toBe("partial");
    expect(result.generatedFieldCount).toBe(0);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain("failed validation");

    // Copied source text must NOT be persisted
    const texts = repo.getRunAiTexts(runId);
    expect(texts.size).toBe(0);
  });

  it("rejects provider returning PII text", async () => {
    await service.configure("sk-test-key");
    service.acknowledgeDisclosure();

    gateway.customHandler = async (req) => {
      return {
        items: req.items.map((it) => ({
          id: it.id,
          text: "연락처는 010-1234-5678 로 전화주세요.",
        })),
      };
    };

    const result = await service.generateText(runId);
    expect(result.status).toBe("partial");
    expect(result.generatedFieldCount).toBe(0);
    expect(result.warnings[0]).toContain("failed validation");
    expect(repo.getRunAiTexts(runId).size).toBe(0);
  });

  it("enforces peak global provider concurrency bound (<= 2)", async () => {
    await service.configure("sk-test-key");
    service.acknowledgeDisclosure();

    // Insert 15 synthetic rows to create multiple batches
    const manySynthetics: NormalizedResponse[] = Array.from({ length: 15 }, (_, i) => ({
      responseId: `synth_batch_${i}` as ResponseId,
      origin: "synthetic",
      createdAt: "2026-09-01T11:00:00Z",
      submittedAt: "2026-09-01T11:00:00Z",
      path: {
        confidence: "certain",
        sections: { sec_1: "reached" },
        questions: { q_feedback: "reached" },
      },
      answers: {
        q_rating: { state: "answered", value: { kind: "ordinal", value: 4 } },
        q_feedback: { state: "answered", value: { kind: "text", value: "" } },
      },
    }));

    const bigRun = repo.saveRun({
      projectId,
      sourceRevisionId,
      targets: { targetResponseCount: 16, questionTargets: [] },
      targetRevision: 1,
      seed: 43,
      validation: makeValidation(16),
      synthetic: manySynthetics,
      semanticOverrides: [],
    });
    const bigRunId = bigRun.id;

    gateway.delayMs = 25;
    await service.generateText(bigRunId);
    expect(gateway.maxConcurrent).toBeLessThanOrEqual(2);
    expect(gateway.requests.length).toBeGreaterThan(1);
  });

  it("aborts and persists nothing on cancellation", async () => {
    await service.configure("sk-test-key");
    service.acknowledgeDisclosure();

    gateway.delayMs = 100;
    const opId = "cancel_op_1";

    const promise = service.generateText(runId, opId);
    // Cancel mid-flight
    await new Promise((r) => setTimeout(r, 20));
    const cancelled = service.cancel(opId);
    expect(cancelled).toBe(true);

    await expect(promise).rejects.toMatchObject({
      backendError: { code: "JOB_CANCELLED" },
    });

    // Nothing must be persisted from a cancelled operation
    expect(repo.getRunAiTexts(runId).size).toBe(0);
    expect(repo.getRunAiMetadata(runId)).toBeNull();
  });

  it("prevents concurrent AI generations on the same Run", async () => {
    await service.configure("sk-test-key");
    service.acknowledgeDisclosure();

    gateway.delayMs = 50;
    const p1 = service.generateText(runId, "op_1");
    // Start second call immediately for same runId
    const p2 = service.generateText(runId, "op_2");

    await expect(p2).rejects.toMatchObject({
      backendError: { code: "VALIDATION_FAILED" },
    });
    await expect(p1).resolves.toMatchObject({ status: "completed" });
  });

  it("skips second generation on already completed Run without overwriting", async () => {
    await service.configure("sk-test-key");
    service.acknowledgeDisclosure();

    const first = await service.generateText(runId);
    expect(first.status).toBe("completed");

    const second = await service.generateText(runId);
    expect(second.status).toBe("skipped");
    expect(second.generatedFieldCount).toBe(0);
    expect(second.warnings[0]).toContain("already been completed");
  });

  it("aborts immediately on 401/403 without retrying and leaves Run untouched", async () => {
    await service.configure("sk-invalid-key");
    service.acknowledgeDisclosure();

    let calls = 0;
    gateway.customHandler = async () => {
      calls++;
      throw sidecarError("BACKEND_UNAVAILABLE", "Invalid OpenAI key", false, {
        reason: "ai_credential_invalid",
        status: 401,
      });
    };

    await expect(service.generateText(runId)).rejects.toMatchObject({
      backendError: {
        code: "BACKEND_UNAVAILABLE",
        details: { reason: "ai_credential_invalid" },
      },
    });

    // Fatal error must NOT be retried
    expect(calls).toBe(1);
    expect(repo.getRunAiMetadata(runId)).toBeNull();
  });

  it("reloads persisted overlay across DB restart and exports seamlessly with zero OpenAI calls", async () => {
    await service.configure("sk-test-key");
    service.acknowledgeDisclosure();

    await service.generateText(runId);
    gateway.requests = []; // reset requests counter

    // Close and reopen database (simulate sidecar restart)
    db.close();
    db = await ProjectDatabase.open(join(tempDir, "projects.db"), secrets);
    const reopenedRepo = new ProjectRepository(db);

    // Metadata and texts are recovered from DB
    const meta = reopenedRepo.getRunAiMetadata(runId);
    expect(meta?.status).toBe("completed");
    const texts = reopenedRepo.getRunAiTexts(runId);
    expect(texts.size).toBe(1);

    // Export using ExportService
    const csvPath = join(tempDir, "export.csv");
    testFiles.push(csvPath);

    const exportData = reopenedRepo.loadHistoricalRunExportData(runId);
    // Synthetic responses in export data should have overlay text applied
    const synthExportSlot = exportData.syntheticResponses[0]!.answers.q_feedback!;
    expect(synthExportSlot.state).toBe("answered");
    if (synthExportSlot.state === "answered" && synthExportSlot.value.kind === "text") {
      expect(synthExportSlot.value.value).toContain("인공지능이 생성한");
    }

    // Zero provider requests occurred during reopen or export
    expect(gateway.requests.length).toBe(0);
  });

  it("preserves AI overlay isolation when project is refreshed to S2", async () => {
    await service.configure("sk-test-key");
    service.acknowledgeDisclosure();
    await service.generateText(runId);

    // Simulate source refresh by adding a new revision S2
    const rev2Id = "rev_s2" as SourceRevisionId;
    db.prepare(
      `INSERT INTO source_revisions (id, project_id, form_snapshot_id, source_response_count, response_set_hash, schema_hash, captured_at, imported_at)
       SELECT ?, project_id, form_snapshot_id, 2, 'hash2', schema_hash, '2026-09-02', '2026-09-02'
       FROM source_revisions WHERE id=?`,
    ).run(rev2Id, sourceRevisionId);
    db.prepare("UPDATE projects SET current_source_revision_id=? WHERE id=?").run(
      rev2Id,
      projectId,
    );

    // R1 loadHistoricalRunExportData must still load S1 form and S1 AI overlay
    const r1Data = repo.loadHistoricalRunExportData(runId);
    expect(r1Data.run.sourceRevisionId).toBe(sourceRevisionId);
    const r1Slot = r1Data.syntheticResponses[0]!.answers.q_feedback!;
    expect(r1Slot.state).toBe("answered");
    if (r1Slot.state === "answered" && r1Slot.value.kind === "text") {
      expect(r1Slot.value.value).toContain("인공지능이 생성한");
    }
  });
});
