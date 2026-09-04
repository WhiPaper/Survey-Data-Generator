import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export type ApiKeyDialogProps = {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSave: (key: string) => void;
  readonly pending: boolean;
  readonly error?: string;
};

export function ApiKeyDialog({
  open,
  onOpenChange,
  onSave,
  pending,
  error,
}: ApiKeyDialogProps) {
  const [apiKeyInput, setApiKeyInput] = useState("");

  const handleClose = () => {
    onOpenChange(false);
    setApiKeyInput("");
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
        if (!nextOpen) setApiKeyInput("");
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>OpenAI API 키 설정</DialogTitle>
          <DialogDescription>
            입력한 키는 안전한 저장소에만 보관됩니다.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="openai-api-key">API 키</FieldLabel>
            <Input
              id="openai-api-key"
              type="password"
              placeholder="sk-..."
              value={apiKeyInput}
              onChange={(event) => setApiKeyInput(event.target.value)}
              disabled={pending}
            />
          </Field>
          {error && <FieldError>{error}</FieldError>}
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={pending}>
            취소
          </Button>
          <Button
            onClick={() => onSave(apiKeyInput)}
            disabled={pending || apiKeyInput.trim() === ""}
          >
            저장
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export type AiDisclosureDialogProps = {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onAgree: () => void;
  readonly pending: boolean;
  readonly error?: string;
};

export function AiDisclosureDialog({
  open,
  onOpenChange,
  onAgree,
  pending,
  error,
}: AiDisclosureDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>AI 텍스트 생성 안내</DialogTitle>
          <DialogDescription>
            설문 문항과 비식별화된 일부 예시가 OpenAI로 전송됩니다. 이름과 연락처 같은
            개인식별정보는 전송하지 않습니다.
          </DialogDescription>
        </DialogHeader>
        {error && <FieldError>{error}</FieldError>}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            취소
          </Button>
          <Button onClick={onAgree} disabled={pending}>
            동의 및 계속
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

