# AGENTS.md — 给所有 AI 编码助手

本仓库的完整交接文档、产品契约、架构地图与验证要求在 [CLAUDE.md](./CLAUDE.md),对任何 AI 助手(Codex、Cursor 等)同样适用。**开工前先完整读完它**,再按其中第 1 节的顺序读 docs。本文件只是入口与红线速览,不重复正文;两处有出入时以 CLAUDE.md 为准。

## 红线速览

违反任何一条都算破坏性变更,不接受"为了兼容/为了测试通过"的理由:

1. **用户 prompt 默认逐字提交**。`assertPromptByteIdentity()` 防线不许删、不许放宽;显式用户操作改变提交内容时必须记录 `promptProvenance: "user-controls"`。
2. **只从显式 pick / edit / reject 学习**。浏览、保留、删除图片都不是偏好证据。
3. **长期规则只进 critic 评审与需用户确认的参谋草稿**(suggest 辅助重试、主「AI 优化提示词」),refine-note 不注入;规则永远不直接拼进提交给生图模型的 prompt。`TasteCandidate.target` 锁死为 `critic`。
4. **品味数据表全部 append-only**:`feedbackEvents`、`candidateDecisions`、`promptSuggestionDecisions`、`suggestionOutcomes`、`inducedRuleProposals`。改决定就追加新记录,不原地改、不删除。
5. **DQ 是确定性硬门**:模型只报告可见事实,客户端裁决;DQ 图仍允许用户查看并显式选定。
6. **双端语义一致**:桌面 Wails 与 Android/remote kernel 行为不得分叉;`shared/kernel/requestModel.js` 与 `image-studio/backend/prompt_optimize.go` 的 instruction 必须逐字一致,由 `frontend/test/promptModeParity.test.mjs` 守卫——**instruction 文本里不能出现双引号**(守卫用 Go 正则 `"([^"]*)"` 提取,会被截断)。
7. **不删除、skip 或弱化测试来制造全绿**。既有失败基线(runtimeHost 4 项、backend cleanup-dirs 1 项)与新增失败必须如实区分。
8. **不进 git 的东西**:API key/token、用户 prompt/图片、raw response、IndexedDB、本机日志、`.dev-env/`(本机隔离工具链,靠 `.git/info/exclude` 排除,不要 `git add -f`)。commit 不加 `Co-Authored-By`。

## 仓库速查

- 当前分支 `agent/personal-taste-loop`;只推 `origin`(SipengXie2024/Image-Studio),不向 upstream 推送。
- 许可证 AGPL-3.0:分发修改版或作为网络服务提供时必须公开对应源码。
- 常用命令(测试、构建、本机 EXE 打包)见 CLAUDE.md 第 6、7 节;工作区可能有未提交的迭代改动,动手前先 `git status --short --branch` 和 `git diff`,不要 reset/checkout 覆盖不属于当前任务的文件。
- 面向使用者的功能说明:[README.md](./README.md) 的「本 Fork:个人品味闭环 harness」一节与 [docs/personal-taste-loop.md](./docs/personal-taste-loop.md)。
