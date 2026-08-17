# TokenGauge

[English](README.md) | **简体中文**

macOS 悬浮用量看板：多账号、多供应商展示 AI 服务用量/配额/余额。**插件化 Provider 架构**，内置「火山方舟」
（Agent Plan / Coding Plan 的 5小时/7天/每月 三档进度 + 重置倒计时，<70% 绿 / 70–89% 橙 / ≥90% 红），
另有 DeepSeek 余额示例插件开箱即用，任何服务商都可自行接入。

火山方舟查询逻辑移植自 [cc-switch](https://github.com/cc-switch/CCSwitch) 的 `coding_plan.rs`：
火山**控制面 OpenAPI**（`open.volcengineapi.com`）+ **签名 V4**（AK/SK），先探测 `GetAFPUsage`（Agent Plan），
未订阅自动回退 `GetCodingPlanUsage`（Coding Plan）。多账号并发查询（`Promise.allSettled`）。

## 使用

```bash
npm install        # 首次
npm start          # 启动看板（无 Dock 图标，托盘常驻）
```

- 托盘图标：**左键显示面板，右键打开菜单**（设置… / 立即刷新 / 隐藏 / 退出）；顶部三点可拖动面板
- 设置页添加/编辑/删除账号：先选供应商，凭据表单按其声明动态渲染
- 界面语言支持**中英文切换**（设置页 Language，默认跟随系统）
- 配置存 macOS 规范目录 `~/Library/Application Support/TokenGauge/config.json`（权限 600）
- 自动刷新默认 30 秒（设置页可改，≥5 秒）；面板底部固定 DeepSeek 高峰/空闲时段时间轴
  （高峰：北京时间 9:00-12:00、14:00-18:00）

## Provider 插件（贡献查询逻辑）

用量查询已抽象为 Provider 契约。任何服务商都能以 JS 插件形式接入：

```bash
# 插件目录（设置页「插件目录」按钮直达）
~/Library/Application Support/TokenGauge/providers/
```

**契约**：`module.exports = { id, name, fields[], query(credentials) }`
- `id` 全局唯一；`fields` 声明凭据字段（设置页动态渲染表单）
- `query` 返回 `{ ok, plan?, tiers: [{ name, utilization(0-100), resetsAt? }], queriedAt }`
- 并发调用；抛异常或 `ok:false` 只影响该账号面板
- 完整模版见仓库 `providers/example.js`（DeepSeek 余额，首次运行自动复制到插件目录）

改动插件后重启应用生效。插件在主进程运行，请只安装自己信任的代码（同 VS Code 扩展模型）。

## 打包分发（macOS）

```bash
make dist-arm64      # Apple Silicon dmg（默认分发，约 93MB）
make dist-x64        # Intel dmg
make dist-universal  # 双架构通用 dmg（体积翻倍）
```

（或 `npm run dist` / `npm run dist:x64`；`make help` 查看全部命令）

- 图标：`node scripts/gen-app-icon.js` 重生成母版后重跑 icns 步骤（见 scripts/）
- **发给朋友**：把 dmg 发过去，拖入"应用程序"即可；已签名但未公证（公证需 Apple Developer 账号），
  首次打开需**右键 -> 打开 -> 再点打开**（或在 系统设置 -> 隐私与安全性 -> 仍要打开）。
- 打包版与开发版共用 `~/Library/Application Support/TokenGauge/`，且共用单实例锁，两者同时只能运行一个。

## 开发

```bash
make selftest   # 签名 V4 / 档位解析 / 配置迁移的确定性自检（向量与 cc-switch 单测一致）
make smoke      # 启动冒烟：窗口加载即自动退出
make build
```
