import {
  ChevronsUpDownIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";

export type ProjectSwitcherProps = {
  readonly projects: readonly { readonly id: string; readonly name: string }[];
  readonly selectedProjectId: string | null;
  readonly onProjectSelect: (id: string) => void;
  readonly onNewProject: () => void;
  readonly onRefresh: () => void;
  readonly onDelete: () => void;
  readonly refreshDisabled: boolean;
  readonly deleteDisabled: boolean;
};

export function ProjectSwitcher({
  projects,
  selectedProjectId,
  onProjectSelect,
  onNewProject,
  onRefresh,
  onDelete,
  refreshDisabled,
  deleteDisabled,
}: ProjectSwitcherProps) {
  const selected = projects.find((project) => project.id === selectedProjectId);

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton size="lg" tooltip="프로젝트">
                <FolderOpenIcon />
                <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{selected?.name ?? "프로젝트"}</span>
                </div>
                <ChevronsUpDownIcon className="ml-auto" />
              </SidebarMenuButton>
            }
          />
          <DropdownMenuContent side="right" align="start" className="min-w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel>프로젝트</DropdownMenuLabel>
              {projects.map((project) => (
                <DropdownMenuItem
                  key={project.id}
                  onClick={() => onProjectSelect(project.id)}
                  disabled={project.id === selectedProjectId}
                >
                  <FolderOpenIcon />
                  <span className="min-w-0 truncate">{project.name}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={onNewProject}>
                <FolderPlusIcon />새 프로젝트
              </DropdownMenuItem>
            </DropdownMenuGroup>
            {selected !== undefined && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={onRefresh} disabled={refreshDisabled}>
                    <RefreshCwIcon />새 응답 가져오기
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={onDelete}
                    disabled={deleteDisabled}
                  >
                    <Trash2Icon />
                    프로젝트 삭제
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
