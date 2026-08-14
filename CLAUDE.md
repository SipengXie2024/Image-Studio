# CLAUDE.md — Image Studio 品味学习分支交接

## 1. 先读这里

这是 `RoseKhlifa/Image-Studio` 的用户 fork，目标是在不训练模型、不暗改 prompt 的前提下，把 Image Studio 从直接调用生图 API 的客户端扩展为可持续积累用户品味的 harness。

- fork：`https://github.com/SipengXie2024/Image-Studio.git`
- upstream：`https://github.com/RoseKhlifa/Image-Studio.git`
- 当前分支：`agent/personal-taste-loop`
- Draft PR：`https://github.com/SipengXie2024/Image-Studio/pull/1`
- 许可证：GNU AGPL v3

只向 `origin` 推送本分支；不要向 `upstream` 推送。不要修改相邻的 `image-harness/penguin-harness/`：这个 fork 的闭环直接实现在 Image Studio 的 frontend/store/IndexedDB/critic 中，并未嵌入 PenguinHarness。

开始工作前依次阅读：

1. `README.md`
2. `docs/project-structure.md`
3. `docs/personal-taste-loop.md`
4. `docs/no-prompt-revision/README.md`
5. `docs/build.md`

## 2. 不可违反的产品契约

### 2.1 用户 prompt 默认逐字提交

- 未启用任何显式用户控制时，`originalPrompt` 与 `submittedPrompt` 必须字节一致。
- 不得在后台扩写、润色、翻译、拼接“更好的 prompt”，也不得把长期品味规则偷偷注入生成 prompt。
- style chip、画布标注、用户亲自输入的编辑建议等显式操作可以改变实际提交内容；此时必须记录 `promptProvenance: "user-controls"`。
- 保持 `assertPromptByteIdentity()` 这条防线。不要为了兼容某个上游而删除或放宽它。

### 2.2 只从明确反馈学习

可作为强偏好证据的操作只有：

- `pick`：用户明确选定一张图；
- `edit`：用户选定一张图并逐字提出修改建议；
- `reject`：用户明确表示整批都不满意，可选填原因。

普通点击预览、打开历史、保留/删除图片、再次查看图片，都不能推断为喜欢或不喜欢。无文字的 pick/reject 仍是视觉判例，但不能凭空生成自然语言规则。

### 2.3 旧历史只能作为弱证据

旧版历史没有可靠的 pick/reject 语义。启动层只从历史里的显式 `styleTag` 和 `negativePrompt` 提取“曾请求过”的候选；候选默认 `pending`，必须由用户逐条 approve/reject。不要从 prompt、`revisedPrompt`、保存、删除或浏览次数推断品味。

### 2.4 长期规则只作用于 critic 与需确认的参谋草稿

- `TasteCandidate.target` 必须是 `critic`。
- 只有用户批准的候选进入 `ApprovedCriticRulesSnapshot`，用于评分、排序、DQ 和补抽。
- 已批准规则还会作为上下文进入两条参谋通道：suggest（reject 后的辅助重试草稿，走请求 JSON 的 `approvedRules` 字段）与主「AI 优化提示词」（`withApprovedTastePreferences` 在 prompt 尾部拼 marked guidance section）。两条通道的产出都必须是用户可见、可编辑、经确认才提交的草稿，且 UI 要标明结合了几条规则。
- refine-note（编辑建议转写）刻意不注入规则：它的契约是忠实转写用户原意，不得夹带未请求的方向。
- 规则永远不直接拼进提交给生图模型的 prompt。`buildApprovedCriticRulesSnapshot()` 对非 critic target 的拒绝是产品安全边界，不要移除。

### 2.5 feedback 与 decision 是 append-only

- `feedbackEvents`、`candidateDecisions`、`promptSuggestionDecisions`、`suggestionOutcomes`、`inducedRuleProposals` 使用新增记录表达事实与后续决定，不覆盖旧事件。
- 更改决定时追加新的 decision，以最新一条作为当前状态；不要原地修改或删除旧决定。
- 写 feedback 时同时保存可用的视觉判例资源，避免只剩容易失效的 history 引用。
- 测试不能污染真实用户数据；不要为了修测试清空 IndexedDB。

### 2.6 视觉判例是一等数据

- pick/edit 保存所选图为正向视觉判例；reject 保存整批为负向视觉判例。
- critic 读取最近的正/负判例图片与原文 note，而不只读取自然语言摘要。
- edit 判例代表“以这张图为基线，保留未被 note 指定修改的身份和视觉特征”；note 要求改变的特征不能被误当成正向偏好。
- API key、token、请求头等敏感信息不得进入 `image-studio-taste`。

### 2.7 DQ 是确定性硬门，不是模型自由裁决

DQ（disqualified）当前只包含：

- `multiple-primary-subjects`
- `multi-view-layout`

当原始任务明确是单角色、单视图时，critic 只报告可见事实 `multiplePrimarySubjects` / `multiViewLayout`，客户端据此确定性 DQ。critic 不得自行决定排名或 DQ。若 prompt 明确要求多人、多视图、拼版，则关闭该硬门。

edit 轮默认继承源图的 hard gate；只有编辑建议明确要求新增角色、对手、视角或面板时才重新分类并允许多主体/多视图。DQ 图片仍须允许用户查看并显式选中，自动门槛不能替用户做不可逆决定。

## 3. 当前实现状态（2026-08-14）

已提交到当前分支：

- `dfbb9e5`：用户可控的个人品味闭环、历史启动层、视觉判例、critic 规则与 DQ/补抽。
- `19bdb39`：批次对比始终可返回；点击单图进入大图预览但不丢失批次选择入口；支持缩略图、前后切换、返回全部。
- `c170f69`：隔离批次预览 fixture，避免开发预览写入真实品味反馈。
- `442fc86`：“选定并提出建议”保存一次 edit feedback 和视觉判例后，以选中图为唯一 edit source、以用户建议原文为 prompt 自动续跑；edit 批次进入 critic/DQ/一次补抽循环，并继承或按显式多人/多视图要求解除 hard gate。
- `78ed2d7`：Images API 流式响应没有最终图片时，自动改用非流式 `b64_json` 兼容模式重试一次；显式 error/failed 事件保留真实原因。frontend remote kernel 与 Go client 行为一致。
- `1327e34`：品味闭环开发交接文档。

**工作区另有大量未提交改动（2026-08-14 迭代，均已通过全量验证与 EXE 冒烟）**，主要包括：

- reject → harness 辅助重试闭环：suggest mode 起草改进 prompt → 对照弹窗确认/编辑/拒绝 → 采纳续跑；决定入 `promptSuggestionDecisions` 表；`submit()` 支持 `{promptProvenance, disableLoop}` options。
- 规则蒸馏三通道（distill-rule / 手动编辑 / revise-rule）、edit 弹窗「让 harness 优化」（refine-note）、删除预设风格 chips。
- 品味面板 TastePanel（候选记录/生效规则/反馈判例/建议采纳史 四 tab；FooterBar「学习经验」常驻入口）与建议效果统计（`suggestionOutcomes` 表）。
- 「从历史学习」：induce-rules mode 让 AI 从判例与建议史归纳规则候选，落 append-only `inducedRuleProposals` 表（IndexedDB v5），候选 id 按规则文本 hash 去重。
- 已批准规则注入 suggest 与主「AI 优化提示词」两条参谋通道（见契约 2.4）；default/edit/suggest 及全部文本 mode 的 instruction 有双端字节一致守卫（`test/promptModeParity.test.mjs`；**新增 instruction 不得含双引号**，否则 Go 侧正则提取会截断）。
- 历史右键「重新进入批次评审」；`HistoryItem.sourcePaths` 写入修复（此前只读不写）；批次评审按钮实体化；品味 UI 一律用 unlayered 手写类（`styles/_taste.css`，Windows WebView 下部分 tailwind layered utilities 不渲染）。

接手时先运行 `git status --short --branch` 和 `git log -7 --oneline`，以仓库实际状态为准。

## 4. 关键架构与文件

仓库总体是 Wails（Go）+ React/TypeScript 桌面端，并有 Android WebView、Cloudflare Worker、Gio 客户端和共享 Go client。跨平台请求行为不要只修一条路径。

### 品味闭环

- `image-studio/frontend/src/lib/tasteStorage.ts`
  - `image-studio-taste` IndexedDB（v5）；`feedbackEvents`、`candidateDecisions`、`documents`、`visualExemplars`、`promptSuggestionDecisions`、`suggestionOutcomes`、`inducedRuleProposals`。
- `image-studio/frontend/src/lib/tasteLearning.ts`
  - prompt 字节一致性、旧历史弱候选、显式反馈候选、批准后的 critic rules snapshot。
- `image-studio/frontend/src/lib/tasteCritic.ts`
  - critic request/schema、视觉判例、hard-gate 分类、确定性 DQ/rank/top-3、一次补抽规划。
- `image-studio/frontend/src/state/studioStore.taste.ts`
  - bootstrap、candidate 决策、pick/edit/reject 的事务顺序、视觉判例采集、auto-refine 入口。
- `image-studio/frontend/src/state/studioStore.critic.ts`
  - 准备当前图与历史视觉判例、调用视觉模型、持久化 `TasteReview`。
- `image-studio/frontend/src/state/studioStore.ts`
  - submit/job/batch 主编排、`originalPrompt`/`submittedPrompt`、critic/DQ/补抽触发与 workspace 状态；「AI 优化提示词」的规则注入点。
- `image-studio/frontend/src/lib/promptSuggestion.ts`
  - suggest 请求构建/解析、`prepareApprovedRulesForContext`、`withApprovedTastePreferences`（优化通道的规则注入）。
- `image-studio/frontend/src/lib/ruleInduction.ts`
  - induce-rules 请求构建与 strict JSON 响应解析（≤5 条）。
- `image-studio/frontend/src/state/studioStore.suggestion.ts`
  - 辅助重试的起草/决定/refine-note actions（依赖注入，node 可裸测）。
- `image-studio/frontend/src/state/studioStore.tasteRules.ts`
  - 规则蒸馏/改写/从历史归纳 actions（哨兵 busyId 全面板互斥）。
- `image-studio/frontend/src/app/gates/PromptRetryGate.tsx` + `components/taste/PromptSuggestionModal.tsx`
  - reject 后的辅助重试卡片与草稿对照弹窗。
- `image-studio/frontend/src/components/taste/TastePanel.tsx` + `TasteRuleCard.tsx`
  - 学习透明面板与规则卡（打磨三通道、归纳依据展示）。
- `image-studio/frontend/src/styles/_taste.css`
  - 品味 UI 的 unlayered 手写类；关键控件样式不要依赖 tailwind layered utilities。
- `image-studio/frontend/src/types/domain.ts`
  - `HistoryItem`（含 `sourcePaths`）、`TasteReview`、DQ 字段。

### 评审 UX

- `image-studio/frontend/src/components/canvas/BatchResultGrid.tsx`
- `image-studio/frontend/src/components/canvas/CanvasStage.tsx`
- `image-studio/frontend/src/platform/android/canvas/AndroidCanvasStage.tsx`
- `image-studio/frontend/src/components/taste/FeedbackModal.tsx`
- `image-studio/frontend/src/components/taste/TasteBootstrapModal.tsx`
- `image-studio/frontend/src/lib/batchCompareView.ts`
- `image-studio/frontend/src/styles/_canvas.css`

桌面和 Android 的评审语义必须保持一致。真实批次必须有 `batchId`；开发 preview fixture 不得伪装成真实批次，否则可能污染反馈数据库。

### Images API 与宿主路径

- `image-studio/frontend/src/platform/runtime/remote-kernel/images.ts`
- `image-studio/frontend/src/platform/runtime/remote-kernel/index.ts`
- `image-studio/frontend/src/platform/runtime/remote-kernel/types.ts`
- `go-cli/pkg/client/images_api.go`
- `go-cli/pkg/client/client.go`
- `shared/kernel/requestModel.js`

修 Images API 兼容时至少检查两条执行路径：frontend remote kernel 和 Go client。必须保留 raw response 路径与上游原始错误语义；不要把 401/403、显式 failed event 或传输错误误判为“没有图片”后盲目重试。

### 历史与迁移

- 普通历史仍在原来的 `image-studio` IndexedDB。
- 品味数据独立在 `image-studio-taste` IndexedDB。
- Windows 迁移逻辑见 `image-studio/backend/persistence_migration_*.go`，要继续识别旧版 `%LOCALAPPDATA%\image-studio\WebView2\EBWebView\Default`。

## 5. 核心流程

```text
用户原始 prompt
  -> 原样提交（或仅应用显式用户控制）
  -> 同批多图
  -> critic 读取当前 prompt + 已批准规则 + 最近显式视觉判例
  -> 客户端确定性 DQ / 排序 / top-3
  -> 合格图不足时只补抽一轮，prompt 仍保持相同
  -> 用户 pick / edit / reject
  -> append-only feedback + 视觉判例
  -> 有文字原因时形成 pending 长期规则候选
  -> 用户 approve 后仅进入后续 critic
```

`edit` 的当前预期行为是：所选图作为唯一 source，用户建议原文作为 edit prompt，立即启动新一批；不要再次总结、翻译或拼接旧 prompt。若生成启动失败，已写入的 feedback 不回滚，也不能在重试时重复写入。

## 6. 本机开发、构建与运行

常规前端开发：

```powershell
cd image-studio/frontend
npm ci
npm run dev:windows
```

常规 Wails 开发/构建：

```powershell
cd image-studio
wails dev
wails build -platform windows/amd64 -clean
```

当前工作副本有一个仓库内的本机隔离环境 `.dev-env/`，内含 Go 1.26.3、独立 cache 和便携 EXE 构建脚本：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\.dev-env\build-exe.ps1
pwsh -NoProfile -ExecutionPolicy Bypass -File .\.dev-env\run.ps1
```

产物：

```text
.dev-env/build/Image-Studio-Taste.exe
```

`.dev-env/` 只通过本机 `.git/info/exclude` 排除，不属于源码，也不会随 clone 出现。不要 `git add -f .dev-env`，不要提交 Go runtime、cache、EXE 或本机日志。若换机器，按 `docs/build.md` 使用标准工具链即可。

## 7. 测试与验证

前端常用入口：

```powershell
cd image-studio/frontend
npm test
npm run build:windows
```

本分支相关的聚焦测试：

```powershell
node --test `
  test/batchCompareView.test.mjs `
  test/studioStoreTaste.test.mjs `
  test/studioStoreCritic.test.mjs `
  test/studioStorePromptSuggestion.test.mjs `
  test/studioStoreTasteRules.test.mjs `
  test/tasteCritic.test.mjs `
  test/tasteLearning.test.mjs `
  test/tasteStorage.test.mjs `
  test/tasteInsights.test.mjs `
  test/promptSuggestion.test.mjs `
  test/ruleInduction.test.mjs `
  test/promptModeParity.test.mjs `
  test/requestModel.test.mjs `
  test/remoteKernel.test.mjs
```

Go 路径至少运行：

```powershell
cd go-cli
go test ./...

cd ../image-studio
go test ./...
```

2026-08-14 最新一轮验证结果：frontend 全量测试为 319 项中 315 通过、4 项失败；4 项均来自 `image-studio/frontend/test/runtimeHost.test.mjs`，已在干净上游提交复现，并非本分支改动引入。`go-cli` 全量测试通过。Wails/backend 全量测试仍有 1 个既有失败：`TestManagedRuntimeCleanupDirsPreservePrimaryImageData` 期望 10 个 cleanup dirs、实际 13 个。Windows frontend build 通过。不要删除、skip 或弱化测试来制造全绿；若失败数或失败文件变化，必须重新定位并如实报告。

`test/promptModeParity.test.mjs` 守卫 `shared/kernel/requestModel.js` 与 `backend/prompt_optimize.go` 的 instruction 字节一致（文本 mode 分支 + default 种子 + edit 后缀）。它用 Go 正则 `"([^"]*)"` 提取字符串，因此**任何 instruction 文本不得包含双引号**；JSON 输出格式只能用文字描述。改任一侧 instruction 必须同步另一侧。

每次交付还要做一次真实 UI/上游验证：

1. 一次生成多张图，确认批次对比完整显示。
2. 点进单图后可返回整批，也可用缩略图/前后按钮切换。
3. 分别触发 pick、edit、reject；确认只有显式操作写反馈。
4. edit 确认后自动开始新一批，source 只有选中图，prompt 与用户 note 逐字一致。
5. 用 Images API 上游验证流式无最终图片时只自动兼容重试一次，并能正常得到 `b64_json`；显式上游错误必须显示真实原因。
6. 检查历史详情中的 `originalPrompt`、`submittedPrompt`、`promptProvenance`、`tasteReview` 与 DQ 原因。

## 8. Git、许可证与安全

- 不提交 API key、token、Cookie、用户 prompt/图片、raw response、IndexedDB、日志或本机绝对配置。
- 不在测试 fixture 中放真实凭据；只能使用明显的占位值。
- 分享日志和 raw response 前先检查并脱敏请求头、URL query 与用户内容。
- 凭据继续走应用已有的安全存储；品味数据库只存反馈、候选/决定、画像和视觉判例。
- 本项目是 AGPL-3.0：分发修改版 EXE，或将修改版作为网络服务提供给他人使用时，必须按许可证提供对应源码并保留许可证与声明。
- commit 不添加 `Co-Authored-By`。
- 工作区可能有其他 agent 的改动；提交前先看 `git diff`，不要 reset、checkout 或覆盖不属于当前任务的文件。

## 9. 下一步优先级

1. 用最新 EXE 做真实上游 smoke：辅助重试草稿弹窗的规则计数小字、主「AI 优化提示词」的规则注入与 toast 计数、「从历史学习」的归纳质量、edit 自动续跑与编辑批次的 DQ/补抽；记录结果但不要提交用户图片或 raw response。
2. 验证失败事务：source 准备失败不写 feedback；feedback 已写但 submit 失败时不重复记录；多次点击确认不能产生重复事件或重复 job。
3. 用真实最近一批数据检查“视觉判例确实作为图片附件进入 critic”，而不是只保存了 metadata；补充可观察的诊断信息但不要泄露图片或 key。
4. 校准 DQ 假阳性/假阴性，特别是“增加对手/另一个视图”的中英文表达；坚持“模型报告事实，客户端决定 DQ”。
5. 改善 critic 未配置或失败时的手动重试体验；正常生图不能因为 taste critic 不可用而被阻断。
6. 扩展长期品味总结前，先积累真实显式反馈。不要把普通历史升级为强偏好，也不要引入训练、DPO、LoRA 或隐藏 prompt 优化。

## 10. 完成定义

一个改动只有同时满足以下条件才算完成：

- 不违反 prompt、显式学习、critic-only、append-only 和 DQ 契约；
- desktop 与 Android/remote kernel 的语义没有无意分叉；
- 对应聚焦测试通过，frontend build 通过；
- 全量测试结果如实记录，已知基线与新增失败明确区分；
- 真实 UI 或真实上游路径按风险完成验证；
- 没有 secret、本机产物或用户数据进入 git。
