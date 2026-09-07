import { useMemo, useState } from "react";

import type {
  TargetDraftTarget,
  TargetProfileResult,
  ValueGroupObservedValue,
  ValueGroupView,
} from "@survey-synth/contracts";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  subjectTarget,
  targetSummary,
  valueGroupMetric,
  type EditingTarget,
  type QuestionView,
} from "./model";

type GroupDraft = {
  group: ValueGroupView | null;
  name: string;
  members: string[];
};

type TextInspectorProps = {
  question: QuestionView;
  groups: ValueGroupView[];
  values: ValueGroupObservedValue[];
  targets: TargetDraftTarget[];
  profile: TargetProfileResult | null;
  busy: boolean;
  onOpenTarget: (editing: EditingTarget) => void;
  onSaveGroup: (previous: ValueGroupView | null, name: string, members: string[]) => Promise<void>;
  onDeleteGroup: (group: ValueGroupView) => void;
};

export function TextInspector({
  question,
  groups,
  values,
  targets,
  profile,
  busy,
  onOpenTarget,
  onSaveGroup,
  onDeleteGroup,
}: TextInspectorProps) {
  const [query, setQuery] = useState("");
  const [groupQuery, setGroupQuery] = useState("");
  const [draft, setDraft] = useState<GroupDraft | null>(null);

  const questionGroups = groups.filter((group) => group.questionId === question.id);
  const filteredValues = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return values;
    return values.filter((value) => value.label.toLocaleLowerCase().includes(normalized));
  }, [query, values]);
  const filteredGroupValues = useMemo(() => {
    const normalized = groupQuery.trim().toLocaleLowerCase();
    if (!normalized) return values;
    return values.filter((value) => value.label.toLocaleLowerCase().includes(normalized));
  }, [groupQuery, values]);

  const openGroup = (group: ValueGroupView | null) => {
    setDraft({
      group,
      name: group?.name ?? "",
      members: group?.members ?? [],
    });
    setGroupQuery("");
  };

  const saveGroup = async () => {
    if (!draft || !draft.name.trim() || draft.members.length === 0) return;
    await onSaveGroup(draft.group, draft.name.trim(), draft.members);
    setDraft(null);
  };

  return (
    <>
      <div className="mt-7 grid gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)]">
        <section className="min-w-0">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-medium">응답 그룹</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                실제 응답 값을 직접 선택해 그룹을 만듭니다. 같은 값이 여러 그룹에 포함되어도 됩니다.
              </p>
            </div>
            <Button type="button" size="sm" variant="outline" onClick={() => openGroup(null)}>
              그룹 만들기
            </Button>
          </div>

          <div className="mt-4 divide-y border-y">
            {questionGroups.map((group) => {
              const metric = valueGroupMetric(profile, group.id);
              const editing: EditingTarget = {
                subjectKind: "value_group",
                questionId: question.id,
                questionTitle: question.title,
                label: group.name,
                valueGroupId: group.id,
              };
              const target = subjectTarget(targets, editing);
              const overlapCount = questionGroups.filter(
                (candidate) =>
                  candidate.id !== group.id &&
                  candidate.members.some((member) => group.members.includes(member)),
              ).length;

              return (
                <div key={group.id} className="flex items-center gap-2 py-3">
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => onOpenTarget(editing)}
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-sm font-medium">{group.name}</span>
                      <span className="shrink-0 text-sm tabular-nums">
                        {metric?.count ?? 0}명 · {((metric?.share ?? 0) * 100).toFixed(1)}%
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      값 {group.members.length}개
                      {overlapCount > 0 ? ` · 다른 그룹 ${overlapCount}개와 일부 겹침` : ""}
                      {target
                        ? ` · ${targetSummary(target, metric?.share ?? 0) ?? "목표 있음"}`
                        : ""}
                    </p>
                  </button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => openGroup(group)}>
                    편집
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    disabled={busy}
                    onClick={() => onDeleteGroup(group)}
                  >
                    삭제
                  </Button>
                </div>
              );
            })}
            {questionGroups.length === 0 ? (
              <p className="py-5 text-sm text-muted-foreground">
                아직 그룹이 없습니다. 먼저 실제 응답 값을 묶어 그룹을 만드세요.
              </p>
            ) : null}
          </div>
        </section>

        <section className="min-w-0 border-l pl-6">
          <h3 className="text-sm font-medium">원본 응답 값</h3>
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="응답 값 검색..."
            className="mt-3 h-8"
          />
          <div className="mt-2 max-h-[360px] divide-y overflow-y-auto">
            {filteredValues.slice(0, 80).map((value) => (
              <div
                key={value.value}
                className="flex items-center justify-between gap-3 py-2 text-sm"
              >
                <span className="min-w-0 truncate">{value.label}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{value.count}명</span>
              </div>
            ))}
            {filteredValues.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">일치하는 응답 값이 없습니다.</p>
            ) : null}
          </div>
        </section>
      </div>

      <Sheet open={draft !== null} onOpenChange={(open) => !open && setDraft(null)}>
        <SheetContent className="sm:max-w-[520px]">
          <SheetHeader>
            <SheetTitle>{draft?.group ? "그룹 편집" : "그룹 만들기"}</SheetTitle>
            <SheetDescription>
              이름과 포함할 실제 응답 값을 확인한 뒤 변경사항을 적용합니다.
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-5 px-4 py-5">
            <div className="space-y-2">
              <label className="text-sm font-medium">이름</label>
              <Input
                value={draft?.name ?? ""}
                onChange={(event) =>
                  setDraft((current) =>
                    current ? { ...current, name: event.target.value } : current,
                  )
                }
                placeholder="예: 재구매 의향 있음"
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <Input
                value={groupQuery}
                onChange={(event) => setGroupQuery(event.target.value)}
                placeholder="응답 값 검색..."
                className="h-8"
              />
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {draft?.members.length ?? 0}개 선택
              </span>
            </div>
            <div className="max-h-[360px] divide-y overflow-y-auto border-y">
              {filteredGroupValues.map((value) => (
                <label
                  key={value.value}
                  className="flex cursor-pointer items-center gap-3 py-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={draft?.members.includes(value.value) ?? false}
                    onChange={(event) =>
                      setDraft((current) => {
                        if (!current) return current;
                        return {
                          ...current,
                          members: event.target.checked
                            ? [...current.members, value.value]
                            : current.members.filter((member) => member !== value.value),
                        };
                      })
                    }
                  />
                  <span className="min-w-0 flex-1 truncate">{value.label}</span>
                  <span className="tabular-nums text-muted-foreground">{value.count}명</span>
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              저장된 그룹의 현재 인원수와 비율은 backend profile 값을 사용합니다.
            </p>
          </div>
          <SheetFooter>
            <Button type="button" variant="outline" onClick={() => setDraft(null)}>
              취소
            </Button>
            <Button
              type="button"
              disabled={busy || !draft?.name.trim() || draft.members.length === 0}
              onClick={() => void saveGroup()}
            >
              {busy ? "적용 중…" : "변경 적용"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
