import { useEffect, useState } from "react";
import { CommandItem } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import {
	Key,
	Layers,
	MessageSquare,
	MessageSquareText,
	Plug,
	Settings,
	Sparkles,
	Users,
	XCircle,
} from "lucide-react";
import type { AppInfo, LauncherItem } from "@/lib/launcherTypes";
import { appIconUrl } from "@/hooks/useLauncher";

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
	key: Key,
	users: Users,
	sparkles: Sparkles,
	plug: Plug,
	settings: Settings,
	message: MessageSquare,
};

function AppIcon({ appPath, name, base64 }: { appPath: string; name: string; base64?: string | null }) {
	const url = appIconUrl(appPath, base64);
	const [errored, setErrored] = useState(false);
	useEffect(() => {
		setErrored(false);
	}, [url]);
	const initials = computeInitials(name);
	if (!url || errored) {
		return (
			<div
				className="size-8 rounded-md bg-muted flex items-center justify-center text-muted-foreground text-[11px] font-semibold uppercase shrink-0 tracking-wider"
				aria-hidden="true"
			>
				{initials}
			</div>
		);
	}
	return (
		<img
			src={url}
			alt=""
			width={32}
			height={32}
			className="size-8 rounded-md object-contain bg-white/5 shrink-0"
			draggable={false}
			onError={() => setErrored(true)}
		/>
	);
}

/** Pick two visually distinct letters from an app name. Falls back to "?". */
function computeInitials(name: string): string {
	const trimmed = name.trim();
	if (!trimmed) return "?";
	const tokens = trimmed.split(/\s+/).filter(Boolean);
	if (tokens.length >= 2) {
		return (tokens[0]![0]! + tokens[1]![0]!).toUpperCase();
	}
	if (trimmed.length === 1) return trimmed.toUpperCase();
	return trimmed.slice(0, 2).toUpperCase();
}

function BuiltinIcon({ name }: { name: string }) {
	const Icon = ICON_MAP[name] ?? MessageSquare;
	return (
		<div
			className="size-8 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0"
			aria-hidden="true"
		>
			<Icon className="size-4" />
		</div>
	);
}

export interface LauncherCommandItemProps {
	item: LauncherItem;
	onSelect: (item: LauncherItem) => void;
	active: boolean;
	disabled?: boolean;
	/** Optional search query used to highlight matched characters in titles. */
	highlight?: string;
	/** Stop (quit) an application. Invoked when the user clicks the
	 * inline `Stop` button on a running-app row. */
	onStopApp?: (app: AppInfo) => void;
	/** Zero-based position in the flat item list, used to render a
	 * `⌘n` quick-select hint for the first nine items. */
	index?: number;
}

function valueOf(item: LauncherItem): string {
	switch (item.kind) {
		case "application":
			return `app:${item.app.name} ${item.app.bundleId ?? ""} ${item.app.appPath}`;
		case "session":
			return `session:${item.session.title} ${item.session.subtitle ?? ""} ${item.session.workingDir ?? ""}`;
		case "builtin":
			return `builtin:${item.title} ${item.keyword} ${item.page}`;
		case "agent":
			return `agent:${item.query}`;
		case "a2ui":
			return `a2ui:${item.pageId} ${item.title}`;
	}
}

export function LauncherCommandItem({
	item,
	onSelect,
	active,
	disabled,
	highlight,
	onStopApp,
	index,
}: LauncherCommandItemProps) {
	const handleSelect = () => {
		if (disabled) return;
		onSelect(item);
	};
	const value = valueOf(item);
	const showQuickHint = index !== undefined && index >= 0 && index < 9;

	return (
		<CommandItem
			value={value}
			onSelect={handleSelect}
			disabled={disabled}
			className={cn(
				"group/item px-3 py-2 rounded-lg cursor-default flex items-center gap-3",
				active && "bg-muted/70",
				disabled && "opacity-50",
			)}
		>
			<Body
				item={item}
				highlight={highlight}
				onStopApp={onStopApp}
				quickHint={showQuickHint ? index! + 1 : undefined}
			/>
		</CommandItem>
	);
}

function formatAppSubtitle(app: AppInfo): string {
	const parts: string[] = [];
	if (app.bundleId) parts.push(app.bundleId);
	if (app.version) parts.push(`v${app.version}`);
	if (parts.length === 0) return "Application";
	return parts.join(" • ");
}

/** Bold the substring that matches the user's query (case-insensitive). */
function Highlight({
	text,
	query,
}: {
	text: string;
	query?: string;
}) {
	if (!query) return <>{text}</>;
	const lower = text.toLowerCase();
	const needle = query.toLowerCase().trim();
	if (!needle) return <>{text}</>;
	const idx = lower.indexOf(needle);
	if (idx === -1) return <>{text}</>;
	const before = text.slice(0, idx);
	const match = text.slice(idx, idx + needle.length);
	const after = text.slice(idx + needle.length);
	return (
		<>
			{before}
			<span className="font-semibold text-foreground">{match}</span>
			{after}
		</>
	);
}

function formatSessionSubtitle(session: { subtitle?: string; workingDir?: string; status?: string }): string {
	const parts: string[] = [];
	if (session.subtitle) {
		parts.push(session.subtitle);
	} else if (session.workingDir) {
		parts.push(session.workingDir.split("/").filter(Boolean).pop() || session.workingDir);
	} else {
		parts.push("Default workspace");
	}
	if (session.status && session.status !== "idle") {
		parts.push(session.status);
	}
	return parts.join(" • ");
}

function Body({
	item,
	highlight,
	onStopApp,
	quickHint,
}: {
	item: LauncherItem;
	highlight?: string;
	onStopApp?: (app: AppInfo) => void;
	quickHint?: number;
}) {
	switch (item.kind) {
		case "application":
			return (
				<>
					{quickHint !== undefined && (
						<QuickHint index={quickHint} />
					)}
					<div className="relative shrink-0">
						<AppIcon
							appPath={item.app.iconPath ?? item.app.appPath}
							name={item.app.name}
							base64={item.app.iconBase64}
						/>
						{item.app.running && (
							<span
								className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full bg-emerald-500 ring-2 ring-card"
								aria-label="Running"
								title="Running"
							/>
						)}
					</div>
					<div className="min-w-0 flex-1">
						<div className="text-[13px] font-medium truncate text-foreground flex items-center gap-2">
							<span className="truncate">
								<Highlight text={item.app.name} query={highlight} />
							</span>
							{item.recent && (
								<span className="text-[9px] uppercase tracking-wider rounded px-1 py-px bg-primary/10 text-primary font-semibold shrink-0">
									Recent
								</span>
							)}
						</div>
						<div className="text-[11px] text-muted-foreground truncate">
							{formatAppSubtitle(item.app)}
						</div>
					</div>
					{item.app.running && onStopApp ? (
						<button
							type="button"
							onMouseDown={(event) => {
								// Prevent cmdk from treating the click as a
								// list-item selection.
								event.preventDefault();
								event.stopPropagation();
							}}
							onClick={(event) => {
								event.stopPropagation();
								onStopApp(item.app);
							}}
							className="text-[10px] uppercase tracking-wider rounded px-1.5 py-0.5 shrink-0 inline-flex items-center gap-1 bg-destructive/10 text-destructive opacity-0 group-hover/item:opacity-100 group-data-[selected=true]/item:opacity-100 hover:bg-destructive/20 transition-opacity"
							title={`Quit ${item.app.name}`}
						>
							<XCircle className="size-3" />
							Stop
						</button>
					) : (
						<Badge>Open</Badge>
					)}
				</>
			);
		case "session":
			return (
				<>
					{quickHint !== undefined && (
						<QuickHint index={quickHint} />
					)}
					<div
						className={cn(
							"size-8 rounded-md flex items-center justify-center shrink-0",
							item.session.isActive
								? "bg-primary text-primary-foreground"
								: "bg-secondary text-secondary-foreground",
						)}
						aria-hidden="true"
					>
						<MessageSquare className="size-4" />
					</div>
					<div className="min-w-0 flex-1">
						<div className="text-[13px] font-medium truncate text-foreground flex items-center gap-2">
							<span className="truncate">
								<Highlight text={item.session.title} query={highlight} />
							</span>
							{item.recent && (
								<span className="text-[9px] uppercase tracking-wider rounded px-1 py-px bg-primary/10 text-primary font-semibold shrink-0">
									Recent
								</span>
							)}
							{item.session.liveProcessing && (
								<span
									className="size-1.5 rounded-full bg-primary animate-pulse shrink-0"
									aria-hidden="true"
								/>
							)}
						</div>
						<div className="text-[11px] text-muted-foreground truncate">
							{formatSessionSubtitle(item.session)}
						</div>
					</div>
					<Badge variant={item.session.isActive ? "primary" : "default"}>
						{item.session.isActive ? "Active" : "Resume"}
					</Badge>
				</>
			);
		case "builtin":
			return (
				<>
					{quickHint !== undefined && (
						<QuickHint index={quickHint} />
					)}
					<BuiltinIcon name={item.iconName} />
					<div className="min-w-0 flex-1">
						<div className="text-[13px] font-medium truncate text-foreground flex items-center gap-2">
							<span className="truncate">
								<Highlight text={item.title} query={highlight} />
							</span>
							{item.recent && (
								<span className="text-[9px] uppercase tracking-wider rounded px-1 py-px bg-primary/10 text-primary font-semibold shrink-0">
									Recent
								</span>
							)}
						</div>
						<div className="text-[11px] text-muted-foreground truncate">
							{item.description}
						</div>
					</div>
					<Badge>Open</Badge>
				</>
			);
		case "agent":
			return (
				<>
					{quickHint !== undefined && (
						<QuickHint index={quickHint} />
					)}
					<div
						className="size-8 rounded-md bg-primary text-primary-foreground flex items-center justify-center shrink-0"
						aria-hidden="true"
					>
						<MessageSquareText className="size-4" />
					</div>
					<div className="min-w-0 flex-1">
						<div className="text-[13px] font-medium truncate text-foreground">
							{item.query ? `Ask: ${item.query}` : "Ask JFlow…"}
						</div>
						<div className="text-[11px] text-muted-foreground truncate">
							{item.query
								? "Press Enter to send"
								: "Type your question, then press Enter"}
						</div>
					</div>
					<Badge variant="primary">Send</Badge>
				</>
			);
		case "a2ui":
			return (
				<>
					{quickHint !== undefined && (
						<QuickHint index={quickHint} />
					)}
					<div
						className="size-8 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0"
						aria-hidden="true"
					>
						<Layers className="size-4" />
					</div>
					<div className="min-w-0 flex-1">
						<div className="text-[13px] font-medium truncate text-foreground flex items-center gap-2">
							<span className="truncate">
								<Highlight text={item.title} query={highlight} />
							</span>
							{item.recent && (
								<span className="text-[9px] uppercase tracking-wider rounded px-1 py-px bg-primary/10 text-primary font-semibold shrink-0">
									Recent
								</span>
							)}
						</div>
						<div className="text-[11px] text-muted-foreground truncate">
							{item.description ?? "Interactive page"}
						</div>
					</div>
					<Badge>Open</Badge>
				</>
			);
	}
}

function Badge({
	children,
	variant = "default",
}: {
	children: React.ReactNode;
	variant?: "default" | "primary";
}) {
	return (
		<span
			className={cn(
				"text-[10px] uppercase tracking-wider rounded px-1.5 py-0.5 shrink-0",
				variant === "primary"
					? "bg-primary text-primary-foreground"
					: "bg-muted text-muted-foreground",
			)}
		>
			{children}
		</span>
	);
}

function QuickHint({ index }: { index: number }) {
	return (
		<span
			className="inline-flex items-center justify-center min-w-[20px] h-[20px] rounded border border-border bg-muted/40 text-[10px] font-mono text-muted-foreground shrink-0 group-data-[selected=true]/item:bg-primary/20 group-data-[selected=true]/item:text-primary group-data-[selected=true]/item:border-primary/30 transition-colors"
			aria-hidden="true"
		>
			⌘{index}
		</span>
	);
}
