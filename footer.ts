/**
 * Fancy Footer Extension
 *
 * Line 1: 📂 ~/path  🌿 branch  📝 session-name
 * Line 2: 📊 ↑in ↓out Rcache Wcache │ 💰 $cost │ 🧠 ctx%/window │ 🤖 model • thinking
 */

import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

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
			const sep = theme.fg("dim", " │ ");

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

					// ═══ Line 1: 📂 path  🌿 branch  📝 session ═══
					let pwd = process.cwd();
					const home = process.env.HOME || process.env.USERPROFILE;
					if (home && pwd.startsWith(home)) pwd = `~${pwd.slice(home.length)}`;

					const parts1: string[] = [`📂 ${pwd}`];

					const branch = footerData.getGitBranch();
					if (branch) parts1.push(`🌿 ${theme.fg("accent", branch)}`);

					const sessionName = ctx.sessionManager.getSessionName();
					if (sessionName) parts1.push(`📝 ${theme.fg("muted", sessionName)}`);

					const line1 = truncateToWidth(" " + parts1.join(sep), width, theme.fg("dim", "…"));

					// ═══ Line 2: 📊 tokens │ 💰 cost │ 🧠 ctx │ 🤖 model ═══
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
					else ctxStr = ctxDisplay;
					parts2L.push(`🧠 ${ctxStr}`);

					const leftStr = " " + parts2L.join(sep);

					// Model (right-aligned)
					let modelStr = ctx.model?.id || "no-model";
					if (ctx.model?.reasoning) {
						const lvl = (ctx as any).thinkingLevel || "off";
						modelStr += lvl === "off"
							? theme.fg("muted", " • thinking off")
							: theme.fg("accent", ` • ${lvl}`);
					}
					if (footerData.getAvailableProviderCount?.() > 1 && ctx.model) {
						const withProv = `(${ctx.model.provider}) ${modelStr}`;
						if (visibleWidth(leftStr) + 4 + visibleWidth(withProv) + 3 <= width) {
							modelStr = withProv;
						}
					}
					const rightStr = `🤖 ${modelStr} `;

					const lW = visibleWidth(leftStr);
					const rW = visibleWidth(rightStr);

					let line2: string;
					if (lW + 2 + rW <= width) {
						const pad = " ".repeat(width - lW - rW);
						line2 = leftStr + pad + rightStr;
					} else if (lW + 2 + rW <= width + 2) {
						line2 = leftStr + "  " + rightStr;
					} else {
						line2 = truncateToWidth(leftStr + sep + rightStr, width, theme.fg("dim", "…"));
					}

					const dimLine2Left = theme.fg("dim", leftStr);
					const remainder = line2.slice(leftStr.length);
					const dimLine2Right = theme.fg("dim", remainder);

					const lines = [theme.fg("dim", line1), dimLine2Left + dimLine2Right];

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
