# Explicit Source Refresh Lifecycle

This contract defines the first v2 project source-update slice.

## Product rule

Opening a Project is always local and never contacts Google implicitly.

The only way to update a Project's source is an explicit user action such as `원본 업데이트`.

For this slice, one explicit refresh command performs capture + apply atomically:

```text
user requests refresh
→ verify the Project's bound Google account is active
→ fetch the bound Google Form + all responses
→ normalize structure and responses
→ persist a new immutable SourceRevision
→ make that new revision the Project's current revision
→ revalidate mutable ValueGroups / target draft
→ return review diagnostics
```

There is no background refresh, polling, staging queue, or automatic promotion.

## Immutability

A refresh never mutates an existing SourceRevision or imported source response.

Historical Runs stay bound to the exact SourceRevision and frozen SourceScope they used. Applying a newer Project source does not change historical Run results, target snapshots, exports, or evidence.

## Failure atomicity

If Google fetch, normalization, account verification, or persistence fails, the Project keeps its previous current SourceRevision.

A source with zero responses is rejected in this slice. No new revision is created and the previous current revision remains active.

## Google identity

Refresh uses the Project's stored `googleAccountId` and `googleFormId`.

The active session must match the Project's bound Google account before and after network capture. If it does not, refresh fails with an actionable re-auth/account-switch error. The renderer never receives OAuth tokens or calls Google directly.

## Mutable state after refresh

ValueGroups and target drafts are editable Project state, so they are retained exactly as saved when a new SourceRevision becomes current.

Do not automatically:

- delete a ValueGroup,
- remove a target,
- remap a question id,
- remap an option key,
- rewrite ValueGroup membership.

Instead, refresh returns review diagnostics.

### ValueGroup review

A ValueGroup needs review when its source question no longer exists or is no longer groupable.

For a structured single-choice ValueGroup, it also needs review when one or more saved member option keys no longer exist in the refreshed Form structure.

For a text ValueGroup, a previously saved raw value is not invalid merely because it is unobserved in the latest response set. The explicit user-defined membership remains stored; synthesis feasibility may later report candidate-support limitations if that group is targeted.

### Target review

After the new revision becomes current, validate the saved target draft against that revision. Return the same public target issues used by normal target validation.

The UI translates those issues into user-facing copy and marks affected setup state as `확인 필요`. Raw implementation/solver vocabulary is not shown.

## Local review status

Review diagnostics are derived state, not a one-time refresh notification.

`projects.sourceReview` recomputes the current review status from the Project's current local SourceRevision plus its saved ValueGroups and target draft. It must not contact Google, refresh OAuth, mutate source evidence, or change the current revision.

The renderer may call this local review operation whenever a Project is opened and after the user repairs a group or target. This makes `확인 필요` recoverable after app restart without persisting a separate stale review flag.

The local review result uses the same ValueGroup and target-review semantics as the explicit refresh result.

### Single review authority

Google capture/apply and local review have separate responsibilities.

The Forms service owns only Google identity checks, capture, normalization, and creation/application of the new immutable SourceRevision. It does not decide whether saved ValueGroups or targets need review.

After a successful apply, `projects.refreshSource` obtains ValueGroup and target-draft diagnostics through the same local review calculation used by `projects.sourceReview`. Project reopen and explicit refresh must therefore not have separate copies of review rules.

Changing review semantics should require changing one authoritative review path and its tests, not coordinating a Forms-specific copy with the reopen path.

### Review availability must not block Project open

Project detail is the primary local workspace state. A failure while computing review diagnostics must not prevent the renderer from opening an otherwise readable Project.

The renderer should load the Project first, then obtain local review diagnostics as a secondary operation. If that secondary operation fails, keep the Project open and surface a recoverable error while leaving source evidence and editable setup unchanged.

This rule is about review availability only. A failure to read the Project itself remains a normal Project-open failure.

## Public result

The refresh result should include:

- the updated `ProjectDetailView`,
- the previous SourceRevision id,
- the new current SourceRevision id,
- ValueGroup ids that need review,
- target validation issues for the saved draft.

The local review result should include:

- the Project id,
- the current SourceRevision id,
- ValueGroup ids that need review,
- target validation issues for the saved draft.

This is enough for the renderer to reload authoritative profiling data and surface repair state without reconstructing source/profile semantics.

## UI

Keep the control contextual in the Project workspace rather than adding a source-management page.

The refresh action must make two consequences clear before execution:

- Google Forms is read only; the Form itself is not modified,
- saved historical results stay unchanged.

After success, update the visible source response/question counts and reload the Question Explorer from the new current revision.

If diagnostics exist, show a compact `확인 필요` notice and retain the existing targets/groups so the user can inspect and repair them manually.

When a Project is reopened, restore the same review state from the local review operation without contacting Google.

Every invalid ValueGroup shown in the review dialog must retain an explicit removal path. If the source question still exists, the UI may also offer navigation to that question, but navigation must not be the only repair action when the group itself can no longer be edited there.
