# Product & UI Contract

## Primary workflow

```text
Google Login
  → Projects
  → New Project / Google Form selection
  → Target Editor
  → Synthesis
  → Result
  → Excel / CSV
```

Recommended routes:

```text
/login
/projects
/projects/:projectId
/projects/:projectId/runs/:runId
```

“New Project” should be a Dialog where practical rather than a separate route.

## UI philosophy

The application is for ordinary office users. The interface should be compact, production-oriented and task-focused.

Rules:

- Every visible element must earn its place.
- Prefer omission over generic helper copy.
- Do not repeat a page title in explanatory prose.
- Explanations are reserved for errors, surprising consequences, ambiguity, security/privacy consequences, and decisions the user must make.
- Prefer label → phrase → sentence → paragraph.
- Use whitespace, typography and dividers before Cards.
- Do not wrap every row or question in a Card.
- Do not add Badges merely to label states such as “auto”.
- Use progressive disclosure for advanced options.
- Do a deletion pass after implementation.

### shadcn principle

**Maximize reuse of the shadcn/ui system and interaction patterns, not the number of visible shadcn components.**

Use shadcn primitives where they materially help interaction and accessibility. Use semantic HTML/simple layout otherwise.

Recommended usage:

- Sidebar — app shell
- Input / Select / Combobox / ToggleGroup / Button / Field / FieldError
- Popover + Command — Form picker and target picker
- Collapsible — optional score distributions
- Sheet — advanced settings, Form inspector, validation details
- Dialog — new project, detailed goal
- AlertDialog — truly consequential destructive actions only
- DataTable — raw response previews/large matrix views only
- Chart — behind “분포 보기”; not default
- Sonner — transient confirmation only

## Login

```text
[app mark / app name]

[ Google로 계속하기 ]
```

No onboarding sequence unless a real decision is required.

## Projects / shell

Sidebar:

```text
Projects
+ 새 프로젝트

고객 만족도
직원 설문
...

user@company.com ▾
```

The account footer does not need an avatar by default.

Account menu may include:

- saved Google accounts
- Google 계정 추가
- 로그아웃
- low-frequency destructive/account actions as appropriate

No separate account-management page initially.

## Form selection

Dialog:

```text
새 프로젝트

[ Google Form 검색... ]

고객 만족도 조사       8월 28일
직원 만족도 조사       8월 20일

[취소]
```

Do not preload response counts for every form; that would require per-form Forms Responses calls. Fetch structure/responses after selection.

## Target Editor

Default:

```text
고객 만족도 조사

50 → [200] 명

조정할 문항

+ 문항 추가

                         [데이터 생성]
```

Absence of a target means “preserve original behavior”; do not show a redundant preserve mode.

### Selected question examples

Single choice:

```text
성별                  % 명
              현재    목표
여성           40%    [55]%
남성           60%     ≈45%
```

The auto-derived remaining value is text, not an editable field and not an “자동” badge.

Ordinal:

```text
만족도
현재 평균 3.7
목표 평균 [4.2]

점수별 조정
+ 세부 목표
```

Detailed goals are absent until created.

### Unit toggle contract

Display unit and target semantics are distinct.

If the stored constraint is ratio 55% and the user switches display to count:

```text
≈110명
```

is shown, but the stored target remains a ratio.

Only when the user edits a count does the constraint become an exact count.

Resetting a field removes the constraint and returns the metric to automatic preservation.

## Semantic ambiguity UI

High-confidence inference should not add UI chrome.

Example:

```text
나이
현재 평균 36.4
목표 평균 [40]
```

No “numeric” badge is necessary.

When ambiguous:

```text
직급 코드

처리 방식
[ 범주 ▼ ]
```

Show the choice when the user interacts with that question or before synthesis if resolution is required.

## Result screen

```text
고객 만족도 조사
200명 생성

              목표      결과
여성           55%      55%
만족도         4.2      4.20
서비스 A       60%      60%

[Excel] [CSV]

결과 다시 만들기
세부 검증
```

No KPI dashboard, success marketing copy, generic preservation score or default statistical charts.

`세부 검증` may open a Sheet.

## Autosave

There is no visible Save button.

- React Hook Form holds the editing draft.
- Debounce valid changes.
- Persist only complete/valid state.
- Do not continuously show “saved ✓”.
- Show save failure only.
- Flush pending valid autosave before route leave, project/account switch, window close, and before synthesis.

Targets use an optimistic concurrency `revision`.

## Security-sensitive copy exceptions

Short explanations/confirmation are justified for:

- Google 접근 권한 해제
- permanent local data deletion
- AI external data transfer
- file-upload placeholder not creating a real file
