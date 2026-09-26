# AGENTS.md

Spiral Day：把 Nautilus Log v1.0.2 工作流移植到 Obsidian 的桌面插件。

- 术语以 `CONTEXT.md` 为准；契约优先级以 `docs/implementation-dossier.md` 为准，改契约时两者同步。改设计约束前先读 `docs/decisions/`，与上游行为的差异记进 `docs/deviations/`。
- 插件只在显式操作后写 Markdown：刷新保持只读，每次写入先重读源文件，源已变化或目标有歧义就失败关闭。不发网络请求，不加遥测。
- 校验：`npm run verify`（clean、tsc、测试、build）；改发布或溯源相关时加 `npm run validate:provenance` 和 `node --test tests/release/*.test.mjs`；改规划文档时加 `node scripts/check-planning-docs.mjs --sha HEAD`。
