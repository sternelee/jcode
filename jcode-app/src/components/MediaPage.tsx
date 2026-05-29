import { useState, useMemo } from "react";
import type { ChatMessage, AttachedImage } from "@/types";
import { Image, X, Download, Clock, User } from "lucide-react";

interface MediaPageProps {
	sessionData: Record<string, { messages: ChatMessage[]; title?: string }>;
}

interface MediaItem {
	id: string;
	src: string;
	label: string;
	roleName?: string;
	sessionTitle?: string;
	timestamp?: number;
	msgId: string;
}

export function MediaPage({ sessionData }: MediaPageProps) {
	const [lightbox, setLightbox] = useState<MediaItem | null>(null);

	const items = useMemo(() => {
		const result: MediaItem[] = [];
		for (const [sessionId, data] of Object.entries(sessionData)) {
			const title = data.title || sessionId;
			for (const msg of data.messages) {
				if (!msg.images || msg.images.length === 0) continue;
				for (const img of msg.images) {
					const src = imageSrc(img);
					if (!src) continue;
					result.push({
						id: `${msg.id}-${img.id}`,
						src,
						label: img.label || msg.content.slice(0, 60) || "Generated image",
						roleName: msg.roleName,
						sessionTitle: title,
						timestamp: msg.timestamp,
						msgId: msg.id,
					});
				}
			}
		}
		return result.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
	}, [sessionData]);

	return (
		<div className="flex-1 flex flex-col bg-card overflow-hidden">
			{/* Header */}
			<div className="px-6 py-4 border-b border-border flex items-center justify-between shrink-0">
				<div className="flex items-center gap-3">
					<div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
						<Image className="w-5 h-5" />
					</div>
					<div>
						<h1 className="text-[16px] font-semibold text-foreground">Media</h1>
						<p className="text-[12px] text-muted-foreground">
							{items.length} image{items.length !== 1 ? "s" : ""}
						</p>
					</div>
				</div>
			</div>

			{/* Content */}
			<div className="flex-1 overflow-y-auto px-6 py-4">
				{items.length === 0 ? (
					<div className="flex flex-col items-center justify-center py-16 text-center">
						<Image className="w-10 h-10 text-muted-foreground/30 mb-3" />
						<p className="text-[14px] text-muted-foreground">No images yet</p>
						<p className="text-[12px] text-muted-foreground/60 mt-1">
							AI-generated images will appear here
						</p>
					</div>
				) : (
					<div className="max-w-5xl mx-auto">
						<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
							{items.map((item) => (
								<button
									key={item.id}
									type="button"
									onClick={() => setLightbox(item)}
									className="group relative aspect-square rounded-xl overflow-hidden border border-border bg-muted hover:border-primary/30 transition-all"
								>
									<img
										src={item.src}
										alt={item.label}
										className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
										loading="lazy"
									/>
									<div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-2 opacity-0 group-hover:opacity-100 transition-opacity">
										<p className="text-[11px] text-white font-medium truncate">
											{item.label}
										</p>
									</div>
								</button>
							))}
						</div>
					</div>
				)}
			</div>

			{/* Lightbox */}
			{lightbox && (
				<div
					className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center animate-fade-in"
					onClick={() => setLightbox(null)}
				>
					<div className="relative max-w-[90vw] max-h-[90vh] flex flex-col items-center gap-3">
						<button
							type="button"
							onClick={() => setLightbox(null)}
							className="absolute -top-10 right-0 w-8 h-8 rounded-lg bg-white/10 text-white flex items-center justify-center hover:bg-white/20 transition-colors"
						>
							<X className="w-4 h-4" />
						</button>
						<img
							src={lightbox.src}
							alt={lightbox.label}
							className="max-w-full max-h-[80vh] object-contain rounded-xl shadow-2xl"
							onClick={(e) => e.stopPropagation()}
						/>
						<div className="flex items-center gap-3 text-white/70 text-[12px]">
							{lightbox.roleName && (
								<span className="flex items-center gap-1">
									<User className="w-3 h-3" />
									{lightbox.roleName}
								</span>
							)}
							<span className="flex items-center gap-1">
								<Clock className="w-3 h-3" />
								{lightbox.timestamp
									? new Date(lightbox.timestamp).toLocaleString()
									: "Unknown"}
							</span>
							<button
								type="button"
								onClick={(e) => {
									e.stopPropagation();
									const a = document.createElement("a");
									a.href = lightbox.src;
									a.download = `jcode-${lightbox.id}.png`;
									a.click();
								}}
								className="flex items-center gap-1 hover:text-white transition-colors"
							>
								<Download className="w-3 h-3" />
								Download
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}

function imageSrc(image: AttachedImage): string | null {
	if (image.base64Data)
		return `data:${image.mediaType};base64,${image.base64Data}`;
	if (image.filePath) return image.filePath;
	return null;
}
