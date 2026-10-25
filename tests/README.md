# 冒烟测试

在本目录先安装依赖（只需要一次）：

```
npm install
```

然后运行：

```
node test-host.mjs    # 宿主半：对临时目录里的真实 git 仓库跑 7 种状态
node test-client.mjs  # 浏览器半：桩化 __ModuleLoader__/react/primitives，
                      # 真实执行 bundle 的 factory+apply，react-test-renderer
                      # 完整挂载并断言 12 项渲染行为
```

或 `npm test` 一次跑两个。
