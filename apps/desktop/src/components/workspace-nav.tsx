import { FileTextIcon, HomeIcon, SlidersHorizontalIcon, SparklesIcon } from "lucide-react";

import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import type { WorkspaceView } from "@/hooks/use-workspace-route";

export type { WorkspaceView } from "@/hooks/use-workspace-route";

export type WorkspaceNavProps = {
  readonly view: WorkspaceView;
  readonly onChange: (view: WorkspaceView) => void;
};

export function WorkspaceNav({ view, onChange }: WorkspaceNavProps) {
  const items: readonly {
    readonly view: WorkspaceView;
    readonly label: string;
    readonly icon: typeof HomeIcon;
  }[] = [
    { view: "home", label: "홈", icon: HomeIcon },
    { view: "survey", label: "설문", icon: FileTextIcon },
    { view: "targets", label: "목표", icon: SlidersHorizontalIcon },
    { view: "results", label: "결과", icon: SparklesIcon },
  ];

  return (
    <SidebarMenu>
      {items.map((item) => (
        <SidebarMenuItem key={item.view}>
          <SidebarMenuButton
            isActive={view === item.view}
            tooltip={item.label}
            onClick={() => onChange(item.view)}
          >
            <item.icon />
            <span>{item.label}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  );
}
