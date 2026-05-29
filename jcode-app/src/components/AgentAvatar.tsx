import ReactNiceAvatar, { genConfig } from "react-nice-avatar";
import { cn } from "@/lib/utils";

interface AgentAvatarProps {
	name: string;
	size?: "xs" | "sm" | "md" | "lg" | "xl";
	className?: string;
	shape?: "circle" | "rounded" | "square";
}

const SIZE_MAP = {
	xs: 20,
	sm: 24,
	md: 32,
	lg: 36,
	xl: 44,
};

const CLASS_MAP = {
	xs: "w-5 h-5",
	sm: "w-6 h-6",
	md: "w-8 h-8",
	lg: "w-9 h-9",
	xl: "w-11 h-11",
};

const configCache = new Map<string, ReturnType<typeof genConfig>>();

function getConfig(name: string) {
	if (!configCache.has(name)) {
		configCache.set(name, genConfig(name));
	}
	return configCache.get(name)!;
}

export function AgentAvatar({
	name,
	size = "md",
	className,
	shape = "circle",
}: AgentAvatarProps) {
	const config = getConfig(name);
	return (
		<ReactNiceAvatar
			id={`avatar-${name}`}
			className={cn("shrink-0", CLASS_MAP[size], className)}
			shape={shape}
			{...config}
		/>
	);
}

interface AgentAvatarStackProps {
	members: string[];
	size?: "xs" | "sm" | "md";
	maxDisplay?: number;
}

export function AgentAvatarStack({
	members,
	size = "sm",
	maxDisplay = 3,
}: AgentAvatarStackProps) {
	const displayMembers = members.slice(0, maxDisplay);
	const remaining = members.length - maxDisplay;
	const overlapClass =
		size === "xs"
			? "-space-x-1"
			: size === "sm"
				? "-space-x-1.5"
				: "-space-x-2";

	return (
		<div className={cn("flex shrink-0", overlapClass)}>
			{displayMembers.map((m) => (
				<AgentAvatar
					key={m}
					name={m}
					size={size}
					className="border-2 border-card"
				/>
			))}
			{remaining > 0 && (
				<div
					className={cn(
						"rounded-full flex items-center justify-center bg-muted text-muted-foreground font-medium border-2 border-card shrink-0",
						SIZE_MAP[size] <= 24 ? "w-5 h-5 text-[7px]" : "w-6 h-6 text-[8px]",
					)}
				>
					+{remaining}
				</div>
			)}
		</div>
	);
}
