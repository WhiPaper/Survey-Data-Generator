import { useEffect, useState } from "react";
import { ChevronRightIcon, FileTextIcon, FolderIcon, GitBranchIcon } from "lucide-react";

import type { FormSnapshot } from "@survey-synth/domain";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";

export type SurveyTreeProps = {
  readonly form: FormSnapshot | null;
  readonly selectedQuestionId: string | null;
  readonly onQuestionSelect: (questionId: string) => void;
};

export function SurveyTree({ form, selectedQuestionId, onQuestionSelect }: SurveyTreeProps) {
  const [openSectionIds, setOpenSectionIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (form === null || selectedQuestionId === null) return;
    const selectedSection = form.sections.find((section) =>
      section.questionIds.some((questionId) => String(questionId) === selectedQuestionId),
    );
    if (selectedSection === undefined) return;
    const sectionId = String(selectedSection.id);
    setOpenSectionIds((current) => {
      if (current.has(sectionId)) return current;
      return new Set(current).add(sectionId);
    });
  }, [form, selectedQuestionId]);

  if (form === null) return null;
  const questionById = new Map(form.questions.map((question) => [question.id, question]));
  const sectionById = new Map(form.sections.map((section) => [section.id, section]));

  const destinationLabel = (
    destination: FormSnapshot["logic"]["transitions"][number]["destination"],
  ) => {
    if (destination.type === "section")
      return sectionById.get(destination.sectionId)?.title ?? "섹션";
    if (destination.type === "submit") return "제출";
    if (destination.type === "restart") return "다시 시작";
    return "다음 섹션";
  };

  const firstQuestionInSection = (sectionId: string): string | undefined => {
    const section = form.sections.find((item) => String(item.id) === sectionId);
    const questionId = section?.questionIds[0];
    return questionId === undefined ? undefined : String(questionId);
  };

  const destinationQuestionId = (
    question: FormSnapshot["questions"][number],
    destination: FormSnapshot["logic"]["transitions"][number]["destination"],
  ): string => {
    if (destination.type === "section") {
      return firstQuestionInSection(String(destination.sectionId)) ?? String(question.id);
    }
    if (destination.type === "next_section") {
      const sourceSection = form.logic.sections.find((section) =>
        section.questionIds.includes(question.id),
      );
      const nextSectionId = sourceSection?.nextSectionId;
      return nextSectionId === undefined
        ? String(question.id)
        : (firstQuestionInSection(String(nextSectionId)) ?? String(question.id));
    }
    return String(question.id);
  };

  return (
    <>
      <SidebarGroup className="group-data-[collapsible=icon]:hidden">
        <SidebarGroupLabel>설문</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {form.sections.map((section) => (
              <SidebarMenuItem key={section.id}>
                <Collapsible
                  className="group/collapsible [&[data-state=open]>button>svg:first-child]:rotate-90"
                  open={openSectionIds.has(String(section.id))}
                  onOpenChange={(open) => {
                    setOpenSectionIds((current) => {
                      const next = new Set(current);
                      if (open) next.add(String(section.id));
                      else next.delete(String(section.id));
                      return next;
                    });
                  }}
                >
                  <CollapsibleTrigger
                    render={
                      <SidebarMenuButton tooltip={section.title}>
                        <ChevronRightIcon className="transition-transform" />
                        <FolderIcon />
                        <span>{section.title}</span>
                      </SidebarMenuButton>
                    }
                  />
                  <CollapsibleContent>
                    <SidebarMenuSub>
                      {section.questionIds.flatMap((questionId) => {
                        const question = questionById.get(questionId);
                        if (question === undefined) return [];
                        const transitions = form.logic.transitions.filter(
                          (transition) => transition.sourceQuestionId === question.id,
                        );
                        return [
                          <SidebarMenuSubItem key={question.id}>
                            <SidebarMenuSubButton
                              render={<button type="button" />}
                              isActive={String(question.id) === selectedQuestionId}
                              onClick={() => onQuestionSelect(String(question.id))}
                            >
                              {question.affectsNavigation ? <GitBranchIcon /> : <FileTextIcon />}
                              <span>{question.title}</span>
                            </SidebarMenuSubButton>
                            {transitions.length > 0 && (
                              <SidebarMenuSub>
                                {transitions.map((transition) => {
                                  const option =
                                    "options" in question
                                      ? question.options.find(
                                          (item) => item.key === transition.optionKey,
                                        )
                                      : undefined;
                                  return (
                                    <SidebarMenuSubItem
                                      key={`${question.id}-${transition.optionKey}`}
                                    >
                                      <SidebarMenuSubButton
                                        render={<button type="button" />}
                                        onClick={() =>
                                          onQuestionSelect(
                                            destinationQuestionId(question, transition.destination),
                                          )
                                        }
                                      >
                                        <GitBranchIcon />
                                        <span className="truncate">{`${option?.label ?? "선택지"} → ${destinationLabel(
                                          transition.destination,
                                        )}`}</span>
                                      </SidebarMenuSubButton>
                                    </SidebarMenuSubItem>
                                  );
                                })}
                              </SidebarMenuSub>
                            )}
                          </SidebarMenuSubItem>,
                        ];
                      })}
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </Collapsible>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </>
  );
}
