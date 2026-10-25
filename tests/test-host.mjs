import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { summarize } from "../lib/index.js";

const root = mkdtempSync(join(tmpdir(), "dshgb-test-"));
const run = (cmd, cwd) => execFileSync(cmd.split(" ")[0], cmd.split(" ").slice(1), { cwd, stdio: "pipe" }).toString();

function makeRepo(name, setup) {
	const dir = join(root, name);
	mkdirSync(dir, { recursive: true });
	run("git init -b main", dir);
	run("git config user.email t@t", dir);
	run("git config user.name t", dir);
	setup?.(dir);
	return dir;
}

const cases = [];

// 1. 普通仓库：一个提交，干净
const clean = makeRepo("clean", (d) => {
	writeFileSync(join(d, "a.txt"), "hello\n");
	run("git add .", d);
	run('git commit -m "init"', d);
});
cases.push(["clean", clean, (r) => r.ok === true && r.branch === "main" && typeof r.sha === "string" && r.dirtyCount === 0 && r.detached === false]);

// 2. 脏仓库：2 处改动
const dirty = makeRepo("dirty", (d) => {
	writeFileSync(join(d, "a.txt"), "hello\n");
	run("git add .", d);
	run('git commit -m "init"', d);
	writeFileSync(join(d, "a.txt"), "changed\n");
	writeFileSync(join(d, "b.txt"), "new\n");
});
cases.push(["dirty", dirty, (r) => r.ok === true && r.branch === "main" && r.dirtyCount === 2]);

// 3. 分离头指针
const detached = makeRepo("detached", (d) => {
	writeFileSync(join(d, "a.txt"), "hello\n");
	run("git add .", d);
	run('git commit -m "init"', d);
	run("git checkout --detach", d);
});
cases.push(["detached", detached, (r) => r.ok === true && r.branch === null && r.detached === true && typeof r.sha === "string" && r.sha.length >= 7]);

// 4. 未出生分支（git init 后没有提交）
const unborn = makeRepo("unborn");
cases.push(["unborn", unborn, (r) => r.ok === true && r.branch === "main" && r.sha === null && r.detached === false]);

// 5. 非 git 目录
const notRepo = join(root, "notrepo");
mkdirSync(notRepo);
cases.push(["not-a-repo", notRepo, (r) => r.ok === false && r.reason === "not-a-repository"]);

// 6. 不存在的目录
cases.push(["missing-dir", join(root, "nope"), (r) => r.ok === false]);

// 7. 相对路径被拒
cases.push(["relative", "relative/path", (r) => r.ok === false]);

let failures = 0;
for (const [name, cwd, check] of cases) {
	const response = await summarize(cwd, undefined);
	const body = await response.json();
	const pass = check(body);
	console.log(`${pass ? "PASS" : "FAIL"}  ${name}: ${JSON.stringify(body).slice(0, 160)}`);
	if (!pass) failures++;
}

rmSync(root, { recursive: true, force: true });
if (failures > 0) {
	console.error(`${failures} case(s) failed`);
	process.exit(1);
}
console.log("host: all cases passed");
