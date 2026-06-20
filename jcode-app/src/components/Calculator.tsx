import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Calculator as CalcIcon, CornerDownLeft, Delete } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { cn } from "@/lib/utils";

interface CalculatorProps {
	initialExpression?: string;
	onClose: () => void;
}

const BUTTONS = [
	["(", ")", "C", "←"],
	["7", "8", "9", "/"],
	["4", "5", "6", "*"],
	["1", "2", "3", "-"],
	["0", ".", "=", "+"],
];

const SCI_BUTTONS = [
	["sin", "cos", "tan", "log"],
	["asin", "acos", "atan", "ln"],
	["sqrt", "exp", "pi", "e"],
	["^", "abs", "floor", "ceil"],
];

export function Calculator({ initialExpression = "", onClose }: CalculatorProps) {
	const inputRef = useRef<HTMLInputElement>(null);
	const [expression, setExpression] = useState(initialExpression);
	const [result, setResult] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [history, setHistory] = useState<Array<{ expr: string; result: string }>>([]);

	useEffect(() => {
		inputRef.current?.focus();
		if (initialExpression) {
			void evaluate(initialExpression);
		}
	}, [initialExpression]);

	const evaluate = async (expr: string) => {
		if (!expr.trim()) return;
		try {
			const res = await invoke<{ expression: string; result: string }>("evaluate_expression", {
				expression: expr,
			});
			setResult(res.result);
			setError(null);
			setHistory((prev) => [{ expr: res.expression, result: res.result }, ...prev].slice(0, 20));
		} catch (e) {
			setResult(null);
			setError(String(e));
		}
	};

	const handleInput = (value: string) => {
		setError(null);
		if (value === "C") {
			setExpression("");
			setResult(null);
		} else if (value === "←") {
			setExpression((prev) => prev.slice(0, -1));
		} else if (value === "=") {
			void evaluate(expression);
		} else if (["sin", "cos", "tan", "asin", "acos", "atan", "log", "ln", "sqrt", "exp", "abs", "floor", "ceil"].includes(value)) {
			setExpression((prev) => `${prev}${value}(`);
		} else if (value === "pi") {
			setExpression((prev) => `${prev}pi`);
		} else if (value === "e") {
			setExpression((prev) => `${prev}e`);
		} else {
			setExpression((prev) => prev + value);
		}
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Escape") {
			if (expression || result) {
				e.preventDefault();
				setExpression("");
				setResult(null);
				setError(null);
			} else {
				onClose();
			}
			return;
		}
		if (e.key === "Enter") {
			e.preventDefault();
			void evaluate(expression);
		}
	};

	const renderButton = (label: string, variant: "default" | "primary" | "danger" = "default") => (
		<button
			type="button"
			key={label}
			onClick={() => handleInput(label)}
			className={cn(
				"h-7 rounded-md text-[12px] font-medium transition-colors",
				variant === "primary" && "bg-primary text-primary-foreground hover:bg-primary/90",
				variant === "danger" && "bg-destructive/10 text-destructive hover:bg-destructive/20",
				variant === "default" && "bg-[var(--launcher-input-bg)] hover:bg-[var(--launcher-glass)] text-foreground",
			)}
		>
			{label === "←" ? <Delete className="size-3 mx-auto" /> : label}
		</button>
	);

	return (
		<motion.div
			initial={{ opacity: 0, scale: 0.98 }}
			animate={{ opacity: 1, scale: 1 }}
			transition={{ duration: 0.18, ease: "easeOut" }}
			className="h-screen w-screen flex flex-col text-foreground"
			onKeyDown={handleKeyDown}
		>
			<div className="flex-1 launcher-glass overflow-hidden flex flex-col">
				{/* Header */}
				<div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-[var(--launcher-glass-border)] shrink-0">
					<div className="w-5 h-5 rounded bg-primary/10 flex items-center justify-center text-primary">
						<CalcIcon className="size-3" />
					</div>
					<span className="text-[12px] font-medium">Calculator</span>
				</div>

				{/* Display */}
				<div className="px-2.5 pt-2 pb-1.5 shrink-0">
					<div className="launcher-input px-2.5 py-1.5 min-h-[42px] flex flex-col justify-center">
						<input
							ref={inputRef}
							value={expression}
							onChange={(e) => {
								setExpression(e.target.value);
								setError(null);
							}}
							placeholder="0"
							className="w-full bg-transparent text-right text-[16px] outline-none placeholder:text-[var(--launcher-muted-fg)]/60 font-mono"
						/>
						{result !== null && !error && (
							<div className="text-right text-[11px] text-primary font-mono">= {result}</div>
						)}
						{error && (
							<div className="text-right text-[10px] text-destructive truncate">{error}</div>
						)}
					</div>
				</div>

				{/* Keypad */}
				<div className="flex-1 min-h-0 overflow-y-auto px-2.5 pb-2">
					<div className="space-y-1">
						{SCI_BUTTONS.map((row, i) => (
							<div key={`sci-${i}`} className="grid grid-cols-4 gap-1">
								{row.map((b) => renderButton(b))}
							</div>
						))}
						<div className="h-px bg-[var(--launcher-glass-border)] my-1" />
						{BUTTONS.map((row, i) => (
							<div key={`num-${i}`} className="grid grid-cols-4 gap-1">
								{row.map((b) => {
									if (b === "=") return renderButton(b, "primary");
									if (b === "C") return renderButton(b, "danger");
									return renderButton(b);
								})}
							</div>
						))}
					</div>

					{history.length > 0 && (
						<div className="mt-2 pt-2 border-t border-[var(--launcher-glass-border)]">
							<p className="text-[9px] launcher-muted mb-1">History</p>
							<div className="space-y-0.5">
								{history.slice(0, 5).map((h, idx) => (
									<button
										key={idx}
										type="button"
										onClick={() => {
											setExpression(h.expr);
											setResult(h.result);
											setError(null);
										}}
										className="w-full text-left rounded-md px-1.5 py-0.5 text-[10px] hover:bg-primary/5 transition-colors"
									>
										<span className="launcher-muted">{h.expr}</span>
										<span className="mx-1 text-[var(--launcher-muted-fg)]/40">=</span>
										<span className="text-foreground font-mono">{h.result}</span>
									</button>
								))}
							</div>
						</div>
					)}
				</div>

				{/* Footer */}
				<div className="launcher-footer border-t border-[var(--launcher-glass-border)] px-2.5 py-1 flex items-center justify-between text-[10px] shrink-0">
					<div />
					<div className="flex items-center gap-2 shrink-0">
						<span className="inline-flex items-center gap-1">
							<CornerDownLeft className="size-2.5" />
							<span>enter · esc</span>
						</span>
					</div>
				</div>
			</div>
		</motion.div>
	);
}
