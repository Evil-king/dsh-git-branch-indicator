/**
 * dsh-git-branch-indicator — 浏览器半。
 *
 * 以官方客户端插件的 bundle 格式书写（window.__ModuleLoader__.load 注册
 * factory），无构建步骤：factory 内只 require 静态外部模块（react 与
 * @deepseek-ai/dsh-client-ui-primitives），其余全部内联。把一个分支徽章
 * 注册进 `conversation.input.left` 插槽（输入区左侧工具行），数据来自
 * 宿主半注册的 /api/git-branch/summary 路由；cwd 变化、窗口重新聚焦、
 * 15 秒轮询时自动刷新，非 git 目录不渲染任何东西。
 */
window.__ModuleLoader__.load({
	id: "dsh-git-branch-indicator",
	factory: (require) => {
		const React = require("react");
		const primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		const { useState, useEffect, useCallback, useRef, useSyncExternalStore, createElement } = React;

		const Tooltip = primitives && primitives.Tooltip;
		const IconBranch = primitives && primitives.IconBranchOutlineRegular;
		const IconCheck = primitives && primitives.IconCheckOutlineRegular;

		/** 本地化命名空间（locale 服务按 zh/en 字典解析）。 */
		const NS = "gitbranch.chip";
		/** 简体中文字典（键集的源头）。 */
		const zh = {
			"copy": "复制分支名",
			"copied": "已复制",
			"detached": "分离提交",
			"dirty": "有未提交改动",
			"clean": "工作区干净",
			"repoRoot": "仓库根目录",
			"commit": "提交",
			"changes": "处改动"
		};
		/** 英文字典，与 zh 键集一致。 */
		const en = {
			"copy": "Copy branch name",
			"copied": "Copied",
			"detached": "Detached HEAD",
			"dirty": "Uncommitted changes",
			"clean": "Working tree clean",
			"repoRoot": "Repository root",
			"commit": "Commit",
			"changes": "changed"
		};

		/** 轮询间隔：可见时每 15 秒重查一次分支。 */
		const POLL_MS = 15000;
		/** 徽章最大宽度，超长分支名省略号，完整名在工具提示里。 */
		const MAX_WIDTH = 190;

		/** 样式表只注入一次；沿用应用的设计令牌，未定义时回退中性值。 */
		const STYLE_ID = "dsh-git-branch-style";
		const CSS = [
			".dshgb-root{display:inline-flex;align-items:center;gap:4px;max-width:" + MAX_WIDTH + "px;height:24px;padding:0 8px;margin-left:2px;border:none;border-radius:var(--dsw-radius-md,999px);background:transparent;color:var(--dsw-alias-label-secondary,inherit);font-family:var(--dsw-font-family,inherit);font-size:12px;line-height:1;cursor:pointer;-webkit-user-select:none;user-select:none;transition:background .15s ease,color .15s ease;}",
			".dshgb-root:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.14));color:var(--dsw-alias-label-primary,inherit);}",
			".dshgb-root:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,Highlight);outline-offset:1px;}",
			".dshgb-icon{display:inline-flex;flex:none;color:var(--dsw-alias-label-tertiary,currentColor);}",
			".dshgb-root:hover .dshgb-icon{color:var(--dsw-alias-state-business-primary,currentColor);}",
			".dshgb-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:450;}",
			".dshgb-sha{flex:none;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary,inherit);}",
			".dshgb-dirty{display:inline-flex;align-items:center;gap:3px;flex:none;color:var(--dsw-alias-label-tertiary,inherit);}",
			".dshgb-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-business-primary,#4f7cff);flex:none;}",
			".dshgb-copied{color:var(--dsw-alias-state-business-primary,inherit);}"
		].join("\n");

		function ensureStyle() {
			if (typeof document === "undefined" || document.getElementById(STYLE_ID) !== null) return;
			const element = document.createElement("style");
			element.id = STYLE_ID;
			element.textContent = CSS;
			document.head.appendChild(element);
		}

		/** 把应用内路由解析成绝对 URL（应用可能部署在带前缀的 base 下）。 */
		function apiUrl(route) {
			const path = route.replace(/^\/+/, "");
			try {
				return new URL(path, document.baseURI).href;
			} catch {
				return path;
			}
		}

		/** 内联的分支图标（primitives 缺失时的回退）。 */
		function BranchIconFallback({ size }) {
			return createElement("svg", {
				viewBox: "0 0 16 16",
				width: size,
				height: size,
				fill: "none",
				stroke: "currentColor",
				"stroke-width": 1.25,
				"stroke-linecap": "round",
				"stroke-linejoin": "round",
				"aria-hidden": true,
			}, createElement("circle", { cx: 4, cy: 3.5, r: 1.75 }), createElement("circle", { cx: 4, cy: 12.5, r: 1.75 }), createElement("circle", { cx: 12, cy: 5.5, r: 1.75 }), createElement("path", { d: "M4 5.25v5.5" }), createElement("path", { d: "M12 7.25c0 2.5-2.5 2.75-5 3" }));
		}

		/**
		 * 读取会话当前 cwd（sessions.list 是带 getSnapshot/subscribe 的快照 store）。
		 * @param {object | undefined} sessions 客户端 sessions 服务。
		 * @param {string | undefined} sessionId 会话 id。
		 * @returns {string | undefined} cwd。
		 */
		function useSessionCwd(sessions, sessionId) {
			const list = sessions && sessions.list;
			const subscribe = useCallback((listener) => {
				if (list === undefined || typeof list.subscribe !== "function") return () => {};
				return list.subscribe(listener);
			}, [list]);
			const getSnapshot = useCallback(() => {
				try {
					return list && typeof list.getSnapshot === "function" ? list.getSnapshot().byId[sessionId]?.cwd : undefined;
				} catch {
					return undefined;
				}
			}, [list, sessionId]);
			return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
		}

		/**
		 * 构造分支徽章组件（闭包持有 sessions 服务）。
		 * @param {object} sessions 客户端 sessions 服务。
		 * @returns {FunctionComponent} 徽章组件。
		 */
		function makeGitBranchChip(sessions) {
			return function GitBranchChip({ t, sessionId }) {
				const cwd = useSessionCwd(sessions, sessionId);
				const [summary, setSummary] = useState(null);
				const [tick, setTick] = useState(0);
				const [copied, setCopied] = useState(false);
				const seqRef = useRef(0);
				const copiedTimer = useRef(undefined);

				ensureStyle();

				/** cwd 或手动 tick 变化时重新查询。 */
				useEffect(() => {
					if (cwd === undefined || cwd === "") {
						setSummary(null);
						return;
					}
					const seq = ++seqRef.current;
					const controller = typeof AbortController === "function" ? new AbortController() : undefined;
					let alive = true;
					(async () => {
						try {
							const response = await fetch(apiUrl(`api/git-branch/summary?cwd=${encodeURIComponent(cwd)}`), {
								signal: controller === undefined ? undefined : controller.signal,
								headers: { accept: "application/json" },
								credentials: "same-origin",
							});
							const data = await response.json();
							if (!alive || seq !== seqRef.current) return;
							setSummary(response.ok && data !== null && typeof data === "object" && data.ok === true ? data : { ok: false });
						} catch {
							if (alive && seq === seqRef.current) setSummary({ ok: false });
						}
					})();
					return () => {
						alive = false;
						controller?.abort();
					};
				}, [cwd, tick]);

				/** 轮询与聚焦刷新。 */
				useEffect(() => {
					const refresh = () => setTick((value) => value + 1);
					const onVisibility = () => {
						if (document.visibilityState === "visible") refresh();
					};
					const timer = setInterval(() => {
						if (typeof document === "undefined" || document.visibilityState === "visible") refresh();
					}, POLL_MS);
					window.addEventListener("focus", refresh);
					document.addEventListener("visibilitychange", onVisibility);
					return () => {
						clearInterval(timer);
						window.removeEventListener("focus", refresh);
						document.removeEventListener("visibilitychange", onVisibility);
					};
				}, []);

				/** 清理“已复制”计时器。 */
				useEffect(() => () => {
					if (copiedTimer.current !== undefined) clearTimeout(copiedTimer.current);
				}, []);

				const onCopy = useCallback(() => {
					const label = summary === null || summary.ok !== true ? null : typeof summary.branch === "string" && summary.branch !== "" ? summary.branch : typeof summary.sha === "string" ? summary.sha : null;
					if (label === null) return;
					const done = () => {
						setCopied(true);
						if (copiedTimer.current !== undefined) clearTimeout(copiedTimer.current);
						copiedTimer.current = setTimeout(() => setCopied(false), 1400);
					};
					if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
						navigator.clipboard.writeText(label).then(done, () => {});
					}
				}, [summary]);

				if (cwd === undefined || cwd === "" || summary === null || summary.ok !== true) return null;
				const { branch, sha, detached, dirtyCount, root } = summary;
				const hasCommit = typeof branch === "string" && branch !== "" || typeof sha === "string" && sha !== "";
				if (!hasCommit) return null;

				const name = typeof branch === "string" && branch !== "" ? branch : `${t("detached")}`;
				const copyLabel = typeof branch === "string" && branch !== "" ? branch : typeof sha === "string" ? sha : "";
				const tooltipParts = [];
				if (typeof root === "string" && root !== "") tooltipParts.push(`${t("repoRoot")}: ${root}`);
				tooltipParts.push(typeof branch === "string" && branch !== "" ? branch : `${t("detached")}`);
				if (typeof sha === "string" && sha !== "") tooltipParts.push(`${t("commit")}: ${sha}`);
				if (typeof dirtyCount === "number") tooltipParts.push(dirtyCount > 0 ? `${t("dirty")} (${dirtyCount} ${t("changes")})` : t("clean"));
				const tooltip = tooltipParts.join("\n");

				const dirtyElement = typeof dirtyCount === "number" && dirtyCount > 0
					? createElement("span", { className: "dshgb-dirty" },
						createElement("span", { className: "dshgb-dot" }),
						createElement("span", null, dirtyCount > 99 ? "99+" : String(dirtyCount)))
					: null;
				const shaElement = detached === true && typeof sha === "string" && sha !== ""
					? createElement("span", { className: "dshgb-sha" }, sha)
					: null;
				const icon = copied === true
					? (IconCheck !== undefined ? createElement(IconCheck, { size: 13 }) : createElement(BranchIconFallback, { size: 13 }))
					: (IconBranch !== undefined ? createElement(IconBranch, { size: 13 }) : createElement(BranchIconFallback, { size: 13 }));

				const button = createElement("button", {
					type: "button",
					className: copied === true ? "dshgb-root dshgb-copied" : "dshgb-root",
					"aria-label": copied === true ? t("copied") : `${t("copy")} ${copyLabel}`,
					title: Tooltip === undefined ? tooltip : undefined,
					onMouseDown: (event) => event.preventDefault(),
					onClick: onCopy,
				},
					createElement("span", { className: "dshgb-icon" }, icon),
					createElement("span", { className: "dshgb-name" }, copied === true ? t("copied") : name),
					shaElement,
					dirtyElement);

				if (Tooltip === undefined) return button;
				return createElement(Tooltip, { label: tooltip, side: "top", delayMs: 400, children: button });
			};
		}

		/** 模块级所需服务：sessions 提供会话 cwd，locale 提供字典。 */
		const inject = ["sessions", "locale"];

		/**
		 * 插件体：注册字典，然后把徽章组件挂进输入区左侧插槽。
		 * 注册控制器归属自身 fiber，插件卸载或声明重建时自动撤销。
		 * @param {object} ctx 客户端根上下文。
		 */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "git-branch-indicator: dictionaries");
			ctx.inject(["slots", "sessions"], (scope) => {
				scope.slots.inject("conversation.input.left", () => scope.slots.register({
					name: "conversation.input.left",
					id: "git-branch-indicator",
					order: 10,
					locale: NS,
					inject: (sessionId) => ({ sessionId }),
				}, makeGitBranchChip(scope.sessions)));
			});
		}

		return { apply, inject };
	},
});
