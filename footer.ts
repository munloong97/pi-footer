/**
 * Fancy Footer Extension
 *
 * Line 1: ⬢ node │ 📁 ~/path │ ⤴️ branch +0 │ 📝 session
 * Line 2: ↻ PR #123 (optional, if in a PR)
 * Line 3: 📊 ↑in ↓out Rcache Wcache │ 💰 $cost │ 🧠 ctx%/window │ 🤖 model
 */

import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { execSync } from "child_process";

function getGitStatus(): { staged: number; unstaged: number } {
	try {
		const output = execSync("git status --porcelain", { encoding: "utf-8", cwd: process.cwd() });
		const lines = output.trim().split("\n").filter(Boolean);
		let staged = 0, unstaged = 0;
		for (const line of lines) {
			if (line[0] && line[0] !== " " && line[0] !== "?") staged++;
			if (line[1] && line[1] !== " ") unstaged++;
		}
		return { staged, unstaged };
	} catch {
		return { staged: 0, unstaged: 0 };
	}
}

function getPRNumber(): number | null {
	// Try to get PR number from various sources:
	
	// 1. gh CLI current branch PR (local dev)
	try {
		const output = execSync("gh pr view --json number -q .number 2>/dev/null", { 
			encoding: "utf-8", 
			cwd: process.cwd() 
		});
		const num = parseInt(output.trim(), 10);
		if (!isNaN(num)) return num;
	} catch { /* ignore */ }
	
	// 2. GitHub Actions environment
	// GITHUB_HEAD_REF is set for PR events
	if (process.env.GITHUB_EVENT_NAME === "pull_request" && process.env.GITHUB_REF_NAME) {
		// GITHUB_REF_NAME is like "123/merge" for PR #123
		const match = process.env.GITHUB_REF_NAME.match(/^(\d+)\/merge$/);
		if (match) {
			const num = parseInt(match[1], 10);
			if (!isNaN(num)) return num;
		}
	}
	
	// 3. GITHUB_PR_NUMBER env var (custom/CI)
	if (process.env.GITHUB_PR_NUMBER) {
		const num = parseInt(process.env.GITHUB_PR_NUMBER, 10);
		if (!isNaN(num)) return num;
	}
	
	return null;
}

function getGitRemoteUrl(): string | null {
	try {
		const output = execSync("git remote get-url origin 2>/dev/null", { 
			encoding: "utf-8", 
			cwd: process.cwd() 
		}).trim();
		return output;
	} catch {
		return null;
	}
}

function getPRUrl(prNumber: number): string | null {
	// Try to get PR URL from gh CLI first
	try {
		const url = execSync(`gh pr view ${prNumber} --json url -q .url 2>/dev/null`, {
			encoding: "utf-8",
			cwd: process.cwd()
		}).trim();
		if (url) return url;
	} catch { /* ignore */ }

	const remoteUrl = getGitRemoteUrl();
	if (!remoteUrl) return null;

	// Convert git URL to web URL
	// git@github.com:owner/repo.git -> https://github.com/owner/repo
	// https://github.com/owner/repo.git -> https://github.com/owner/repo
	let match = remoteUrl.match(/git@([^:]+):(.+?)\.?$/);
	if (match) {
		return `https://${match[1]}/${match[2]}/pull/${prNumber}`;
	}

	match = remoteUrl.match(/https?:\/\/[^\/]+\/(.+?)\.?$/);
	if (match) {
		const base = remoteUrl.replace(/\.git$/, "");
		return `${base}/pull/${prNumber}`;
	}

	return null;
}

/** Create clickable terminal hyperlink using OSC 8 */
function hyperlink(url: string, text: string): string {
	return `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\`;
}

function fmtTokens(n: number): string {
	if (n < 1000) return n.toString();
	if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
	if (n < 1000000) return `${Math.round(n / 1000)}k`;
	if (n < 10000000) return `${(n / 1000000).toFixed(1)}M`;
	return `${Math.round(n / 1000000)}M`;
}

function sanitize(text: string): string {
	return text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		ctx.ui.setFooter((tui, theme, footerData) => {
			const unsub = footerData.onBranchChange(() => tui.requestRender());

			return {
				dispose: unsub,
				invalidate() {},

				render(width: number): string[] {
					// --- Gather stats ---
					let inp = 0, out = 0, cR = 0, cW = 0, cost = 0;
					for (const e of ctx.sessionManager.getEntries()) {
						if (e.type === "message" && e.message.role === "assistant") {
							const m = e.message as AssistantMessage;
							inp += m.usage.input;
							out += m.usage.output;
							cR += m.usage.cacheRead;
							cW += m.usage.cacheWrite;
							cost += m.usage.cost.total;
						}
					}

					const ctxUsage = ctx.getContextUsage();
					const ctxWindow = ctxUsage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
					const ctxPctVal = ctxUsage?.percent ?? 0;
					const ctxPct = ctxUsage?.percent !== null ? ctxPctVal.toFixed(1) : "?";

					const sep = theme.fg("dim", " │ ");

					// ═══ Line 1: ⬢ node  📂 path  🌿 branch (+changes)  📝 session ═══
					const parts1: string[] = [];

					// Node version
					parts1.push(theme.fg("accent", process.version));

					// Path with folder icon
					let pwd = process.cwd();
					const home = process.env.HOME || process.env.USERPROFILE;
					if (home && pwd.startsWith(home)) pwd = `~${pwd.slice(home.length)}`;
					parts1.push(`📁 ${theme.fg("dim", pwd)}`);

					// Branch with git icon and changes count
					const branch = footerData.getGitBranch();
					if (branch) {
						const changes = getGitStatus();
						const changesStr = changes.staged || changes.unstaged
							? theme.fg("success", `+${changes.staged + changes.unstaged}`)
							: theme.fg("muted", "+ 0");
						parts1.push(`⤴️ ${theme.fg("accent", branch)} ${changesStr}`);
					}

					const sessionName = ctx.sessionManager.getSessionName();
					if (sessionName) parts1.push(`📝 ${theme.fg("muted", sessionName)}`);

					const line1 = truncateToWidth(" " + parts1.join(sep), width, theme.fg("dim", "…"));

					// ═══ Line 2+3: ═══
					const lines: string[] = [" " + line1];

					// PR info (if available)
					const prNumber = getPRNumber();
					if (prNumber) {
						const prUrl = getPRUrl(prNumber);
						const prStr = prUrl 
							? hyperlink(prUrl, `#${prNumber}`)
							: `#${prNumber}`;
						lines.push(` ⤾ ${theme.fg("accent", "PR")} ${theme.fg("muted", prStr)}`);
					}

					// Stats line: 📊 tokens │ 💰 cost │ 🧠 ctx │ 🤖 model
					const parts2L: string[] = [];

					// Tokens
					const toks: string[] = [];
					if (inp) toks.push(`↑${fmtTokens(inp)}`);
					if (out) toks.push(`↓${fmtTokens(out)}`);
					if (cR) toks.push(`R${fmtTokens(cR)}`);
					if (cW) toks.push(`W${fmtTokens(cW)}`);
					if (toks.length) parts2L.push(`📊 ${toks.join(" ")}`);

					// Cost
					if (cost) parts2L.push(`💰 $${cost.toFixed(3)}`);

					// Context
					const ctxDisplay = ctxPct === "?" ? `?/${fmtTokens(ctxWindow)}` : `${ctxPct}%/${fmtTokens(ctxWindow)}`;
					let ctxStr: string;
					if (ctxPctVal > 90) ctxStr = theme.fg("error", ctxDisplay);
					else if (ctxPctVal > 70) ctxStr = theme.fg("warning", ctxDisplay);
					else if (ctxPctVal > 50) ctxStr = theme.fg("accent", ctxDisplay);
					else ctxStr = theme.fg("dim", ctxDisplay);
					parts2L.push(`🧠 ${ctxStr}`);

					const leftStr = " " + parts2L.join(sep);

					// Model (right-aligned)
					let modelStr = ctx.model?.id || "no-model";
					if (ctx.model?.reasoning) {
						const lvl = pi.getThinkingLevel?.() ?? "off";
						modelStr += lvl === "off"
							? theme.fg("muted", " • thinking off")
							: theme.fg("accent", ` • ${lvl}`);
					}

					// Check if multiple providers available
					const providerCount = footerData.getAvailableProviderCount?.() ?? 0;
					if (providerCount > 1 && ctx.model) {
						const withProv = `(${ctx.model.provider}) ${modelStr}`;
						if (visibleWidth(leftStr) + 4 + visibleWidth(withProv) + 3 <= width) {
							modelStr = withProv;
						}
					}
					const rightStr = `🤖 ${modelStr} `;

					const lW = visibleWidth(leftStr);
					const rW = visibleWidth(rightStr);

					let statsLine: string;
					if (lW + 2 + rW <= width) {
						const pad = " ".repeat(width - lW - rW);
						statsLine = leftStr + pad + rightStr;
					} else {
						statsLine = truncateToWidth(leftStr + sep + rightStr, width, theme.fg("dim", "…"));
					}
					lines.push(statsLine);

					// Extension statuses
					const statuses = footerData.getExtensionStatuses();
					if (statuses.size > 0) {
						const sorted = Array.from(statuses.entries())
							.sort(([a], [b]) => a.localeCompare(b))
							.map(([, t]) => sanitize(t));
						lines.push(truncateToWidth(" " + sorted.join("  "), width, theme.fg("dim", "…")));
					}

					return lines;
				},
			};
		});
	});
}
