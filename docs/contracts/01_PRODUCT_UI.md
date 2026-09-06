# Product & UI Contract

## Primary workflow

```text
Google Login
→ Projects
→ Select Google Form
→ Select SourceScope
→ Set final size and targets
→ Plan / Generate
→ Review result
→ Export CSV/XLSX
```

## UI philosophy

The application is for ordinary office users. Keep the interface sparse, direct, and consequence-oriented.

- Prefer typography, spacing, and separators before cards.
- Do not expose internal solver/model terminology by default.
- Explain ambiguity, infeasibility, denominator semantics, and original-row replacement clearly.
- Do not add dashboards or generic quality scores that obscure the actual target/result values.

## Source scope

A project may default to all imported responses, but the user can choose a submitted-time range.

Display the frozen scope clearly before generation, e.g.:

```text
응답 범위
2026-08-01 ~ 2026-08-02
원본 80명
```

Changing the UI range after a Run does not change that historical Run.

## Final size

Display source-to-final semantics directly:

```text
80 → [120] 명
추가 생성 40명
```

If final size is below scope source count, show a blocking validation error.

## Target semantics

The UI must distinguish:

- final absolute share, e.g. `25%`
- percentage-point change, e.g. `+5%p`
- relative percentage change, e.g. `+5%`
- exact count, e.g. `+5명` or final `40명`
- mean, e.g. `4.7`

Never store or execute ambiguous `+5%` semantics without explicit UI interpretation.

Initial target kinds:

```text
count
share
mean
conditional share
```

## Single choice / ordinal examples

```text
성별
현재 여성 40%
목표 [55%]
```

```text
만족도
현재 평균 4.2
목표 평균 [4.7]
```

Do not expose every category as an explicit user constraint unless the user edits it. Unspecified behavior is preserved by the generation model as well as practical.

## Checkbox

Checkbox percentages mean "eligible respondents who selected this option" by default, not percentage of all option selections.

Conditional example:

```text
부산 거주자 중
버스 선택 비율 +4%p
택시 선택 비율 +4%p
```

The denominator should be visible when it is not obvious.

## Short text / ValueGroup

The application does not auto-understand concepts such as fruit, occupation, or residence.

For a short-text target, show observed values and counts and let the user select members into a reusable group:

```text
그룹 이름: 과일

☑ 사과       23
☑ 오렌지      9
☑ 귤          7
☐ 고기       12
```

Search is required when the value set is large. Simple normalization/similarity suggestions may be added later, but automatic semantic grouping is not a v2 requirement.

Groups may overlap.

## Feasibility and original replacement

Generation planning should distinguish:

1. exact/nearest result with original rows preserved,
2. result possible only with original-derived row replacement,
3. impossible with available candidates/domains.

When replacement can improve or enable the requested result, show a comparison before applying it:

```text
원본 유지
→ 결과 12.5%

원본 1개 대체
→ 결과 12.0%
```

User choices:

```text
원본 유지
최소 원본 대체 허용
목표 수정/취소
```

No replacement is applied without explicit approval.

## Result screen

Show target and achieved values first:

```text
목표             결과
만족도 4.7       4.70
부산 15%         15.00%
부산 중 버스     44.0%
```

Then concise diagnostics:

- source scope
- synthetic row count
- original replacement count, if any
- structural validation status
- optional quality details

Do not collapse everything into one opaque "quality score".

## Autosave

No visible Save button for normal target editing.

Persist valid drafts with debounce and flush before generation, project switch, navigation, and window close.

## Export

Normal export contains the final survey table only. Provenance/debug metadata is not added as ordinary columns.
