import { useEffect, useState, type FormEvent } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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
          <div className="flex items-center gap-3">
            <div className={cn(
              "w-9 h-9 rounded-xl flex items-center justify-center shrink-0",
              prompt.isPassword ? "bg-amber-500/10 text-amber-500" : "bg-primary/10 text-primary",
            )}>
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-[18px] h-[18px]">
                <path d="M8 1a3 3 0 00-3 3v3H4a2 2 0 00-2 2v4a2 2 0 002 2h8a2 2 0 002-2V9a2 2 0 00-2-2h-1V4a3 3 0 00-3-3zM6 7V4a2 2 0 114 0v3H6zm1 3.75a.75.75 0 011.5 0v1.5a.75.75 0 01-1.5 0v-1.5z" clipRule="evenodd" />
              </svg>
            </div>
            <div>
              <DialogTitle className="text-[15px]">
                {prompt.isPassword ? "Password Required" : "Input Required"}
              </DialogTitle>
              <DialogDescription className="text-[12px] mt-0.5">
                tool: {prompt.toolCallId || "unknown"} · request: {prompt.requestId.slice(0, 8)}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 px-1">
          <div className="space-y-2">
            <p className="text-[13px] text-foreground leading-relaxed whitespace-pre-wrap break-words bg-muted/30 rounded-lg p-3 border border-border">
              {promptText}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {prompt.isPassword
                ? "This input is masked and will not be visible in conversation history."
                : "Queued drafts stay paused until this request is answered."}
            </p>
          </div>

          {prompt.isPassword ? (
            <Input
              type="password"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoFocus
              placeholder="Enter password…"
              className="text-sm"
            />
          ) : (
            <Textarea
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoFocus
              placeholder="Enter input…"
              className="min-h-24 resize-y text-sm"
            />
          )}

          <DialogFooter>
            <div className="mr-auto text-[11px] text-muted-foreground">
              {prompt.isPassword ? "Enter to submit" : "Enter to submit · Shift+Enter for newline"}
            </div>
            <Button type="submit" className="text-sm">
              Submit
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
