from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"expected one match in {path}, found {count}")
    file.write_text(text.replace(old, new, 1), encoding="utf-8")


# Persist workspace recency in the existing preferences table, scoped per Google account.
replace_once(
    "apps/desktop/electron/main/persistence/store.ts",
    'const ACTIVE_GOOGLE_ACCOUNT_PREFERENCE = "auth.activeGoogleAccountId";\n',
    '''const ACTIVE_GOOGLE_ACCOUNT_PREFERENCE = "auth.activeGoogleAccountId";\nconst RECENT_PROJECTS_PREFERENCE_PREFIX = "workspace.recentProjectIds.";\nconst MAX_RECENT_PROJECTS = 12;\n\nconst recentProjectsPreferenceKey = (accountId: string): string =>\n  `${RECENT_PROJECTS_PREFERENCE_PREFIX}${accountId}`;\n''',
)
replace_once(
    "apps/desktop/electron/main/persistence/store.ts",
    '''export type CreateProjectInput = {\n''',
    '''export const getRecentProjectIds = (db: SurveyDatabase, accountId: string): string[] => {\n  const row = db\n    .select()\n    .from(preferences)\n    .where(eq(preferences.key, recentProjectsPreferenceKey(accountId)))\n    .get();\n  if (!row) return [];\n\n  try {\n    const value = JSON.parse(row.valueJson) as unknown;\n    if (!Array.isArray(value)) return [];\n    return [...new Set(value.filter((item): item is string => typeof item === "string" && item.length > 0))]\n      .slice(0, MAX_RECENT_PROJECTS);\n  } catch {\n    return [];\n  }\n};\n\nconst writeRecentProjectIds = (\n  db: SurveyDatabase,\n  accountId: string,\n  projectIds: readonly string[],\n  nowMs = Date.now(),\n): void => {\n  const key = recentProjectsPreferenceKey(accountId);\n  const normalized = [...new Set(projectIds.filter((projectId) => projectId.length > 0))].slice(\n    0,\n    MAX_RECENT_PROJECTS,\n  );\n  if (normalized.length === 0) {\n    db.delete(preferences).where(eq(preferences.key, key)).run();\n    return;\n  }\n\n  db.insert(preferences)\n    .values({ key, valueJson: JSON.stringify(normalized), updatedAtMs: nowMs })\n    .onConflictDoUpdate({\n      target: preferences.key,\n      set: { valueJson: JSON.stringify(normalized), updatedAtMs: nowMs },\n    })\n    .run();\n};\n\nexport const recordRecentProject = (\n  db: SurveyDatabase,\n  accountId: string,\n  projectId: string,\n  nowMs = Date.now(),\n): void => {\n  const current = getRecentProjectIds(db, accountId);\n  writeRecentProjectIds(\n    db,\n    accountId,\n    [projectId, ...current.filter((candidate) => candidate !== projectId)],\n    nowMs,\n  );\n};\n\nexport const removeRecentProject = (\n  db: SurveyDatabase,\n  accountId: string,\n  projectId: string,\n  nowMs = Date.now(),\n): void => {\n  writeRecentProjectIds(\n    db,\n    accountId,\n    getRecentProjectIds(db, accountId).filter((candidate) => candidate !== projectId),\n    nowMs,\n  );\n};\n\nexport type CreateProjectInput = {\n''',
)

# Project service gets an explicit workspace-open operation. Plain get stays read-only.
replace_once(
    "apps/desktop/electron/main/projects/service.ts",
    '''  getProject,\n  getSourceRevision,\n  listProjects,\n  listSourceResponses,\n''',
    '''  getActiveGoogleAccountId,\n  getProject,\n  getRecentProjectIds,\n  getSourceRevision,\n  listProjects,\n  listSourceResponses,\n  recordRecentProject,\n  removeRecentProject,\n''',
)
replace_once(
    "apps/desktop/electron/main/projects/service.ts",
    '''  list(): Promise<ProjectSummaryView[]>;\n  get(projectId: string): Promise<ProjectDetailView | null>;\n''',
    '''  list(): Promise<ProjectSummaryView[]>;\n  get(projectId: string): Promise<ProjectDetailView | null>;\n  open(projectId: string): Promise<ProjectDetailView | null>;\n''',
)
replace_once(
    "apps/desktop/electron/main/projects/service.ts",
    '''export const createProjectService = ({ db }: CreateProjectServiceOptions): ProjectService => ({\n  list: async () =>\n    listProjects(db).flatMap((project) => {\n      const loaded = loadProject(db, project);\n      return loaded ? [summary(loaded)] : [];\n    }),\n\n  get: async (projectId) => {\n    const project = getProject(db, projectId);\n    if (!project) return null;\n    const loaded = loadProject(db, project);\n    if (!loaded) return null;\n    return {\n      ...summary(loaded),\n      form: loaded.form,\n      responseTimestampRange: responseTimestampRange(db, loaded.revision.id),\n    };\n  },\n''',
    '''export const createProjectService = ({ db }: CreateProjectServiceOptions): ProjectService => ({\n  list: async () => {\n    const summaries = listProjects(db).flatMap((project) => {\n      const loaded = loadProject(db, project);\n      return loaded ? [summary(loaded)] : [];\n    });\n    const activeAccountId = getActiveGoogleAccountId(db);\n    if (!activeAccountId) return summaries;\n    const recentRank = new Map(\n      getRecentProjectIds(db, activeAccountId).map((projectId, index) => [projectId, index] as const),\n    );\n    return summaries.sort(\n      (left, right) =>\n        (recentRank.get(left.id) ?? Number.MAX_SAFE_INTEGER) -\n        (recentRank.get(right.id) ?? Number.MAX_SAFE_INTEGER),\n    );\n  },\n\n  get: async (projectId) => {\n    const project = getProject(db, projectId);\n    if (!project) return null;\n    const loaded = loadProject(db, project);\n    if (!loaded) return null;\n    return {\n      ...summary(loaded),\n      form: loaded.form,\n      responseTimestampRange: responseTimestampRange(db, loaded.revision.id),\n    };\n  },\n\n  open: async (projectId) => {\n    const project = getProject(db, projectId);\n    if (!project) return null;\n    const loaded = loadProject(db, project);\n    if (!loaded) return null;\n    if (project.googleAccountId) recordRecentProject(db, project.googleAccountId, project.id);\n    return {\n      ...summary(loaded),\n      form: loaded.form,\n      responseTimestampRange: responseTimestampRange(db, loaded.revision.id),\n    };\n  },\n''',
)
replace_once(
    "apps/desktop/electron/main/projects/service.ts",
    '''  delete: async (projectId) => {\n    const project = getProject(db, projectId);\n    if (!project) throw backendFailure("NOT_FOUND", "Project was not found");\n    db.delete(projects).where(eq(projects.id, projectId)).run();\n  },\n''',
    '''  delete: async (projectId) => {\n    const project = getProject(db, projectId);\n    if (!project) throw backendFailure("NOT_FOUND", "Project was not found");\n    db.delete(projects).where(eq(projects.id, projectId)).run();\n    if (project.googleAccountId) removeRecentProject(db, project.googleAccountId, project.id);\n  },\n''',
)

# RPC contract and backend route for explicit workspace open.
for path in ["packages/contracts/src/protocol.ts"]:
    replace_once(
        path,
        '''  "projects.list": { input: z.infer<typeof EmptyParamsSchema>; output: ProjectSummaryView[] };\n  "projects.get": { input: z.infer<typeof ProjectParamsSchema>; output: ProjectDetailView | null };\n''',
        '''  "projects.list": { input: z.infer<typeof EmptyParamsSchema>; output: ProjectSummaryView[] };\n  "projects.get": { input: z.infer<typeof ProjectParamsSchema>; output: ProjectDetailView | null };\n  "projects.open": { input: z.infer<typeof ProjectParamsSchema>; output: ProjectDetailView | null };\n''',
    )
    replace_once(
        path,
        '''  "projects.list",\n  "projects.get",\n  "projects.sourceReview",\n''',
        '''  "projects.list",\n  "projects.get",\n  "projects.open",\n  "projects.sourceReview",\n''',
    )
    replace_once(
        path,
        '''  "projects.list": EmptyParamsSchema,\n  "projects.get": ProjectParamsSchema,\n  "projects.sourceReview": ProjectParamsSchema,\n''',
        '''  "projects.list": EmptyParamsSchema,\n  "projects.get": ProjectParamsSchema,\n  "projects.open": ProjectParamsSchema,\n  "projects.sourceReview": ProjectParamsSchema,\n''',
    )
    replace_once(
        path,
        '''  "projects.list": z.array(ProjectSummarySchema),\n  "projects.get": ProjectDetailSchema.nullable(),\n  "projects.sourceReview": ProjectSourceReviewResultSchema,\n''',
        '''  "projects.list": z.array(ProjectSummarySchema),\n  "projects.get": ProjectDetailSchema.nullable(),\n  "projects.open": ProjectDetailSchema.nullable(),\n  "projects.sourceReview": ProjectSourceReviewResultSchema,\n''',
    )

replace_once(
    "apps/desktop/electron/main/backend.ts",
    '''    case "projects.get":\n      return requireProjects(services).get((request.params as { projectId: string }).projectId);\n    case "projects.sourceReview":\n''',
    '''    case "projects.get":\n      return requireProjects(services).get((request.params as { projectId: string }).projectId);\n    case "projects.open":\n      return requireProjects(services).open((request.params as { projectId: string }).projectId);\n    case "projects.sourceReview":\n''',
)
replace_once(
    "apps/desktop/src/api/backend.ts",
    '''export const getProject = (\n  projectId: string,\n  backend?: BackendInvoker,\n): Promise<ProjectDetailView | null> => callBackend("projects.get", { projectId }, backend);\nexport const getProjectSourceReview = (\n''',
    '''export const getProject = (\n  projectId: string,\n  backend?: BackendInvoker,\n): Promise<ProjectDetailView | null> => callBackend("projects.get", { projectId }, backend);\nexport const openProjectWorkspace = (\n  projectId: string,\n  backend?: BackendInvoker,\n): Promise<ProjectDetailView | null> => callBackend("projects.open", { projectId }, backend);\nexport const getProjectSourceReview = (\n''',
)

# Small pure helpers keep switcher search/recent behavior testable without duplicating project data.
Path("apps/desktop/src/projectSwitcher.ts").write_text(
    '''import type { ProjectSummaryView } from "@survey-synth/contracts";\n\nexport const recentProjectChoices = (\n  projects: readonly ProjectSummaryView[],\n  currentProjectId: string | null,\n  limit = 5,\n): ProjectSummaryView[] =>\n  projects.filter((project) => project.id !== currentProjectId).slice(0, Math.max(0, limit));\n\nexport const filterProjectChoices = (\n  projects: readonly ProjectSummaryView[],\n  query: string,\n): ProjectSummaryView[] => {\n  const normalized = query.trim().toLocaleLowerCase();\n  if (!normalized) return [...projects];\n  return projects.filter((project) => project.name.toLocaleLowerCase().includes(normalized));\n};\n\nexport const promoteProjectChoice = (\n  projects: readonly ProjectSummaryView[],\n  projectId: string,\n): ProjectSummaryView[] => {\n  const project = projects.find((candidate) => candidate.id === projectId);\n  return project ? [project, ...projects.filter((candidate) => candidate.id !== projectId)] : [...projects];\n};\n''',
    encoding="utf-8",
)

# AppShell: switch projects in place, flush first, restore last-used on startup, remove duplicate body title.
replace_once(
    "apps/desktop/src/AppShell.tsx",
    '''  listProjects,\n  login,\n  logout,\n  pingBackend,\n''',
    '''  listProjects,\n  login,\n  logout,\n  openProjectWorkspace,\n  pingBackend,\n''',
)
replace_once(
    "apps/desktop/src/AppShell.tsx",
    '''import { Button } from "@/components/ui/button";\nimport {\n  Dialog,\n''',
    '''import { Button } from "@/components/ui/button";\nimport {\n  DropdownMenu,\n  DropdownMenuContent,\n  DropdownMenuItem,\n  DropdownMenuLabel,\n  DropdownMenuSeparator,\n  DropdownMenuTrigger,\n} from "@/components/ui/dropdown-menu";\nimport {\n  Dialog,\n''',
)
replace_once(
    "apps/desktop/src/AppShell.tsx",
    '''} from "@/components/ui/dialog";\nimport { QuestionExplorerPanel } from "./QuestionExplorerPanel";\nimport { recoverAppliedSourceRefresh } from "./sourceRefreshRecovery";\n''',
    '''} from "@/components/ui/dialog";\nimport { Input } from "@/components/ui/input";\nimport { QuestionExplorerPanel } from "./QuestionExplorerPanel";\nimport {\n  filterProjectChoices,\n  promoteProjectChoice,\n  recentProjectChoices,\n} from "./projectSwitcher";\nimport { recoverAppliedSourceRefresh } from "./sourceRefreshRecovery";\n''',
)
replace_once(
    "apps/desktop/src/AppShell.tsx",
    '''  const [refreshDialogOpen, setRefreshDialogOpen] = useState(false);\n  const [refreshBusy, setRefreshBusy] = useState(false);\n''',
    '''  const [refreshDialogOpen, setRefreshDialogOpen] = useState(false);\n  const [projectSearchOpen, setProjectSearchOpen] = useState(false);\n  const [projectSearchQuery, setProjectSearchQuery] = useState("");\n  const [refreshBusy, setRefreshBusy] = useState(false);\n''',
)
replace_once(
    "apps/desktop/src/AppShell.tsx",
    '''      setSourceReview(null);\n      setRefreshDialogOpen(false);\n      return;\n''',
    '''      setSourceReview(null);\n      setRefreshDialogOpen(false);\n      setProjectSearchOpen(false);\n      setProjectSearchQuery("");\n      return;\n''',
)
replace_once(
    "apps/desktop/src/AppShell.tsx",
    '''    setFormsBusy(true);\n    setProjectsBusy(true);\n    setError(null);\n\n    void Promise.all([listForms(), listProjects()])\n      .then(([formsResult, projectResult]) => {\n        if (!active) return;\n        setForms(formsResult.items);\n        setProjects(projectResult);\n      })\n''',
    '''    setFormsBusy(true);\n    setProjectsBusy(true);\n    setSelectedProject(null);\n    setSourceReview(null);\n    setError(null);\n\n    void Promise.all([listForms(), listProjects()])\n      .then(async ([formsResult, projectResult]) => {\n        if (!active) return;\n        setForms(formsResult.items);\n        setProjects(projectResult);\n        const initialProject = projectResult[0];\n        if (!initialProject) return;\n\n        const project = await openProjectWorkspace(initialProject.id);\n        if (!active) return;\n        setSelectedProject(project);\n        if (project) {\n          try {\n            setSourceReview(await getProjectSourceReview(project.id));\n          } catch {\n            if (active) setError("프로젝트는 열었지만 확인할 설정 상태를 불러오지 못했습니다.");\n          }\n        }\n      })\n''',
)
replace_once(
    "apps/desktop/src/AppShell.tsx",
    '''      const project = await getProject(projectId);\n      setSelectedProject(project);\n      if (project) {\n''',
    '''      const project = await openProjectWorkspace(projectId);\n      setSelectedProject(project);\n      if (project) {\n        setProjects((current) => promoteProjectChoice(current, project.id));\n''',
)
replace_once(
    "apps/desktop/src/AppShell.tsx",
    '''  const handleProjectChange = async (): Promise<void> => {\n''',
    '''  const switchProject = async (projectId: string): Promise<void> => {\n    if (selectedProject?.id === projectId) {\n      setProjectSearchOpen(false);\n      setProjectSearchQuery("");\n      return;\n    }\n    if (selectedProject && !(await flushActiveDraft())) return;\n    await openProject(projectId);\n    setProjectSearchOpen(false);\n    setProjectSearchQuery("");\n  };\n\n  const handleProjectChange = async (): Promise<void> => {\n''',
)
replace_once(
    "apps/desktop/src/AppShell.tsx",
    '''      setSelectedProject(null);\n      setSourceReview(null);\n''',
    '''      setSelectedProject(null);\n      setSourceReview(null);\n      setProjectSearchOpen(false);\n      setProjectSearchQuery("");\n''',
)
replace_once(
    "apps/desktop/src/AppShell.tsx",
    '''  if (runtimeState !== "ready") {\n''',
    '''  const recentProjects = recentProjectChoices(projects, selectedProject?.id ?? null);\n  const filteredProjects = filterProjectChoices(projects, projectSearchQuery);\n\n  if (runtimeState !== "ready") {\n''',
)
replace_once(
    "apps/desktop/src/AppShell.tsx",
    '''      <header className="flex h-12 items-center justify-between border-b px-4">\n        <div className="flex min-w-0 items-center gap-3">\n          <span className="shrink-0 text-sm font-semibold">Survey Data Generator</span>\n          {selectedProject ? (\n            <span className="truncate text-sm text-muted-foreground">{selectedProject.name}</span>\n          ) : null}\n        </div>\n        <div className="flex items-center gap-2">\n          <span className="hidden text-xs text-muted-foreground sm:inline">\n            {session.account.email}\n          </span>\n          <Button size="sm" variant="ghost" disabled={authBusy} onClick={() => void handleLogout()}>\n            로그아웃\n          </Button>\n        </div>\n      </header>\n\n      {selectedProject ? (\n        <div className="mx-auto w-full max-w-[1440px] px-4 py-4">\n          <div className="flex items-center justify-between gap-4">\n            <div>\n              <h1 className="text-base font-semibold">{selectedProject.name}</h1>\n              <p className="mt-0.5 text-xs text-muted-foreground">\n                원본 응답 {selectedProject.responseCount}개 · 문항 {selectedProject.questionCount}개\n              </p>\n            </div>\n            <div className="flex items-center gap-2">\n              <Button\n                size="sm"\n                variant="outline"\n                disabled={refreshBusy}\n                onClick={() => setRefreshDialogOpen(true)}\n              >\n                원본 업데이트\n              </Button>\n              <Button\n                size="sm"\n                variant="outline"\n                disabled={projectsBusy || refreshBusy}\n                onClick={() => void handleProjectChange()}\n              >\n                프로젝트 변경\n              </Button>\n            </div>\n          </div>\n          <QuestionExplorerPanel\n            project={selectedProject}\n            sourceReview={sourceReview}\n            onDraftFlushReady={registerDraftFlush}\n          />\n        </div>\n''',
    '''      <header className="flex h-12 items-center justify-between border-b px-4">\n        <div className="flex min-w-0 items-center gap-2">\n          <span className="hidden shrink-0 text-sm font-semibold sm:inline">Survey Data Generator</span>\n          {selectedProject ? (\n            <DropdownMenu>\n              <DropdownMenuTrigger\n                render={\n                  <Button\n                    type="button"\n                    size="sm"\n                    variant="ghost"\n                    className="max-w-[280px] justify-start px-2 font-medium"\n                    disabled={projectsBusy || refreshBusy}\n                  >\n                    <span className="truncate">{selectedProject.name}</span>\n                    <span className="shrink-0 text-muted-foreground" aria-hidden="true">\n                      ▾\n                    </span>\n                  </Button>\n                }\n              />\n              <DropdownMenuContent align="start" className="min-w-[280px]">\n                <DropdownMenuLabel>최근 프로젝트</DropdownMenuLabel>\n                {recentProjects.length > 0 ? (\n                  recentProjects.map((project) => (\n                    <DropdownMenuItem\n                      key={project.id}\n                      className="items-start py-2"\n                      onClick={() => void switchProject(project.id)}\n                    >\n                      <span className="min-w-0 flex-1">\n                        <span className="block truncate font-medium">{project.name}</span>\n                        <span className="mt-0.5 block text-xs text-muted-foreground">\n                          응답 {project.responseCount}개 · 문항 {project.questionCount}개\n                        </span>\n                      </span>\n                    </DropdownMenuItem>\n                  ))\n                ) : (\n                  <DropdownMenuItem disabled>다른 최근 프로젝트가 없습니다.</DropdownMenuItem>\n                )}\n                <DropdownMenuSeparator />\n                <DropdownMenuItem onClick={() => setProjectSearchOpen(true)}>\n                  프로젝트 검색…\n                </DropdownMenuItem>\n                <DropdownMenuItem onClick={() => void handleProjectChange()}>\n                  새 프로젝트\n                </DropdownMenuItem>\n                <DropdownMenuItem onClick={() => void handleProjectChange()}>\n                  모든 프로젝트 보기\n                </DropdownMenuItem>\n              </DropdownMenuContent>\n            </DropdownMenu>\n          ) : (\n            <span className="text-sm font-medium">프로젝트</span>\n          )}\n        </div>\n        <div className="flex items-center gap-2">\n          {selectedProject ? (\n            <Button\n              size="sm"\n              variant="ghost"\n              disabled={refreshBusy}\n              onClick={() => setRefreshDialogOpen(true)}\n            >\n              원본 업데이트\n            </Button>\n          ) : null}\n          <span className="hidden text-xs text-muted-foreground md:inline">\n            {session.account.email}\n          </span>\n          <Button size="sm" variant="ghost" disabled={authBusy} onClick={() => void handleLogout()}>\n            로그아웃\n          </Button>\n        </div>\n      </header>\n\n      {selectedProject ? (\n        <div className="mx-auto w-full max-w-[1440px] px-4 py-3">\n          <QuestionExplorerPanel\n            project={selectedProject}\n            sourceReview={sourceReview}\n            onDraftFlushReady={registerDraftFlush}\n          />\n        </div>\n''',
)
replace_once(
    "apps/desktop/src/AppShell.tsx",
    '''                    onClick={() => void openProject(project.id)}\n''',
    '''                    onClick={() => void switchProject(project.id)}\n''',
)
replace_once(
    "apps/desktop/src/AppShell.tsx",
    '''      <Dialog open={refreshDialogOpen} onOpenChange={setRefreshDialogOpen}>\n''',
    '''      <Dialog\n        open={projectSearchOpen}\n        onOpenChange={(open) => {\n          setProjectSearchOpen(open);\n          if (!open) setProjectSearchQuery("");\n        }}\n      >\n        <DialogContent className="sm:max-w-[520px]">\n          <DialogHeader>\n            <DialogTitle>프로젝트 검색</DialogTitle>\n            <DialogDescription>최근 프로젝트를 포함해 이 기기에 저장된 프로젝트를 찾습니다.</DialogDescription>\n          </DialogHeader>\n          <Input\n            autoFocus\n            value={projectSearchQuery}\n            onChange={(event) => setProjectSearchQuery(event.target.value)}\n            placeholder="프로젝트 이름 검색"\n          />\n          <div className="max-h-[320px] divide-y overflow-y-auto border-y">\n            {filteredProjects.map((project) => (\n              <button\n                key={project.id}\n                type="button"\n                className="flex w-full items-center justify-between gap-4 py-3 text-left disabled:opacity-50"\n                disabled={projectsBusy || project.id === selectedProject?.id}\n                onClick={() => void switchProject(project.id)}\n              >\n                <span className="min-w-0">\n                  <span className="block truncate text-sm font-medium">{project.name}</span>\n                  <span className="mt-0.5 block text-xs text-muted-foreground">\n                    응답 {project.responseCount}개 · 문항 {project.questionCount}개\n                  </span>\n                </span>\n                {project.id === selectedProject?.id ? (\n                  <span className="shrink-0 text-xs text-muted-foreground">현재</span>\n                ) : null}\n              </button>\n            ))}\n            {filteredProjects.length === 0 ? (\n              <p className="py-5 text-sm text-muted-foreground">일치하는 프로젝트가 없습니다.</p>\n            ) : null}\n          </div>\n        </DialogContent>\n      </Dialog>\n\n      <Dialog open={refreshDialogOpen} onOpenChange={setRefreshDialogOpen}>\n''',
)

# Backend/service regression tests.
replace_once(
    "apps/desktop/test/project-service.test.ts",
    '''  createImportedProject,\n  createSourceRevision,\n  upsertGoogleAccount,\n''',
    '''  createImportedProject,\n  createSourceRevision,\n  getRecentProjectIds,\n  setActiveGoogleAccountId,\n  upsertGoogleAccount,\n''',
)
insert_project_test = '''\n  it("persists workspace recency and uses it for project ordering", async () => {\n    const database = createDatabase();\n    seedImportedProject(database);\n    createImportedProject(database.db, {\n      projectId: "project-2",\n      revisionId: "revision-2",\n      formSnapshotId: "snapshot-2",\n      name: "Later survey",\n      googleAccountId: "google-sub-1",\n      googleFormId: "form-2",\n      importedAtMs: 3000,\n      responseSetHash: "response-set-2",\n      formSnapshot: {\n        title: "Later survey",\n        schemaHash: "schema-2",\n        capturedAtMs: 3000,\n        schema: { title: "Later survey", questions: [] },\n      },\n      responses: [],\n    });\n    setActiveGoogleAccountId(database.db, "google-sub-1", 3500);\n    const service = createProjectService({ db: database.db });\n\n    await expect(service.list().then((items) => items.map((item) => item.id))).resolves.toEqual([\n      "project-2",\n      "project-1",\n    ]);\n\n    await expect(service.open("project-1")).resolves.toMatchObject({ id: "project-1" });\n    expect(getRecentProjectIds(database.db, "google-sub-1")).toEqual(["project-1"]);\n    await expect(service.get("project-2")).resolves.toMatchObject({ id: "project-2" });\n\n    const recreatedService = createProjectService({ db: database.db });\n    await expect(\n      recreatedService.list().then((items) => items.map((item) => item.id)),\n    ).resolves.toEqual(["project-1", "project-2"]);\n\n    await recreatedService.delete("project-1");\n    expect(getRecentProjectIds(database.db, "google-sub-1")).toEqual([]);\n  });\n'''
replace_once(
    "apps/desktop/test/project-service.test.ts",
    '''  it("deletes a project and its persisted source graph", async () => {\n''',
    insert_project_test + '''\n  it("deletes a project and its persisted source graph", async () => {\n''',
)

# All ProjectService mocks gain the new explicit open operation, plus one route assertion.
electron_test = Path("apps/desktop/test/electron-backend.test.ts")
text = electron_test.read_text(encoding="utf-8")
text = text.replace(
    '''      get: async (_projectId: string) => null,\n      sourceReview:''',
    '''      get: async (_projectId: string) => null,\n      open: async (_projectId: string) => null,\n      sourceReview:''',
)
text = text.replace(
    '''      get: async (_projectId: string) => project,\n      sourceReview,''',
    '''      get: async (_projectId: string) => project,\n      open: async (_projectId: string) => project,\n      sourceReview,''',
)
route_test = '''\n\n  it("routes project workspace open separately from read-only get", async () => {\n    const open = vi.fn(async (_projectId: string) => null);\n    const projects = {\n      list: async () => [],\n      get: async (_projectId: string) => null,\n      open,\n      sourceReview: async (_projectId: string) => ({\n        sourceRevisionId: "revision-1",\n        invalidValueGroupIds: [],\n      }),\n      runTargetPresentations: vi.fn(async () => []),\n      delete: async (_projectId: string) => undefined,\n    };\n\n    await expect(\n      handleBackendCall(\n        serialize(createRequest("test_project_open", "projects.open", { projectId: "project-1" })),\n        { projects },\n      ),\n    ).resolves.toBeNull();\n    expect(open).toHaveBeenCalledWith("project-1");\n  });\n'''
marker = '''  it("uses one source-review path for reopen and explicit refresh diagnostics", async () => {'''
if marker not in text:
    raise RuntimeError("electron backend route test marker missing")
text = text.replace(marker, route_test + "\n  " + marker.lstrip(), 1)
electron_test.write_text(text, encoding="utf-8")

Path("apps/desktop/test/project-switcher.test.ts").write_text(
    '''import { describe, expect, it } from "vitest";\n\nimport type { ProjectSummaryView } from "@survey-synth/contracts";\nimport {\n  filterProjectChoices,\n  promoteProjectChoice,\n  recentProjectChoices,\n} from "../src/projectSwitcher";\n\nconst project = (id: string, name: string): ProjectSummaryView => ({\n  id,\n  googleAccountId: "account-1" as never,\n  googleFormId: `form-${id}` as never,\n  name,\n  currentSourceRevisionId: `revision-${id}`,\n  createdAt: "2026-09-01T00:00:00.000Z",\n  updatedAt: "2026-09-01T00:00:00.000Z",\n  responseCount: 10,\n  questionCount: 2,\n});\n\ndescribe("project switcher choices", () => {\n  const projects = [project("one", "Alpha Survey"), project("two", "Beta Study"), project("three", "Gamma")];\n\n  it("keeps the persisted order while excluding the current project from recent choices", () => {\n    expect(recentProjectChoices(projects, "one").map((item) => item.id)).toEqual(["two", "three"]);\n  });\n\n  it("searches project names without changing backend data", () => {\n    expect(filterProjectChoices(projects, " beta ").map((item) => item.id)).toEqual(["two"]);\n    expect(projects.map((item) => item.id)).toEqual(["one", "two", "three"]);\n  });\n\n  it("promotes a successfully opened project for immediate switcher feedback", () => {\n    expect(promoteProjectChoice(projects, "three").map((item) => item.id)).toEqual([\n      "three",\n      "one",\n      "two",\n    ]);\n  });\n});\n''',
    encoding="utf-8",
)
