/**
 * dsh-git-branch-indicator — 宿主半。
 *
 * 在 Connection 的认证栅栏内注册一个只读 GET 路由
 * `/api/git-branch/summary?cwd=<绝对路径>`，用只读 git 命令汇报该目录
 * 所属仓库的分支状态：分支名、短提交号、是否分离头指针、未提交改动数。
 * 不写任何仓库状态（GIT_OPTIONAL_LOCKS=0，且只运行 rev-parse /
 * symbolic-ref / status --porcelain 这类只读命令）。
 */
import { execFile } from "node:child_process";
import { isAbsolute } from "node:path";

/** 认证 GET 路由地址（Connection fetch 表按精确路径匹配）。 */
const SUMMARY_PATH = "/api/git-branch/summary";
/** 单条 git 命令的时限；超时按失败处理，绝不让请求挂住。 */
const GIT_TIMEOUT_MS = 5000;
/** `git status --porcelain` 在超大仓库可能很慢，用更紧的时限，超时只丢弃脏标记。 */
const STATUS_TIMEOUT_MS = 3500;
/** 输出缓冲上限（porcelain 每行最多几百字节，4 MiB 足够极端仓库）。 */
const MAX_BUFFER = 4 * 1024 * 1024;
/** 禁止交互、禁止写索引、固定 locale，保持输出稳定。 */
const GIT_ENV = {
	GIT_TERMINAL_PROMPT: "0",
	GIT_OPTIONAL_LOCKS: "0",
	LC_ALL: "C",
};

/** 所需宿主服务：Connection 提供带认证的 fetch 路由表。 */
const inject = ["connection"];

/**
 * 运行一条 git 命令并归一化结果。execFile 不经 shell，参数以数组传递；
 * 超时或请求中止时杀掉子进程。永不 reject，调用方按 code 分支。
 * @param {string[]} args git 参数。
 * @param {string} cwd 工作目录。
 * @param {number} timeoutMs 时限（毫秒）。
 * @param {AbortSignal | undefined} signal 请求中止信号。
 * @returns {Promise<{code: number, stdout: string, stderr: string, timedOut: boolean}>}
 */
function git(args, cwd, timeoutMs, signal) {
	return new Promise((resolve) => {
		let child;
		let timedOut = false;
		let settled = false;
		const finish = (result) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve(result);
		};
		const timer = setTimeout(() => {
			timedOut = true;
			try {
				child?.kill("SIGKILL");
			} catch {}
		}, timeoutMs);
		try {
			child = execFile(
				"git",
				args,
				{
					cwd,
					timeout: timeoutMs,
					killSignal: "SIGKILL",
					maxBuffer: MAX_BUFFER,
					windowsHide: true,
					env: { ...process.env, ...GIT_ENV },
					...signal === undefined ? {} : { signal },
				},
				(error, stdout, stderr) => {
					const code = error === null || error === undefined
						? 0
						: typeof error.code === "number" ? error.code : 127;
					finish({
						code,
						stdout: typeof stdout === "string" ? stdout : String(stdout ?? ""),
						stderr: typeof stderr === "string" ? stderr : String(stderr ?? ""),
						timedOut: timedOut || error?.killed === true,
					});
				},
			);
		} catch (error) {
			finish({ code: 127, stdout: "", stderr: String(error), timedOut: false });
		}
	});
}

/** 截取一段输出作为诊断尾巴，去掉首尾空白。 */
function tail(text) {
	const flat = String(text ?? "").trim();
	if (flat === "") return "";
	const lines = flat.split("\n");
	return lines.slice(-3).join("\n");
}

/** no-store JSON 响应。 */
function json(payload, status = 200) {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
	});
}

/**
 * 读取一个目录的分支状态。
 * @param {string} cwd 绝对路径。
 * @param {AbortSignal | undefined} signal 请求中止信号。
 * @returns {Promise<Response>} JSON 响应。
 */
async function summarize(cwd, signal) {
	const located = await git(["rev-parse", "--show-toplevel"], cwd, GIT_TIMEOUT_MS, signal);
	if (located.code === 128 && /not a git repository/i.test(located.stderr)) {
		return json({ ok: false, reason: "not-a-repository" });
	}
	if (located.code !== 0 || located.stdout.trim() === "") {
		if (/must be run in a work tree|bare repository/i.test(located.stderr)) {
			return json({ ok: false, reason: "not-a-repository" });
		}
		return json({ ok: false, reason: "error", message: tail(located.stderr || located.stdout) });
	}
	const root = located.stdout.trim();
	const [branchRun, shaRun, statusRun] = await Promise.all([
		git(["symbolic-ref", "--quiet", "--short", "HEAD"], cwd, GIT_TIMEOUT_MS, signal),
		git(["rev-parse", "--short", "HEAD"], cwd, GIT_TIMEOUT_MS, signal),
		git(["status", "--porcelain"], cwd, STATUS_TIMEOUT_MS, signal),
	]);
	const branch = branchRun.code === 0 ? branchRun.stdout.trim() : null;
	const sha = shaRun.code === 0 ? shaRun.stdout.trim() : null;
	const detached = branch === null;
	let dirtyCount = null;
	if (statusRun.code === 0 && !statusRun.timedOut) {
		dirtyCount = statusRun.stdout.split("\n").filter((line) => line.trim() !== "").length;
	}
	return json({ ok: true, root, branch, sha, detached, dirtyCount });
}

/**
 * 插件体：注册认证路由。路由生命周期挂在自身 fiber 上，卸载即注销。
 * @param {import("@deepseek-ai/cordis").Context} ctx 宿主上下文。
 */
function apply(ctx) {
	ctx.effect(() => ctx.connection.fetch.register({
		path: SUMMARY_PATH,
		methods: ["GET"],
		requestBody: "buffered",
		fetch: (request) => {
			const url = new URL(request.url);
			const cwd = url.searchParams.get("cwd") ?? "";
			if (cwd === "" || cwd.includes("\0") || cwd.length > 4096 || !isAbsolute(cwd)) {
				return Promise.resolve(json({ ok: false, reason: "invalid-cwd" }, 400));
			}
			return summarize(cwd, request.signal);
		},
	}), "git-branch-indicator: summary route");
}

export { apply, inject, summarize };
