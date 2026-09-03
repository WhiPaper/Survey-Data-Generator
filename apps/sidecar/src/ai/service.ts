import { randomUUID } from "node:crypto";
import type { RunId } from "@survey-synth/domain";
import { isSidecarError, sidecarError } from "../errors.js";
import type { ProjectRepository } from "../persistence/projects.js";
import type { SafeLogger } from "../rpc/logger.js";
import type { LlmCredentialStore } from "./credentials.js";
import { getEligibleDeferredCells } from "./eligibility.js";
import { type LlmGateway, OpenAiLlmGateway } from "./gateway.js";
import { AI_GENERATION_POLICY_V1 } from "./policy.js";
import { computeSettingsHash } from "./prompts.js";
import type { AiEligibleCell, AiGenerationResult, AiMetadata, LlmBatchItem } from "./types.js";
import { validateGeneratedText } from "./validator.js";

const DISCLOSURE_KEY = "ai_disclosure_acknowledged";

export interface AiTextServiceOptions {
  readonly repository: ProjectRepository;
  readonly credentials: LlmCredentialStore;
  readonly gateway?: LlmGateway;
  readonly logger?: SafeLogger;
  readonly isFeatureEnabled?: () => boolean;
}

export class AiTextService {
  private readonly repository: ProjectRepository;
  private readonly credentials: LlmCredentialStore;
  private readonly gateway: LlmGateway;
  private readonly logger?: SafeLogger;
  private readonly isFeatureEnabled: () => boolean;
  private readonly activeJobs = new Map<string, AbortController>();
  private readonly activeRunIds = new Set<string>();

  // Global provider request concurrency limiter
  private activeProviderRequests = 0;
  private readonly providerQueue: Array<() => void> = [];

  constructor(options: AiTextServiceOptions) {
    this.repository = options.repository;
    this.credentials = options.credentials;
    this.gateway = options.gateway ?? new OpenAiLlmGateway();
    this.logger = options.logger;
    this.isFeatureEnabled =
      options.isFeatureEnabled ??
      (() =>
        process.env.SURVEY_SYNTH_ENABLE_AI === "true" || process.env.NODE_ENV !== "production");
  }

  async getStatus(): Promise<{
    readonly enabled: boolean;
    readonly configured: boolean;
    readonly disclosed: boolean;
    readonly provider: string;
    readonly model: string;
  }> {
    const enabled = this.isFeatureEnabled();
    const configured = await this.credentials.hasApiKey();
    const disclosed = this.repository.getAppSetting(DISCLOSURE_KEY) === "true";
    return {
      enabled,
      configured,
      disclosed,
      provider: AI_GENERATION_POLICY_V1.provider,
      model: AI_GENERATION_POLICY_V1.defaultModel,
    };
  }

  async configure(apiKey: string): Promise<void> {
    await this.credentials.setApiKey(apiKey);
  }

  async clearCredentials(): Promise<void> {
    await this.credentials.deleteApiKey();
  }

  acknowledgeDisclosure(): void {
    this.repository.setAppSetting(DISCLOSURE_KEY, "true");
  }

  private async acquireProviderSlot(signal?: AbortSignal): Promise<void> {
    if (this.activeProviderRequests < AI_GENERATION_POLICY_V1.maxConcurrency) {
      this.activeProviderRequests++;
      return;
    }
    return new Promise<void>((resolve, reject) => {
      const onAbort = (): void => {
        const idx = this.providerQueue.indexOf(proceed);
        if (idx !== -1) this.providerQueue.splice(idx, 1);
        reject(sidecarError("JOB_CANCELLED", "AI generation cancelled", true));
      };
      const proceed = (): void => {
        if (signal?.aborted) {
          onAbort();
        } else {
          this.activeProviderRequests++;
          signal?.removeEventListener("abort", onAbort);
          resolve();
        }
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.providerQueue.push(proceed);
    });
  }

  private releaseProviderSlot(): void {
    this.activeProviderRequests--;
    const next = this.providerQueue.shift();
    if (next) next();
  }

  async generateText(runId: RunId, operationId?: string): Promise<AiGenerationResult> {
    if (!this.isFeatureEnabled()) {
      throw sidecarError(
        "PERMISSION_DENIED",
        "AI feature is disabled by public release policy gate",
        false,
      );
    }

    const apiKey = await this.credentials.getApiKey();
    if (!apiKey || apiKey.trim() === "") {
      throw sidecarError("BACKEND_UNAVAILABLE", "OpenAI API key is not configured", false, {
        reason: "ai_credential_missing",
      });
    }

    // Enforce disclosure acknowledgment before any external transmission
    const disclosed = this.repository.getAppSetting(DISCLOSURE_KEY) === "true";
    if (!disclosed) {
      throw sidecarError("PERMISSION_DENIED", "AI disclosure has not been acknowledged", false, {
        reason: "ai_disclosure_required",
      });
    }

    // Regeneration policy: already-generated runs return skipped to prevent accidental overwrites
    const existingMetadata = this.repository.getRunAiMetadata(runId);
    if (
      existingMetadata !== null &&
      (existingMetadata.status === "completed" || existingMetadata.status === "partial")
    ) {
      return {
        status: "skipped",
        runId,
        generatedFieldCount: 0,
        totalEligibleFieldCount: 0,
        warnings: ["AI text generation has already been completed for this Run."],
        metadata: existingMetadata,
      };
    }

    // Prevent concurrent AI generation on the same Run
    if (this.activeRunIds.has(runId)) {
      throw sidecarError(
        "VALIDATION_FAILED",
        "AI generation is already in progress for this Run",
        true,
      );
    }

    const opId = operationId ?? `ai_gen_${randomUUID()}`;
    if (this.activeJobs.has(opId)) {
      throw sidecarError("VALIDATION_FAILED", "AI generation operation is already active", true);
    }

    const abortController = new AbortController();
    this.activeJobs.set(opId, abortController);
    this.activeRunIds.add(runId);
    const startTime = Date.now();

    try {
      const runData = this.repository.loadRunDataForAi(runId);
      const eligibleCells = getEligibleDeferredCells(
        runData.form,
        runData.syntheticResponses,
        runData.originalResponses,
        runData.semanticInferences,
        runData.semanticOverrides,
      );

      if (eligibleCells.length === 0) {
        return {
          status: "skipped",
          runId,
          generatedFieldCount: 0,
          totalEligibleFieldCount: 0,
          warnings: ["No AI-eligible text fields found in this Run"],
        };
      }

      const warnings: string[] = [];
      const acceptedTexts = new Map<string, string>();
      let retryCount = 0;

      // Group eligible cells into batches
      const batches: AiEligibleCell[][] = [];
      for (let i = 0; i < eligibleCells.length; i += AI_GENERATION_POLICY_V1.batchSize) {
        batches.push(eligibleCells.slice(i, i + AI_GENERATION_POLICY_V1.batchSize));
      }

      const model = AI_GENERATION_POLICY_V1.defaultModel;
      const promptVersion = AI_GENERATION_POLICY_V1.promptVersion;
      const settingsHash = computeSettingsHash({
        provider: AI_GENERATION_POLICY_V1.provider,
        model,
        promptVersion,
      });

      let currentBatchIndex = 0;
      const processNextBatch = async (): Promise<void> => {
        while (currentBatchIndex < batches.length) {
          if (abortController.signal.aborted) {
            throw sidecarError("JOB_CANCELLED", "AI generation cancelled", true);
          }
          const batchIdx = currentBatchIndex++;
          const batch = batches[batchIdx];
          if (!batch) break;
          await this.processBatch(
            batch,
            apiKey,
            model,
            promptVersion,
            acceptedTexts,
            warnings,
            () => retryCount++,
            abortController.signal,
          );
        }
      };

      const workers: Promise<void>[] = [];
      const concurrency = Math.min(AI_GENERATION_POLICY_V1.maxConcurrency, batches.length);
      for (let c = 0; c < concurrency; c++) {
        workers.push(processNextBatch());
      }
      await Promise.all(workers);

      if (abortController.signal.aborted) {
        throw sidecarError("JOB_CANCELLED", "AI generation cancelled", true);
      }

      const generatedCount = acceptedTexts.size;
      const failedCount = eligibleCells.length - generatedCount;
      const status: "completed" | "partial" = failedCount === 0 ? "completed" : "partial";
      const generatedAt = new Date().toISOString();

      const metadata: AiMetadata = {
        provider: AI_GENERATION_POLICY_V1.provider,
        model,
        promptVersion,
        settingsHash,
        status,
        itemCount: eligibleCells.length,
        generatedCount,
        failedCount,
        generatedAt,
        warnings: warnings.length > 0 ? warnings : undefined,
      };

      // Transactional persistence of overlay texts and metadata
      this.repository.saveRunAiOverlay({
        runId,
        metadata,
        texts: acceptedTexts,
      });

      const durationMs = Date.now() - startTime;
      this.logger?.info("ai_generation_completed", {
        runId,
        batchCount: batches.length,
        fieldCount: eligibleCells.length,
        model,
        promptVersion,
        retryCount,
        durationMs,
      });

      return {
        status,
        runId,
        generatedFieldCount: generatedCount,
        totalEligibleFieldCount: eligibleCells.length,
        warnings,
        metadata,
      };
    } finally {
      this.activeJobs.delete(opId);
      this.activeRunIds.delete(runId);
    }
  }

  private async processBatch(
    batch: readonly AiEligibleCell[],
    apiKey: string,
    model: string,
    promptVersion: number,
    acceptedTexts: Map<string, string>,
    warnings: string[],
    onRetry: () => void,
    signal: AbortSignal,
  ): Promise<void> {
    // Map to opaque batch item IDs so raw response IDs and question IDs never leak to OpenAI
    const opaqueToCell = new Map<string, AiEligibleCell>();
    const requestItems: LlmBatchItem[] = [];

    batch.forEach((cell, index) => {
      const opaqueId = `item_${index + 1}`;
      opaqueToCell.set(opaqueId, cell);
      requestItems.push({
        id: opaqueId,
        questionTitle: cell.questionTitle,
        questionDescription: cell.questionDescription,
        structuredContext: cell.structuredContext,
        sourceExamples: cell.sourceExamples,
      });
    });

    let pendingItems = [...requestItems];
    let attempt = 0;

    // maxRetriesPerItem: 2 means 1 initial attempt + at most 2 retries (total 3 attempts)
    while (pendingItems.length > 0 && attempt <= AI_GENERATION_POLICY_V1.maxRetriesPerItem) {
      if (signal.aborted) {
        throw sidecarError("JOB_CANCELLED", "AI generation cancelled", true);
      }
      attempt++;

      try {
        await this.acquireProviderSlot(signal);
        let response;
        try {
          response = await this.gateway.generateText(
            {
              items: pendingItems,
              model,
              promptVersion,
            },
            apiKey,
            signal,
          );
        } finally {
          this.releaseProviderSlot();
        }

        const nextPending: LlmBatchItem[] = [];
        const returnedMap = new Map(response.items.map((it) => [it.id, it.text]));

        for (const item of pendingItems) {
          const cell = opaqueToCell.get(item.id)!;
          const targetKey = `${cell.responseId}:${cell.questionId}`;
          const returnedText = returnedMap.get(item.id);

          if (returnedText === undefined) {
            if (attempt <= AI_GENERATION_POLICY_V1.maxRetriesPerItem) {
              onRetry();
              nextPending.push(item);
            } else {
              warnings.push(`Item omitted by model response`);
            }
            continue;
          }

          const validation = validateGeneratedText(returnedText, cell.sourceExamples);
          if (validation.valid) {
            acceptedTexts.set(targetKey, returnedText.trim());
          } else {
            if (attempt <= AI_GENERATION_POLICY_V1.maxRetriesPerItem) {
              onRetry();
              nextPending.push(item);
            } else {
              warnings.push(`Item failed validation: ${validation.reason}`);
            }
          }
        }
        pendingItems = nextPending;
      } catch (error) {
        if (signal.aborted) throw error;

        // Fatal non-transient errors: invalid API key, permission denied, or client validation error
        // must abort immediately without retrying or continuing
        const isFatal =
          isSidecarError(error) &&
          ((error.backendError.code === "BACKEND_UNAVAILABLE" &&
            error.backendError.details?.reason === "ai_credential_invalid") ||
            error.backendError.code === "PERMISSION_DENIED");

        if (isFatal) {
          throw error;
        }

        if (attempt <= AI_GENERATION_POLICY_V1.maxRetriesPerItem) {
          onRetry();
        } else {
          // Retries exhausted for this batch
          for (let i = 0; i < pendingItems.length; i++) {
            warnings.push(
              `Item failed after retries: ${error instanceof Error ? error.message : "error"}`,
            );
          }
          break;
        }
      }
    }
  }

  cancel(operationId: string): boolean {
    const controller = this.activeJobs.get(operationId);
    if (controller === undefined) return false;
    controller.abort();
    this.activeJobs.delete(operationId);
    return true;
  }

  shutdown(): void {
    for (const [id, controller] of this.activeJobs.entries()) {
      controller.abort();
      this.activeJobs.delete(id);
    }
    this.activeRunIds.clear();
  }
}
