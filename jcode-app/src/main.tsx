import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import App from "./App";
import { Launcher } from "./components/Launcher";
import "./App.css";

/**
 * The jcode app has two top-level Tauri windows declared in
 * `src-tauri/tauri.conf.json`:
 *
 *  - `workbench`  : the main 1200x800 window that hosts the existing App.
 *  - `launcher`   : a 720x420 always-on-top palette for global navigation.
 *
 * Both windows load the same bundled `index.html`, so we branch on the
 * window label to pick the correct root component. Tauri 2 exposes
 * `getCurrentWebviewWindow().label` synchronously, so we can use it
 * before mounting React without any await.
 */
const label = getCurrentWebviewWindow().label;
const Root = label === "launcher" ? <Launcher /> : <App />;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
	<React.StrictMode>{Root}</React.StrictMode>,
);
