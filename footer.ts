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

// Cached values to avoid recomputing on every render
let cachedGitStatus: { staged: number; unstaged: number; timestamp: number } | null = null;
let cachedPRNumber: { number: number | null; timestamp: number } | null = null;
let cachedStats: {
	inp: number;
	out: number;
	cR: number;
	cW: number;
	cost: number;
	timestamp: number;
	entryCount: number;
} | null = null;

const GIT_CACHE_MS = 2000; // Cache git status for 2 seconds
const PR_CACHE_MS = 10000; // Cache PR number for 10 seconds
const STATS_CACHE_MS = 500; // Cache stats for 500ms

function getCachedGitStatus(): { staged: number; unstaged: number } {
	const now = Date.now();
	if (cachedGitStatus && now - cachedGitStatus.timestamp < GIT_CACHE_MS) {
		return { staged: cachedGitStatus.staged, unstaged: cachedGitStatus.unstaged };
	}
	
	try {
		const output = execSync("git status --porcelain", { encoding: "utf-8", cwd: process.cwd() });
		const lines = output.trim().split("\n").filter(Boolean);
		let staged = 0, unstaged = 0;
		for (const line of lines) {
			if (line[0] && line[0] !== " " && line[0] !== "?") staged++;
			if (line[1] && line[1] !== " ") unstaged++;
		}
		cachedGitStatus = { staged, unstaged, timestamp: now };
		return { staged, unstaged };
	} catch {
		return { staged: 0, unstaged: 0 };
	}
}

function getCachedPRNumber(): number | null {
	const now = Date.now();
	if (cachedPRNumber && now - cachedPRNumber.timestamp < PR_CACHE_MS) {
		return cachedPRNumber.number;
	}
	
	let result: number | null = null;
	
	// 1. gh CLI current branch PR (local dev)
	try {
		const output = execSync("gh pr view --json number -q .number 2>/dev/null", { 
			encoding: "utf-8", 
			cwd: process.cwd() 
		});
		const num = parseInt(output.trim(), 10);
		if (!isNaN(num)) result = num;
	} catch { /* ignore */ }
	
	// 2. GitHub Actions environment
	if (!result && process.env.GITHUB_EVENT_NAME === "pull_request" && process.env.GITHUB_REF_NAME) {
		const match = process.env.GITHUB_REF_NAME.match(/^(\d+)\/merge$/);
		if (match) {
			const num = parseInt(match[1], 10);
			if (!isNaN(num)) result = num;
		}
	}
	
	// 3. GITHUB_PR_NUMBER env var (custom/CI)
	if (!result && process.env.GITHUB_PR_NUMBER) {
		const num = parseInt(process.env.GITHUB_PR_NUMBER, 10);
		if (!isNaN(num)) result = num;
	}
	
	cachedPRNumber = { number: result, timestamp: now };
	return result;
}

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
					// SAFETY: Guard against very narrow terminals
					const safeWidth = Math.max(width, 1);
					
					// --- Gather stats with caching ---
					const now = Date.now();
					const entries = ctx.sessionManager.getEntries();
					
					let inp = 0, out = 0, cR = 0, cW = 0, cost = 0;
					
					if (cachedStats && 
					    now - cachedStats.timestamp < STATS_CACHE_MS &&
					    cachedStats.entryCount === entries.length) {
						// Use cached stats
						inp = cachedStats.inp;
						out = cachedStats.out;
						cR = cachedStats.cR;
						cW = cachedStats.cW;
						cost = cachedStats.cost;
					} else {
						// Compute stats
						for (const e of entries) {
							if (e.type === "message" && e.message.role === "assistant") {
								const m = e.message as AssistantMessage;
								inp += m.usage.input;
								out += m.usage.output;
								cR += m.usage.cacheRead;
								cW += m.usage.cacheWrite;
								cost += m.usage.cost.total;
							}
						}
						cachedStats = { inp, out, cR, cW, cost, timestamp: now, entryCount: entries.length };
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

					// Path with folder icon (skip if terminal too narrow)
					if (safeWidth > 40) {
						let pwd = process.cwd();
						const home = process.env.HOME || process.env.USERPROFILE;
						if (home && pwd.startsWith(home)) pwd = `~${pwd.slice(home.length)}`;
						parts1.push(`📁 ${theme.fg("dim", pwd)}`);
					}

					// Branch with git icon and changes count (cached)
					const branch = footerData.getGitBranch();
					if (branch && safeWidth > 50) {
						const changes = getCachedGitStatus();
						const changesStr = changes.staged || changes.unstaged
							? theme.fg("success", `+${changes.staged + changes.unstaged}`)
							: theme.fg("muted", "+ 0");
						parts1.push(`⤴️ ${theme.fg("accent", branch)} ${changesStr}`);
					}

					const sessionName = ctx.sessionManager.getSessionName();
					if (sessionName && safeWidth > 60) parts1.push(`📝 ${theme.fg("muted", sessionName)}`);

					let line1: string;
					if (parts1.length === 0) {
						line1 = " " + theme.fg("dim", "...");
					} else {
						line1 = truncateToWidth(" " + parts1.join(sep), safeWidth, theme.fg("dim", "…"));
					}

					// ═══ Line 2+3: ═══
					const lines: string[] = [truncateToWidth(line1, safeWidth)];

					// PR info (if available) - only on wider terminals (cached)
					const prNumber = getCachedPRNumber();
					if (prNumber && safeWidth > 30) {
						const prUrl = getPRUrl(prNumber);
						const prStr = prUrl 
							? hyperlink(prUrl, `#${prNumber}`)
							: `#${prNumber}`;
						lines.push(truncateToWidth(` ⤾ ${theme.fg("accent", "PR")} ${theme.fg("muted", prStr)}`, safeWidth));
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

					// Model (right-aligned) - simplified for narrow terminals
					let modelStr = ctx.model?.id || "no-model";
					if (ctx.model?.reasoning && safeWidth > 70) {
						const lvl = pi.getThinkingLevel?.() ?? "off";
						modelStr += lvl === "off"
							? theme.fg("muted", " • thinking off")
							: theme.fg("accent", ` • ${lvl}`);
					}

					// Check if multiple providers available
					const providerCount = footerData.getAvailableProviderCount?.() ?? 0;
					if (providerCount > 1 && ctx.model && safeWidth > 80) {
						const withProv = `(${ctx.model.provider}) ${modelStr}`;
						if (visibleWidth(leftStr) + 4 + visibleWidth(withProv) + 3 <= safeWidth) {
							modelStr = withProv;
						}
					}
					const rightStr = `🤖 ${modelStr} `;

					const lW = visibleWidth(leftStr);
					const rW = visibleWidth(rightStr);

					let statsLine: string;
					if (lW + 2 + rW <= safeWidth) {
						const pad = " ".repeat(safeWidth - lW - rW);
						statsLine = leftStr + pad + rightStr;
					} else if (safeWidth > 20) {
						statsLine = truncateToWidth(leftStr + sep + rightStr, safeWidth, theme.fg("dim", "…"));
					} else {
						statsLine = theme.fg("dim", "...");
					}
					lines.push(statsLine);

					// Extension statuses
					const statuses = footerData.getExtensionStatuses();
					if (statuses.size > 0 && safeWidth > 30) {
						const sorted = Array.from(statuses.entries())
							.sort(([a], [b]) => a.localeCompare(b))
							.map(([, t]) => sanitize(t));
						lines.push(truncateToWidth(" " + sorted.join("  "), safeWidth, theme.fg("dim", "…")));
					}

					// Final safety: ensure all lines fit within width
					return lines.map(line => truncateToWidth(line, safeWidth));
				},
			};
		});
	});
}
