/**
 * dsh-git-branch-indicator 客户端 bundle 冒烟测试。
 *
 * 用桩替换 window.__ModuleLoader__ 与静态外部模块（react、primitives），
 * 真实执行 lib/client.js 的 factory 与 apply，抓取注册进
 * conversation.input.left 插槽的组件，再用 react-test-renderer 完整挂载
 * （effects 会真实运行，fetch 用桩应答），断言各状态的渲染输出。
 */
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const require_ = createRequire(import.meta.url);
const React = require_("react");
const TestRenderer = require_("react-test-renderer");

// ---- 浏览器全局桩 -------------------------------------------------------
const listeners = { focus: new Set(), visibilitychange: new Set() };
const styleElements = [];
const elementsById = new Map();
globalThis.window = {
	__ModuleLoader__: { load(reg) { capturedRegistration = reg; } },
	addEventListener(name, fn) { listeners[name]?.add(fn); },
	removeEventListener(name, fn) { listeners[name]?.delete(fn); },
};
globalThis.document = {
	visibilityState: "visible",
	baseURI: "http://127.0.0.1:54101/",
	head: { appendChild(el) { styleElements.push(el); } },
	getElementById(id) { return elementsById.get(id) ?? null; },
	createElement(tag) {
		const el = { tag, id: "", _text: "", set textContent(v) { this._text = v; }, get textContent() { return this._text; } };
		Object.defineProperty(el, "id", { get: () => el._id ?? "", set: (v) => { el._id = v; elementsById.set(v, el); } });
		return el;
	},
	addEventListener(name, fn) { listeners[name]?.add(fn); },
	removeEventListener(name, fn) { listeners[name]?.delete(fn); },
};
let clipboardText = null;
Object.defineProperty(globalThis, "navigator", { value: { clipboard: { writeText(text) { clipboardText = text; return Promise.resolve(); } } }, configurable: true });

let fetchCalls = [];
let fetchReply = { ok: true, json: async () => ({ ok: true, root: "/repo", branch: "main", sha: "abc1234", detached: false, dirtyCount: 0 }) };
globalThis.fetch = async (url, options) => {
	fetchCalls.push({ url: String(url), options });
	return fetchReply;
};

// ---- 静态外部模块表 -----------------------------------------------------
const ReactJSX = require_("react/jsx-runtime");
const primitives = {
	Tooltip: ({ label, children }) => React.createElement("span", { className: "stub-tooltip", "data-label": label }, children),
	IconBranchOutlineRegular: () => React.createElement("span", { className: "stub-icon-branch" }),
	IconCheckOutlineRegular: () => React.createElement("span", { className: "stub-icon-check" }),
};
const moduleTable = new Map([
	["react", React],
	["react/jsx-runtime", ReactJSX],
	["@deepseek-ai/dsh-client-ui-primitives", primitives],
]);
const moduleRequire = (id) => {
	if (!moduleTable.has(id)) throw new Error(`test: module "${id}" not in table`);
	return moduleTable.get(id);
};

// ---- 执行真实 bundle ----------------------------------------------------
let capturedRegistration;
await import(pathToFileURL(new URL("../lib/client.js", import.meta.url).pathname).href);
if (capturedRegistration === undefined) throw new Error("bundle did not register");
if (capturedRegistration.id !== "dsh-git-branch-indicator") throw new Error("wrong id");
const clientModule = capturedRegistration.factory(moduleRequire);
if (typeof clientModule.apply !== "function") throw new Error("no apply");
if (JSON.stringify(clientModule.inject) !== JSON.stringify(["sessions", "locale"])) throw new Error("wrong inject");

// ---- 桩化的 cordis 上下文 -----------------------------------------------
function makeSessionsStore(initial) {
	let snapshot = initial;
	const subs = new Set();
	return {
		get list() {
			return {
				getSnapshot: () => snapshot,
				subscribe(listener) { subs.add(listener); return () => subs.delete(listener); },
			};
		},
		publish(next) { snapshot = next; for (const l of subs) l(); },
	};
}
const zh = {
	copy: "复制分支名", copied: "已复制", detached: "分离提交", dirty: "有未提交改动",
	clean: "工作区干净", repoRoot: "仓库根目录", commit: "提交", changes: "处改动",
};
const t = (key) => zh[key] ?? key;

let registered = null;
const effects = [];
const fakeCtx = {
	effect(fn) { const dispose = fn(); effects.push(dispose); return dispose; },
	inject(list, cb) {
		if (list.join(",") !== "slots,sessions") throw new Error(`unexpected inject list ${list}`);
		cb({
			slots: {
				inject(name, callback) {
					if (name !== "conversation.input.left") throw new Error(`unexpected slot ${name}`);
					callback();
				},
				register(descriptor, Component) { registered = { descriptor, Component }; },
			},
			sessions: undefined, // 由 apply 闭包注入，这里占位
		});
	},
	locale: { register() { return () => {}; } },
};
const sessions = makeSessionsStore({ byId: { s1: { cwd: "/Users/fox/repo" }, s2: { cwd: "/tmp" } } });
fakeCtx.inject = (list, cb) => {
	cb({
		slots: {
			inject(name, callback) { callback(); },
			register(descriptor, Component) { registered = { descriptor, Component }; },
		},
		sessions,
	});
};

clientModule.apply(fakeCtx);
if (registered === null) throw new Error("slot component not registered");
const { descriptor, Component } = registered;
if (descriptor.name !== "conversation.input.left") throw new Error("wrong slot name");
if (descriptor.id !== "git-branch-indicator") throw new Error("wrong entry id");
if (descriptor.locale !== "gitbranch.chip") throw new Error("wrong locale ns");
const injectedProps = descriptor.inject("s1");
if (injectedProps.sessionId !== "s1") throw new Error("inject props wrong");

// ---- 渲染测试 -----------------------------------------------------------
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function mount(sessionId) {
	let instance;
	await TestRenderer.act(async () => {
		instance = TestRenderer.create(React.createElement(Component, { t, sessionId }));
	});
	return instance;
}

const results = [];
const check = (name, pass, detail = "") => {
	results.push([name, pass]);
	console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

// 1. 正常分支 + 干净
fetchCalls = [];
let tree = await mount("s1");
await TestRenderer.act(async () => { await sleep(10); });
let text = JSON.stringify(tree.toJSON());
check("renders branch name", text.includes("main"), text.slice(0, 200));
check("style injected once", styleElements.length === 1 && styleElements[0].id === "dsh-git-branch-style", `count=${styleElements.length}`);
check("fetches with cwd param", fetchCalls.length === 1 && fetchCalls[0].url.includes("cwd=%2FUsers%2Ffox%2Frepo"), fetchCalls[0]?.url);
check("no dirty dot when clean", !text.includes("dshgb-dot"));

// 2. 脏仓库 → 显示圆点 + 计数
fetchReply = { ok: true, json: async () => ({ ok: true, root: "/repo", branch: "feature/x", sha: "abc1234", detached: false, dirtyCount: 123 }) };
await TestRenderer.act(async () => { listeners.focus.forEach((fn) => fn()); await sleep(10); });
text = JSON.stringify(tree.toJSON());
check("dirty count capped at 99+", text.includes("99+") && text.includes("dshgb-dot"));

// 3. detached → 显示短提交号
fetchReply = { ok: true, json: async () => ({ ok: true, root: "/repo", branch: null, sha: "abc1234", detached: true, dirtyCount: null }) };
await TestRenderer.act(async () => { listeners.focus.forEach((fn) => fn()); await sleep(10); });
text = JSON.stringify(tree.toJSON());
check("detached shows label + sha", text.includes("分离提交") && text.includes("abc1234"));

// 4. 非 git 目录 → 不渲染
fetchReply = { ok: true, json: async () => ({ ok: false, reason: "not-a-repository" }) };
await TestRenderer.act(async () => { listeners.focus.forEach((fn) => fn()); });
text = JSON.stringify(tree.toJSON());
check("hidden outside a repository", text === "null", text.slice(0, 100));

// 5. 恢复正常分支后点击复制
fetchReply = { ok: true, json: async () => ({ ok: true, root: "/repo", branch: "release/1.2", sha: "abc1234", detached: false, dirtyCount: 3 }) };
await TestRenderer.act(async () => { listeners.focus.forEach((fn) => fn()); await sleep(10); });
const button = tree.root.findByType("button");
await TestRenderer.act(async () => { button.props.onClick(); await sleep(5); });
check("click copies branch name", clipboardText === "release/1.2", `clipboard=${clipboardText}`);
text = JSON.stringify(tree.toJSON());
check("copied feedback", text.includes("已复制"));

// 6. cwd 变化 → 重新查询
fetchCalls = [];
await TestRenderer.act(async () => { sessions.publish({ byId: { s1: { cwd: "/Users/fox/other" } } }); await sleep(10); });
check("refetches when cwd changes", fetchCalls.length >= 1 && fetchCalls[fetchCalls.length - 1].url.includes("%2FUsers%2Ffox%2Fother"));

// 7. 无会话 → 不渲染
const tree2 = await mount("s-missing");
await TestRenderer.act(async () => { await sleep(5); });
check("hidden without session", JSON.stringify(tree2.toJSON()) === "null");

// 8. 卸载清理（间隔计时器等）
await TestRenderer.act(async () => { tree.unmount(); tree2.unmount(); });
check("unmount clean", true);

const failures = results.filter(([, pass]) => !pass).length;
if (failures > 0) { console.error(`${failures} client case(s) failed`); process.exit(1); }
console.log("client: all cases passed");
