import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import App from "./App";
import { Launcher } from "./components/Launcher";
import { PagesApp } from "./components/PagesApp";
import "./App.css";

/**
 * The jcode app has three top-level Tauri windows declared in
 * `src-tauri/tauri.conf.json`:
 *
 *  - `workbench`  : the main 1200x800 window that hosts the agent workspace.
 *  - `launcher`   : a 720x420 always-on-top palette for global navigation.
 *  - `pages`      : a 960x680 window for Settings / Providers / MCP / Skills
 *                   / Swarm, with its own clean layout (no agent chrome).
 *
 * All windows load the same bundled `index.html`, so we branch on
 * the window label to pick the correct root component. Tauri 2 exposes
 * `getCurrentWebviewWindow().label` synchronously.
 */
const label = getCurrentWebviewWindow().label;
if (label === "launcher") {
	document.documentElement.classList.add("launcher-window");
	document.body.classList.add("launcher-window");
}
const Root =
	label === "launcher" ? (
		<Launcher />
	) : label === "pages" ? (
		<PagesApp />
	) : (
		<App />
	);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
	<React.StrictMode>{Root}</React.StrictMode>,
);
