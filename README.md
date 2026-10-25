# dsh-git-branch-indicator

在 [DeepSeek Harness](https://github.com/deepseek-ai)（DSH）聊天输入区显示当前会话工作目录的 **git 分支**。

Show the current **git branch** of the session's working directory beside the DSH chat input.

## 效果

- 徽章位置：输入框左下工具行（"+" 按钮旁边），显示分支图标 + 分支名
- detached HEAD 时显示「分离提交 + 短提交号」
- 有未提交改动时显示小圆点 + 改动数（99+ 封顶）
- 悬停显示仓库根目录、分支、提交号、改动状态的完整信息
- 点击复制分支名
- cwd 变化、窗口重新聚焦、每 15 秒自动刷新；非 git 目录自动隐藏

## 安装

在 DSH 桌面版：**设置 → 插件 → 添加插件**，粘贴以下任意一种规格后安装
（插件管理器热加载，无需重启应用；徽章没出现就刷新一下页面）：

```
github:Evil-king/dsh-git-branch-indicator
```

或使用本地克隆路径：

```
git clone https://github.com/Evil-king/dsh-git-branch-indicator.git
# 添加插件时粘贴克隆目录的绝对路径
```

CLI 方式（安装后需重启 DSH 生效）：

```
dsh plugin --profile desktop add github:Evil-king/dsh-git-branch-indicator
```

## 卸载

设置 → 插件 中移除 `dsh-git-branch-indicator`，或：

```
dsh plugin --profile desktop remove dsh-git-branch-indicator
```

## 工作原理

- 宿主半（`lib/index.js`）：在 Connection 认证栅栏内注册只读路由
  `GET /api/git-branch/summary?cwd=<绝对路径>`，只运行
  `rev-parse` / `symbolic-ref` / `status --porcelain` 这类只读 git 命令
  （带超时、`GIT_OPTIONAL_LOCKS=0`、不经 shell，不写任何仓库状态）。
- 浏览器半（`lib/client.js`）：以官方客户端 bundle 格式手写
  （`window.__ModuleLoader__.load` 注册，无构建步骤），把徽章注册进
  `conversation.input.left` 插槽；复用官方 `Tooltip` 与
  `IconBranchOutlineRegular` 图标和设计令牌，视觉与原生一致。
- `cordis.patch.yml`：bundle 补丁，向 Loader 插入 `git-branch-indicator` 条目。

## 开发与测试

```
cd tests && npm install && npm test
```

- `tests/test-host.mjs`：对临时目录里的真实 git 仓库跑 7 种状态
  （干净 / 脏 / 分离头指针 / 未出生分支 / 非仓库 / 缺失目录 / 相对路径拒绝）。
- `tests/test-client.mjs`：桩化 `__ModuleLoader__` / react / primitives，
  真实执行 bundle 的 factory + apply，用 react-test-renderer 完整挂载，
  断言 12 项渲染行为（分支渲染、脏计数封顶、detached、隐藏、复制、
  cwd 切换重查、样式单次注入、卸载清理等）。

## License

[MIT](./LICENSE)
