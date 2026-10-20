# PackyAPI Codex 通道接入手册（codex-sale 分组）

> **读者**：在本机（Windows 开发机）为 ForeSight 工作的 agent（opencode）与维护者。
> **依据**：2026-09 ~ 2026-10-03 本机实测。文内所有「实测」字样均有对应验证记录；改本文件前先核对事实，不要凭想象补细节。
> **安全**：本文件不得写入任何 key；含本机路径，若对外发布需先清理。

## TL;DR

- PackyAPI（PackyCode）的 **codex-sale（codex）分组** API **不能直连**：平台有反二次分发检测，只接受标准 Codex 客户端。
- 唯一稳定通道 = **真实 codex CLI**，经本机 **codex-bridge** 暴露为本地 OpenAI **Responses** 端点（`http://127.0.0.1:3220/v1`）。
- 链路：`客户端 → 127.0.0.1:3220/v1/responses → codex CLI → https://cf.api.fan/v1`（上游需代理）。
- 在本项目使用 = ①启动 bridge（需要有效凭据 + 代理）→ ②调用方按第 3/4 节接入。

## 1. 为什么必须走桥接（实测硬约束）

| 直连方式 | 结果 |
|---|---|
| `POST /v1/chat/completions` | ❌ `protocol_not_supported`（codex 通道只支持 Responses 协议，无 chat 端点） |
| `POST /v1/responses`（curl / SDK 直连） | ❌ 被拦：「请使用标准 Codex 客户端」（反二次分发检测） |
| 伪造 Codex 请求头 | ⚠️ 实测 3 次中 2 次通过——**不可靠，不要用** |
| **真实 Codex CLI** | ✅ 稳定可用（唯一合规通道，bridge 即基于此） |

其他硬约束（全部实测）：

- **必须走代理**：直连时报 403「当前地区暂不支持访问模型」；本机系统代理（`127.0.0.1:7897`）开启时正常。codex CLI 会自动读取 Windows 系统代理，无需额外配置。
- **每次调用固定 ~13K 输入 token** 的 Codex 系统提示开销（其中大部分命中缓存，但成本模型里必须计入）。
- **模型白名单**由 bridge 配置决定：`gpt-5.6-sol` / `gpt-5.6-terra` / `gpt-5.6-luna` / `gpt-6-astra`（当前值）。名单外请求返回 400；新增模型需改配置并重启 bridge。
- **响应为伪流式**：codex exec 一次性返回，bridge 按其长度分块推送（客户端体验为「等待 5–15s+ 后一次性出结果」）。
- **无多模态**：图片输入会被替换为 `[image omitted]` 文本（bridge 不做图像传递）。

## 2. 桥接层部署（本机现状）

| 项 | 位置 / 值 |
|---|---|
| bridge 源码 | `D:\Project\AICode\MMCAS\packages\core\codex-bridge\`（`codex-bridge.mjs` v2.6；含 `install-bridge.mjs`、README） |
| 运行配置 | `%LOCALAPPDATA%\mmcas\codex-bridge.json` |
| 凭据目录 | `%LOCALAPPDATA%\mmcas\codex-home\`（`auth.json` = PackyAPI key；`config.toml` = 上游指向 `https://cf.api.fan/v1`）|
| 端口 | `127.0.0.1:3220`（同一时间只能跑一个实例） |
| 端点 | `GET /health`、`GET /v1/models`、`POST /v1/responses`（SSE） |

**启动**（本机示例）：

```bat
node "D:\Project\AICode\MMCAS\packages\core\codex-bridge\codex-bridge.mjs" --config="%LOCALAPPDATA%\mmcas\codex-bridge.json"
```

**健康检查**：

```bat
curl http://127.0.0.1:3220/health
```

返回 JSON 含：`codex`（解析到的 codex CLI 路径）、`models`、`inFlight`、`lastUpstreamError`、`lastSuccessAt`。

**凭据说明**：key 只存在于 `codex-home\auth.json`，由 codex CLI 自行读取——bridge 不持有、不转发、不落库。更新凭据有两种方式：

1. **直接编辑 `codex-home\auth.json`**（推荐；单文件，格式 `{"OPENAI_API_KEY": "<key>"}`，保持 JSON 合法 + UTF-8）。
2. 用 `install-bridge.mjs` 重跑（幂等；`--dry-run` 先预览）：

```bat
node "D:\Project\AICode\MMCAS\packages\core\codex-bridge\install-bridge.mjs" --key-file <新key文件> --mmcas-home "%LOCALAPPDATA%\mmcas"
```

⚠️ 坑：方式 2 会**按命令行参数重写** `codex-bridge.json`、codex-home、dsh settings 共 5 处——现有自定义字段（4 模型白名单、`dumpRequests` 等）会被默认值覆盖，需在参数中带上或事后恢复。若只为换 key，用方式 1。

## 3. opencode 自身接入（让 opencode 用上 codex 通道的模型）

在 opencode 配置（全局 `~/.config/opencode/opencode.jsonc` 或项目 `.opencode/opencode.json`）加自定义 provider：

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "codexbridge": {
      "name": "PackyAPI Codex (bridge)",
      "npm": "@ai-sdk/openai",
      "options": {
        "baseURL": "http://127.0.0.1:3220/v1",
        "apiKey": "local-bridge"
      },
      "models": {
        "gpt-5.6-sol":   { "name": "GPT-5.6 Sol" },
        "gpt-5.6-terra": { "name": "GPT-5.6 Terra" },
        "gpt-5.6-luna":  { "name": "GPT-5.6 Luna" },
        "gpt-6-astra":   { "name": "GPT-6 Astra" }
      }
    }
  }
}
```

要点（踩过的坑）：

- **`npm` 必须是 `@ai-sdk/openai`**——它走 Responses API（`/v1/responses`），与 bridge 匹配；`@ai-sdk/openai-compatible` 走 chat/completions，bridge 没有该端点，会 404。
- `apiKey` 填任意非空值即可（bridge 不校验认证；真实凭据在 codex-home）。不填可能导致客户端侧报错。
- **改配置后必须完全重启 opencode**（配置只加载一次，不热重载）。
- 使用 `-m codexbridge/gpt-5.6-sol`（或配置 `"model"` 默认值）选择模型。
- opencode 的**标题生成**（title agent）也走同一 provider——每会话会多出一次调用（有成本，属正常）。
- 实测状态（2026-10-03）：opencode 1.18.33 的请求体（`model/input/tools[9]/tool_choice/stream` 等）与 bridge 完全对得上；工具往返（function_call → 本地执行 → function_call_output 回传）已用逐字段复刻 bridge 事件的 mock 端到端验证通过。真实上游端到端待凭据更新后复核。

## 4. 项目代码接入（ForeSight 内部 LLM 调用点）

**现状**（代码核实，2026-10-03）：

- `src/llm/provider.ts` → `POST ${baseUrl}/chat/completions`（OpenAI 兼容 chat 协议；JSON 输出用 `response_format: {type:'json_object'}`）
- `eval/lib/llm.mjs` → 同样 chat/completions；`baseUrl` 可用 `FORESIGHT_LLM_BASE_URL` 覆盖
- 结论：现有调用点全是 **chat/completions**，与 codex 通道（Responses-only）**不兼容，不能直接把 baseUrl 指向 bridge**。

可选路径（按改动面排序）：

1. **本地 shim（推荐）**：写一个本地小服务，把 `POST /v1/chat/completions` 翻译为对 bridge `POST /v1/responses` 的调用，SSE 结果转回 chat 格式（`data: {...chunk}` + `[DONE]`）。现有代码零改动，只把 baseUrl 指到 shim。
2. **调用端改造**：给 `provider.ts` / `llm.mjs` 增加 Responses 协议分支（解析 `response.output_text.delta` / `response.completed` / `usage`）。
3. **扩展 bridge 本体**：给 codex-bridge 增加 `/v1/chat/completions` 端点（bridge 是被多个项目复用的组件，改动需评估影响面）。

共性注意：

- **`response_format` 不被 bridge 支持**——JSON 输出改为 prompt 内约束（`parseJsonContent` 已容忍 ```json 围栏，兜底可用）。
- **成本**：每次调用约 1.3 万输入 token 起步（缓存可降单价，但按量计入）；多轮工具任务线性叠加。用于 eval 批量前先估算。
- 流式为伪增量（见第 1 节），调用端不要把「长时间无增量」当故障。

## 5. 排障速查

1. `curl http://127.0.0.1:3220/health` 不通 → bridge 没在跑：按第 2 节启动。
2. `health.lastUpstreamError` 或调用返回 `401 无效的令牌` → **凭据失效**：按第 2 节更新 `auth.json` 后重试。
3. 403「当前地区暂不支持」/ 上游超时 → 检查代理（见第 1 节）。bridge 配置的 `proxy` 字段留空 = 跟随系统代理。
4. **opencode 在上游错误时会持续自动重试**（表现为长时间「卡住」，每 15–20s 一次）——先修凭据，或 Ctrl+C 终止，不要干等。
5. 模型 400「未知模型」→ 该模型不在 bridge 白名单（改配置 + 重启 bridge）。
6. codex CLI 找不到 → bridge 会自动定位 npm 全局布局（`%APPDATA%\npm\node_modules\@openai\codex\bin\codex.js` 或 node 同目录布局）；一般无需处理。

## 6. 事实边界

- 不要向任何文档/代码里写入 key；key 不进 git。
- 不要把本通道描述为「可被任意 HTTP 客户端直连」——既不属实也违反平台规则。
- 本文件为内部手册；如项目对外发布，先清掉本机路径与内部项目名。
- 最后核实日期：2026-10-03。
