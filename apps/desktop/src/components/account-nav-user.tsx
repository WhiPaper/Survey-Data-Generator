import { ChevronsUpDownIcon } from "lucide-react";

import type { GoogleAccountId, SessionView } from "@survey-synth/contracts";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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

export type AccountNavUserProps = {
  readonly session: SessionView;
  readonly accounts: readonly { readonly id: GoogleAccountId; readonly email: string }[];
  readonly busy: boolean;
  readonly onSwitchAccount: (id: GoogleAccountId) => void;
  readonly onAddAccount: () => void;
  readonly onLogout: () => void;
  readonly onRevoke: () => void;
  readonly onClearAiCredentials: () => void;
  readonly showAiClear: boolean;
  readonly onDeleteData: (id: GoogleAccountId) => void;
};

export function AccountNavUser({
  session,
  accounts,
  busy,
  onSwitchAccount,
  onAddAccount,
  onLogout,
  onRevoke,
  onClearAiCredentials,
  showAiClear,
  onDeleteData,
}: AccountNavUserProps) {
  const name = session.account.displayName ?? session.account.email.split("@")[0] ?? session.account.email;

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton size="lg" tooltip="계정">
                <Avatar>
                  {session.account.avatarUrl !== undefined && (
                    <AvatarImage src={session.account.avatarUrl} alt="" />
                  )}
                  <AvatarFallback>{name.slice(0, 1).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{name}</span>
                  <span className="truncate text-xs">{session.account.email}</span>
                </div>
                <ChevronsUpDownIcon className="ml-auto" />
              </SidebarMenuButton>
            }
          />
          <DropdownMenuContent side="right" align="end" className="min-w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="max-w-56 truncate">{session.account.email}</DropdownMenuLabel>
              {accounts.map((account) => (
                <DropdownMenuItem
                  key={account.id}
                  onClick={() => onSwitchAccount(account.id)}
                  disabled={busy || account.id === session.account.id}
                >
                  <span className="min-w-0 truncate">{account.email}</span>
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem onClick={onAddAccount} disabled={busy}>
                Google 계정 추가
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onLogout} disabled={busy}>
                로그아웃
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={onRevoke} disabled={busy}>
                Google 접근 권한 해제
              </DropdownMenuItem>
              {showAiClear && (
                <DropdownMenuItem
                  variant="destructive"
                  onClick={onClearAiCredentials}
                  disabled={busy}
                >
                  AI 키 제거
                </DropdownMenuItem>
              )}
              {accounts.map((account) => (
                <DropdownMenuItem
                  key={`${account.id}-delete`}
                  variant="destructive"
                  onClick={() => onDeleteData(account.id)}
                  disabled={busy}
                >
                  <span className="min-w-0 truncate">{account.email} 기기 데이터 삭제</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
