import { useEffect, useState, FormEvent } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import type { StdinPrompt } from "@/types";

interface StdinInputModalProps {
  prompt: StdinPrompt;
  onSubmit: (requestId: string, input: string) => void;
}

export function StdinInputModal({ prompt, onSubmit }: StdinInputModalProps) {
  const [value, setValue] = useState("");

  useEffect(() => {
    setValue("");
  }, [prompt.requestId]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit(prompt.requestId, value);
  };

  const promptText = prompt.prompt?.trim() || "Interactive input requested";

  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-lg" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="text-primary">
            {prompt.isPassword ? "Password input required" : "Interactive input required"}
          </DialogTitle>
          <div className="mt-1 space-y-1 text-xs text-muted-foreground font-mono">
            <div>tool: {prompt.toolCallId || "unknown"}</div>
            <div>request: {prompt.requestId}</div>
          </div>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground whitespace-pre-wrap break-words">
              {promptText}
            </p>
            <p className="text-xs text-muted-foreground">
              {prompt.isPassword
                ? "Sensitive input is masked locally and queued drafts stay paused until this request is answered."
                : "Queued drafts stay paused until this request is answered."}
            </p>
          </div>

          {prompt.isPassword ? (
            <Input
              type="password"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoFocus
              placeholder="Password..."
            />
          ) : (
            <Textarea
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoFocus
              placeholder="Input..."
              className="min-h-24 resize-y"
            />
          )}

          <DialogFooter>
            <div className="mr-auto text-xs text-muted-foreground">
              {prompt.isPassword
                ? "Enter submits"
                : "Enter submits · use Shift+Enter for newline if your platform supports it"}
            </div>
            <Button type="submit">Submit</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
