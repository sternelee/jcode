import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Plus, Square } from "lucide-react";
import type { AttachedImage } from "@/types";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";

interface InputAreaProps {
  onSend: (content: string, images?: [string, string][]) => void;
  onCancel: () => void;
  isProcessing: boolean;
  disabled: boolean;
}

export function InputArea({
  onSend,
  onCancel,
  isProcessing,
  disabled,
}: InputAreaProps) {
  const [text, setText] = useState("");
  const [images, setImages] = useState<AttachedImage[]>([]);

  const handleSubmit = () => {
    if (isProcessing || disabled) return;
    const content = text.trim();
    if (!content && images.length === 0) return;
    const tuples: [string, string][] = images.map((i) => [
      i.mediaType,
      i.base64Data,
    ]);
    onSend(content || "(image)", tuples.length > 0 ? tuples : undefined);
    setText("");
    setImages([]);
  };

  const handleAttach = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const sel = await open({
        multiple: false,
        filters: [
          { name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp"] },
        ],
      });
      if (sel) {
        const path = typeof sel === "string" ? sel : sel[0];
        if (path) {
          const res = await fetch(`file://${path}`);
          const blob = await res.blob();
          const reader = new FileReader();
          reader.onload = () => {
            const base64 = (reader.result as string).split(",")[1];
            setImages((p) => [
              ...p,
              {
                id: `img-${Date.now()}`,
                mediaType: blob.type || "image/png",
                base64Data: base64,
              },
            ]);
          };
          reader.readAsDataURL(blob);
        }
      }
    } catch {}
  };

  return (
    <div className="border-t bg-card p-3">
      {images.length > 0 && (
        <div className="flex gap-2 mb-2">
          {images.map((img) => (
            <div key={img.id} className="relative">
              <img
                src={`data:${img.mediaType};base64,${img.base64Data}`}
                className="w-14 h-14 rounded-lg object-cover border"
              />
              <button
                onClick={() =>
                  setImages((p) => p.filter((i) => i.id !== img.id))
                }
                className="absolute -top-1.5 -right-1.5 bg-destructive text-white rounded-full w-4 h-4 flex items-center justify-center text-[10px]"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <PromptInput onSubmit={handleSubmit} className="relative">
        <PromptInputBody>
          <PromptInputTextarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              disabled
                ? "Select a workspace and start a session..."
                : "Type a message... (Enter to send, Shift+Enter for newline)"
            }
            className="min-h-10 max-h-48 resize-none"
          />
        </PromptInputBody>
        <PromptInputFooter>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={handleAttach}
              disabled={disabled}
              className="h-10 w-10 shrink-0"
            >
              <Plus className="w-4 h-4" />
            </Button>
            {isProcessing ? (
              <Button
                variant="destructive"
                size="icon"
                onClick={onCancel}
                className="h-10 w-10 shrink-0"
              >
                <Square className="w-4 h-4 fill-current" />
              </Button>
            ) : (
              <PromptInputSubmit
                status={isProcessing ? "streaming" : "ready"}
                disabled={!text.trim() && images.length === 0}
                className="h-10 w-10 shrink-0"
              />
            )}
          </div>
        </PromptInputFooter>
      </PromptInput>
    </div>
  );
}