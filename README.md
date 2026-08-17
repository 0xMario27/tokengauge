# Ark 用量便签 (ark-usage-widget)

macOS 便签式小工具：展示多个火山方舟账号的 **Agent Plan / Coding Plan 用量**，显示方式与 CC Switch 一致
（套餐标签 + 5小时/7天/每月 三档百分比徽章 + 重置倒计时，<70% 绿 / 70–89% 橙 / ≥90% 红）。

查询逻辑移植自 [cc-switch](https://github.com/cc-switch/CCSwitch) 的 `coding_plan.rs`：
火山**控制面 OpenAPI**（`open.volcengineapi.com`）+ **签名 V4**（AK/SK），先探测 `GetAFPUsage`（Agent Plan），
未订阅自动回退 `GetCodingPlanUsage`（Coding Plan）。多账号并发查询（`Promise.allSettled`）。

## 使用

```bash
npm install        # 首次
npm start          # 启动便签（无 Dock 图标，托盘常驻；托盘可显示/隐藏、刷新、退出）
```

- 点便签右上角 ⚙ 添加/编辑/删除账号（别名 + AccessKey ID + SecretAccessKey + Region），
  配置自动保存到 macOS 规范目录 `~/Library/Application Support/ark-usage-widget/config.json`
- 自动刷新默认 30 秒一次，可在设置页修改（≥5 秒），也可点 ⟳ 手动刷新
- 便签可拖动（记位置）、跨所有桌面/全屏空间可见；✕ 隐藏到托盘
- 「在 Finder 中显示配置」可直达配置文件；「删除全部配置」清空所有账号

## Provider 插件（贡献查询逻辑）

用量查询已抽象为 Provider 契约，内置「火山方舟」。任何服务商都能以 JS 插件形式接入：

```bash
# 插件目录（设置页「插件目录」按钮直达）
~/Library/Application Support/ark-usage-widget/providers/
```

**契约**：`module.exports = { id, name, fields[], query(credentials) }`
- `id` 全局唯一；`fields` 声明凭据字段（设置页动态渲染表单）
- `query` 返回 `{ ok, plan?, tiers: [{ name, utilization(0-100), resetsAt? }], queriedAt }`
- 并发调用；抛异常或 `ok:false` 只影响该账号面板
- 完整模版见仓库 `providers/example.js`（DeepSeek 余额，首次运行自动复制到插件目录）

改动插件后重启应用生效。插件在主进程运行，请只安装自己信任的代码（同 VS Code 扩展模型）。

## 打包分发（macOS）

```bash
npm run dist    # 产出 release/ark-usage-widget-0.1.0-universal.dmg（Universal，Intel/Apple Silicon 通用）
```

- 图标：`node scripts/gen-app-icon.js` 重生成母版后重跑 icns 步骤（见 scripts/）
- **发给朋友**：把 dmg 发过去，拖入"应用程序"即可；因未做公证（需 Apple Developer 账号），
  首次打开需**右键 -> 打开 -> 再点打开**（或在 系统设置 -> 隐私与安全性 -> 仍要打开）。
- 打包版与开发版共用 `~/Library/Application Support/ark-usage-widget/config.json`，
  且共用单实例锁，两者同时只能运行一个。

## 开发

```bash
npm run selftest   # 签名 V4 与档位解析的确定性自检（向量与 cc-switch 单测一致）
npm run build
npx electron . --smoke   # 启动冒烟：窗口加载即自动退出
```
