import { useState, FormEvent } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { StdinPrompt } from "@/types";

interface StdinInputModalProps {
  prompt: StdinPrompt;
  onSubmit: (requestId: string, input: string) => void;
}

export function StdinInputModal({ prompt, onSubmit }: StdinInputModalProps) {
  const [value, setValue] = useState("");

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit(prompt.requestId, value);
  };

  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-primary">
            Tool input required
          </DialogTitle>
          <p className="text-xs text-muted-foreground font-mono mt-1">
            {prompt.toolCallId}
          </p>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <p className="text-sm text-muted-foreground mb-3 whitespace-pre-wrap break-words">
            {prompt.prompt || "Enter input:"}
          </p>
          <Input
            type={prompt.isPassword ? "password" : "text"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
            placeholder={prompt.isPassword ? "Password..." : "Input..."}
          />
          <DialogFooter className="mt-4">
            <Button type="submit">Submit</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
