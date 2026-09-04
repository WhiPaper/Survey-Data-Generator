import type { FormId, FormListItem } from "@survey-synth/contracts";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldError, FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

export type NewProjectDialogProps = {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly formQuery: string;
  readonly onFormQueryChange: (query: string) => void;
  readonly forms: readonly FormListItem[];
  readonly formsLoading: boolean;
  readonly formsError?: string;
  readonly importBusy: boolean;
  readonly importError?: string;
  readonly cancelError?: string;
  readonly cancelPending: boolean;
  readonly hasNextPage: boolean;
  readonly isFetchingNextPage: boolean;
  readonly onFetchNextPage: () => void;
  readonly importStatus?: string;
  readonly onImport: (formId: FormId) => void;
  readonly onCancelImport: () => void;
  readonly busy: boolean;
};

export const formatModifiedAt = (value: string | undefined): string | undefined => {
  if (value === undefined) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toLocaleString();
};

export function NewProjectDialog({
  open,
  onOpenChange,
  formQuery,
  onFormQueryChange,
  forms,
  formsLoading,
  formsError,
  importBusy,
  importError,
  cancelError,
  cancelPending,
  hasNextPage,
  isFetchingNextPage,
  onFetchNextPage,
  importStatus,
  onImport,
  onCancelImport,
  busy,
}: NewProjectDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
        if (!nextOpen && !importBusy) onFormQueryChange("");
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>새 프로젝트</DialogTitle>
        </DialogHeader>
        <FieldGroup>
          <Input
            id="form-search"
            type="search"
            aria-label="Google Form 검색"
            placeholder="Google Form 검색"
            value={formQuery}
            onChange={(event) => onFormQueryChange(event.target.value)}
            disabled={importBusy}
          />
          {formsError !== undefined && <FieldError>{formsError}</FieldError>}
          {importError !== undefined && <FieldError>{importError}</FieldError>}
          {cancelError !== undefined && <FieldError>{cancelError}</FieldError>}
          {formsLoading && <Spinner aria-label="Google Forms 불러오는 중" />}
          {!formsLoading && forms.length === 0 && formsError === undefined && (
            <p className="text-sm text-muted-foreground">Google Form이 없습니다.</p>
          )}
          <ul className="form-list max-h-80 overflow-y-auto">
            {forms.map((form) => {
              const modifiedAt = formatModifiedAt(form.modifiedAt);
              return (
                <li key={form.formId}>
                  <Button
                    className="form-item"
                    variant="ghost"
                    onClick={() => onImport(form.formId)}
                    disabled={busy}
                  >
                    <span>{form.title}</span>
                    {modifiedAt !== undefined && (
                      <time dateTime={form.modifiedAt}>{modifiedAt}</time>
                    )}
                  </Button>
                </li>
              );
            })}
          </ul>
          {hasNextPage && (
            <Button
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={onFetchNextPage}
              disabled={busy || isFetchingNextPage}
            >
              더 보기
            </Button>
          )}
          {importStatus !== undefined && (
            <p role="status" className="text-sm text-muted-foreground">
              {importStatus}
            </p>
          )}
        </FieldGroup>
        <DialogFooter>
          {importBusy && (
            <Button variant="outline" onClick={onCancelImport} disabled={cancelPending}>
              {cancelPending ? "가져오기 취소 중…" : "가져오기 취소"}
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={importBusy}
          >
            취소
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

