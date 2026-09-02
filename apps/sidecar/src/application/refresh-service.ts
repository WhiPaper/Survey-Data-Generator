import { createHash } from "node:crypto";
import type {
  FormId,
  GoogleAccountId,
  NormalizedResponse,
  ProjectId,
  SourceRevisionId,
} from "@survey-synth/domain";
import {
  diffFormSchemas,
  migrateProjectTargets,
  type TargetMigrationIssue,
} from "@survey-synth/domain";
import type {
  ProjectsRefreshSourceParams,
  ProjectsRefreshSourceResult,
} from "@survey-synth/contracts";
import type { FormImportService } from "../forms/service.js";
import type { ProjectRepository } from "../persistence/projects.js";
import { sidecarError } from "../errors.js";

const hash = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

export const responseContentHash = (response: NormalizedResponse): string =>
  hash({
    createdAt: response.createdAt,
    lastSubmittedAt: response.lastSubmittedAt,
    answers: response.answers,
    path: response.path,
  });

export interface RefreshServiceOptions {
  readonly projectRepository: ProjectRepository;
  readonly formImportService: FormImportService;
  readonly now?: () => number;
}

export class RefreshService {
  private readonly activeOperations = new Map<string, AbortController>();
  private readonly cancelledOperations = new Set<string>();
  private readonly projectRepo: ProjectRepository;
  private readonly forms: FormImportService;
  private readonly now: () => number;

  public constructor(options: RefreshServiceOptions) {
    this.projectRepo = options.projectRepository;
    this.forms = options.formImportService;
    this.now = options.now ?? (() => Date.now());
  }

  public cancel(operationId: string): void {
    this.cancelledOperations.add(operationId);
    const controller = this.activeOperations.get(operationId);
    if (controller) {
      controller.abort();
      this.activeOperations.delete(operationId);
    }
  }

  public async refreshSource(
    params: ProjectsRefreshSourceParams,
  ): Promise<ProjectsRefreshSourceResult> {
    const opId = params.operationId;
    if (opId && this.cancelledOperations.has(opId)) {
      this.cancelledOperations.delete(opId);
      throw sidecarError("JOB_CANCELLED", "Source refresh was cancelled", true);
    }

    const controller = new AbortController();
    if (opId) {
      this.activeOperations.set(opId, controller);
    }

    const projectId = params.projectId as ProjectId;

    try {
      if (controller.signal.aborted || (opId && this.cancelledOperations.has(opId))) {
        throw sidecarError("JOB_CANCELLED", "Source refresh was cancelled", true);
      }

      const project = this.projectRepo.get(projectId);
      if (!project) {
        throw sidecarError("NOT_FOUND", "Project not found", true);
      }

      const currentSource = this.projectRepo.loadSynthesisSource(projectId);
      if (!currentSource) {
        throw sidecarError("NOT_FOUND", "Source revision not found", true);
      }

      // Precondition 1: Check for active unresolved blocking migration issues
      const existingIssues = this.projectRepo.getMigrationIssues(projectId);
      const blockingExisting = existingIssues.filter((i) => i.severity === "blocking");
      if (blockingExisting.length > 0) {
        throw sidecarError(
          "VALIDATION_FAILED",
          "이전 새로고침의 미해결 목표 변경사항을 먼저 해결해야 합니다.",
          true,
        );
      }

      // Precondition 2: Check target revision concurrency
      const currentTargetState = this.projectRepo.getTargets(projectId);
      if (params.expectedTargetRevision !== currentTargetState.revision) {
        throw sidecarError(
          "TARGET_CONFLICT",
          "Target revision changed before refresh could be completed",
          true,
        );
      }

      // Fetch remote form and responses with cancellation signal
      const remote = await this.forms.fetchAndNormalize(
        project.googleAccountId as GoogleAccountId,
        project.googleFormId as FormId,
        controller.signal,
      );

      if (controller.signal.aborted) {
        throw sidecarError("JOB_CANCELLED", "Source refresh was cancelled", true);
      }

      // 1. Schema diff
      const schemaDiff = diffFormSchemas(currentSource.form, remote.form);

      // 2. Response diff
      const currentHashMap = new Map<string, string>();
      for (const resp of currentSource.responses) {
        currentHashMap.set(resp.responseId, responseContentHash(resp));
      }

      const remoteHashMap = new Map<string, string>();
      for (const resp of remote.responses) {
        remoteHashMap.set(resp.responseId, responseContentHash(resp));
      }

      let added = 0;
      let changed = 0;
      for (const [id, rHash] of remoteHashMap.entries()) {
        const cHash = currentHashMap.get(id);
        if (cHash === undefined) {
          added += 1;
        } else if (cHash !== rHash) {
          changed += 1;
        }
      }

      let removed = 0;
      for (const id of currentHashMap.keys()) {
        if (!remoteHashMap.has(id)) {
          removed += 1;
        }
      }

      // 3. No-change check
      if (schemaDiff.severity === "none" && added === 0 && changed === 0 && removed === 0) {
        return {
          status: "no_change",
          sourceRevisionId: project.currentSourceRevisionId,
          sourceResponseCount: currentSource.responses.length,
        };
      }

      // 4. Target migration
      const overrides = this.projectRepo.getSemanticOverrides(projectId);
      const migrationResult = migrateProjectTargets(
        currentTargetState.targets,
        currentSource.form,
        remote.form,
        overrides,
      );

      const issues: TargetMigrationIssue[] = [...migrationResult.issues];
      const nextTargetRevision = currentTargetState.revision + 1;
      const importedAt = new Date(this.now()).toISOString();

      // 5. Atomic commit
      const { revisionId } = this.projectRepo.createSourceRevision({
        projectId,
        form: remote.form,
        responses: remote.responses,
        previousRevisionId: project.currentSourceRevisionId as SourceRevisionId,
        targetRevision: nextTargetRevision,
        targets: migrationResult.migratedTargets,
        issues,
        importedAt,
      });

      return {
        status: "updated",
        sourceRevisionId: revisionId,
        sourceResponseCount: remote.responses.length,
        addedResponseCount: added,
        changedResponseCount: changed,
        removedResponseCount: removed,
        targetRevision: nextTargetRevision,
        schemaSeverity: schemaDiff.severity,
        issues,
      };
    } finally {
      if (opId) {
        this.activeOperations.delete(opId);
        this.cancelledOperations.delete(opId);
      }
    }
  }
}
