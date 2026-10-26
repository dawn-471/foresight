# ForeSight

[![dsh-plugin](https://img.shields.io/badge/dsh--plugin-blue?logo=github)](https://github.com/topics/dsh-plugin)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-black?logo=deepseek)](https://github.com/deepseek-ai/deepseek-harness)
[![License: MIT](https://img.shields.io/github/license/dawn-471/foresight.svg)](LICENSE)
![Status: experimental](https://img.shields.io/badge/status-experimental-yellow)

[English](README.md) | **中文**

**面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）的时相化长期记忆插件。**

每条记忆都携带显式的时间语义——语言学的*体*（aspect：进行体 / 完成体 / 未然体 / 恒常体）与*锚*（anchor：时点 / 区间 / 开放 / 无关）配对。框架机械地执行生命周期：锚到期衰减、TTL 兜底、续期提醒（nudge）、先行体审查、预测到期自动判定，以及基于证据的冲突消解，全部由单一保守/激进系数 β 控制。

## 问题由来

长期记忆是数据管理问题，而不是提示词工程问题。不加管理的 Agent 记忆通常踩到两个常见的坑：

**陈旧注入。** 一个月前已结束的项目仍与新鲜信息竞争注入配额，仿佛它仍是当前上下文。

**有效时间丢失。** "我昨天做过这件事"被说成"刚才"——没有任何记录标明一条记忆何时为真，更不用说何时不再为真。

## 为什么存在

与聊天厂商的滚动窗口式记忆不同，ForeSight 把记忆当作**调度的第一等数据**：已实现的调参项——过期/TTL、续期节奏、激活 β、检索因子权重、注入预算——均从一份结构化策略文件（`policy.yaml`）读取；尚未接线的字段在 [eval/DECISIONS.md](https://github.com/dawn-471/foresight/blob/main/eval/DECISIONS.md) §13 显式登记为 reserved（不做静默装饰）。

ForeSight 从语言学借用两个轴来应对：

| 轴 | 取值 | 控制什么 |
|---|---|---|
| 体 (aspect) | 进行体 / 完成体 / 未然体 / 恒常体 / 不确定兜底 | 生命周期：归位完成、永久、待验证、按检索注入、可再分类 |
| 锚 (anchor) | 无锚 / 时点 / 区间 / 开放 | 语句何时为真（有效时间） |

通俗地说，**体**回答"这件事处于什么阶段"——进行体："我正在写报告"（仍在进行，终将结束 → **自动归位为"已完成"并保持可检索，而非隐藏**）；完成体："报告已经提交"（已定论，永久保留）；未然体："下周要交报告"（尚待发生，到时验证）；恒常体："我每天喝咖啡"（不随时间变化——与其他体一样写入记忆库、按语义检索注入；只有**全局重要**的事实才写入始终注入的 IMPORTANT.md）；不确定兜底：无法判定的内容进入兜底桶而不是被丢弃。**锚**回答"这句话何时为真"——时点（"8月20日"）、区间（"大三期间"）、开放（"自3月以来"）或无锚（与时间无关）。

几个值得注意的设计取舍：

- 体的分类借鉴了成熟的语言学概念，但它是一个刻意保持最小的起点，而非完备理论——schema 可配置（`policy.yaml`），并预期随使用演化。
- 核心与 Agent 无关：dsh 只是其中一个适配层（`src/` 下的 cordis 插件）。embedding 与 LLM 均为可插拔接口——默认本地 Ollama，且规则兜底保证没有模型也能运转整个生命周期。
- 生命周期由机制执行，而非模型判断：过期、注入资格与冲突消解均由策略驱动，可选的 LLM 仅用于分类与推导。但需要说明的是，这是早期探索性实现——分类、策略模型与执行机制都仍在演进中。

## 环境要求

- Node.js ≥ 22.13（`node:sqlite` 从该版本起不再需要 flag）
- DeepSeek Harness（dsh）0.2.0-rc.2+，带 [cordis](https://github.com/deepseek-ai/cordis) 插件系统；桌面端的 Electron 运行时需内置 Node ≥ 22.13
- 一个 embedding 后端（默认：[Ollama](https://ollama.com/) + `nomic-embed-text-v2-moe`，768 维）
- （可选）用于分类/推导的 LLM API（默认：DeepSeek 兼容 API；存在规则兜底，无 API 也能运行）
- 平台跟随 `sqlite-vec` 的预编译包：Windows x64、Linux x64/arm64、macOS x64/arm64；其他平台自动降级为 FTS + 已存向量余弦，不会因扩展加载失败而整体不可用

## 安装（dsh profile）

npm 发布尚未完成。用 dsh 插件命令安装构建好的 release tgz（或本地构建产物），这样 bundle patch 会自动注册：

```bash
# 从 GitHub Release / 本地构建
dsh plugin --profile <name> add "file:/path/to/foresight-memory-0.2.0.tgz"
```

`package.json` 自带 `dsh.bundle.patch`，会自动插入六个条目（core / tools / inject / nudge / observer / server），不要再手工重复添加。需要自定义数据目录时，只在 profile patch 覆盖 core：

```yaml
# cordis.patch.yml（profile 级）
- id: foresight-core
  config:
    memoryRoot: '<绝对数据目录>'   # 可选；默认走平台目录
```

profile patch 会整份替换 `foresight-core` 的 config（不是深合并），非默认的 `dbFile`/`embedBaseUrl`/`embedModel` 需要一并重复。

源码构建时 `pnpm install` 会执行 `prepare` 编译 `lib/`；`npm pack` / `pnpm pack` 也会执行 `prepare`，因此 tarball 一定包含编译入口和 `templates/`。

bundle/config 变更可热加载，但 `lib/*.js` 的代码变更需要重启 dsh 或新会话——不要用正在运行的会话来验证重新构建的插件。

## 配置——我的数据存在哪？

**你的数据存放在仓库之外，自己的数据目录里。** 插件绝不携带任何用户数据；仓库是纯代码 + 模板。

### 数据目录结构

```
<memoryRoot>/
├── SOUL.md          # 人格设定（首次运行从 templates/SOUL.md.example 播种）
├── IMPORTANT.md     # 全局重要事实，始终注入（首次运行播种）
├── policy.yaml      # 全部可调参数（首次运行播种；改这里）
└── foresight.db     # SQLite 存储（自动创建）
```

首次运行时插件会创建目录，并从包内 `templates/` 播种缺失的起始文件——`policy.yaml` 总是会补（启动必需），`SOUL.md`/`IMPORTANT.md` 仅在新数据目录时补。插件会打印创建了哪些文件；已存在的文件绝不覆盖。装包场景不需要再手工复制模板。

### 解析链

`显式选项（adapter）→ 环境变量 → 默认值`

（`policy.yaml` 本身位于 `memoryRoot` 内，因此不能反过来提供 `memoryRoot`。）

| 设置 | 环境变量 | 默认值 |
|---|---|---|
| 数据目录 | `FORESIGHT_MEMORY_DIR` | `%LOCALAPPDATA%/foresight`（win）/ `~/.local/share/foresight`（unix） |
| db 文件 | `FORESIGHT_DB_FILE` | `foresight.db` |
| embedding URL | `FORESIGHT_EMBED_URL` | `http://localhost:11434` |
| embedding 模型 | `FORESIGHT_EMBED_MODEL` | `nomic-embed-text-v2-moe` |
| embedding 维度 | `FORESIGHT_EMBED_DIM` | `768` |
| embedding 熔断失败次数 | `FORESIGHT_EMBED_FAILURES` | `3` |
| embedding 熔断冷却（ms） | `FORESIGHT_EMBED_COOLDOWN_MS` | `30000` |
| LLM base URL | `FORESIGHT_LLM_BASE_URL` | `https://api.deepseek.com/v1` |
| LLM 模型 | `FORESIGHT_LLM_MODEL` | `deepseek-flash` |

### 运行时行为

- **摄入**：`turn/end` 时观察器写入对话记录，并把每条 user/assistant 消息送进同一个写入门（重要度、分类、向量、精确去重、冲突消解）。门控失败只记日志，不阻塞会话；derive 每 `derive.every_n_turns` 轮触发。
- **工具**：`@foresight/memory/tools` 在 `ctx.tools` 注册 `memory_write`、`memory_update`、`memory_delete`、`memory_restore`、`memory_renew`、`memory_query`、`memory_reason`。更新会重新计算向量；删除为可恢复软删；renew 延长进行体/未然体窗口；硬删除仅 Root。
- **注入**：系统提示的记忆段走检索路径，覆盖全部已存体（进行/完成/未然/恒常/兜底），按最新用户轮次排序；归位条目渲染为「已完成」。工具检索与系统提示看到同一批记忆。
- **作用域**：dsh/工具/注入/nudge 使用 `global`；HTTP server 按 `x-foresight-peer` 隔离读写，且与 dsh 的 `global` 池相互隔离。配置 `server.peer_tokens` 可启用每 peer 独立 token；否则共享 token 是单一信任边界，请只监听 loopback。
- **管理 API**：`PATCH /v1/memories/:id`、`DELETE /v1/memories/:id`（`?purge=1` 仅 Root）、`POST /v1/memories/:id/restore`、`POST /v1/memories/:id/renew`；GET 默认隐藏软删行，Root 可显式查看。
- **检索**：语义向量 + memories FTS（CJK trigram + Latin），写入时精确去重，启动时回填 embedding 缺失的行。embedding 调用带熔断（`FORESIGHT_EMBED_FAILURES`、`FORESIGHT_EMBED_COOLDOWN_MS`）：Ollama 连续失败后快速失败，不再让每轮都等超时；写入继续无向量降级，后续由回填补齐。

### 策略文件

`policy.yaml` 是「已实现调参项」的唯一事实来源：权限矩阵、体生命周期（TTL/续期/锚渲染）、gate 分类、激活 β 与衰减常数、检索因子权重（已冻结：0.40/0.20/0.25/0.15）、注入预算、nudge 频率、服务器端口/token。没有执行者的字段在 [eval/DECISIONS.md](https://github.com/dawn-471/foresight/blob/main/eval/DECISIONS.md) §13 显式登记为 reserved。**你的助手的人格、画像与记忆策略由你决定**——没有任何一项被硬编码进代码。

## 从 0.1.x 升级（policy v3）

v0.2.0 使用 `policy_version: 4`。v3 policy 仍可启动：loader 会在内存中映射到 v4、打印警告，并用包内模板补齐 v4 新增键（`uncertain`、`transitions`、`gate.fallback_write`）。要显式重写文件（带备份）并把旧 `user.md` 合并进 `IMPORTANT.md`：

```bash
# 在仓库里
node scripts/migrate-policy.mjs <memoryRoot>          # 预演：生成 policy.yaml.v4-<ts>
node scripts/migrate-policy.mjs <memoryRoot> --write  # 备份 + 替换 + 合并 user.md

# 在 dsh profile 的已安装包内
node node_modules/@foresight/memory/scripts/migrate-policy.mjs <memoryRoot> --write
```

运行期也会合并 `IMPORTANT.md` 与 `user.md`，因此创建新文件不会让旧画像从注入中消失。v4 把恒常体从旧的 doc/always 语义改为 memory/conditional——请审阅生成的 policy，不要假设默认值符合你的原意。

**数据目录变化：** 包内 bundle patch 不再写 `memoryRoot: './memory'`。如果你的旧安装依赖这个 cwd 相对目录，请先在 profile patch 中把 `memoryRoot` 设为该绝对路径再升级；否则插件会改用平台默认目录（`%LOCALAPPDATA%/foresight` 或 `$XDG_DATA_HOME/foresight`）。Windows 上若检测到旧的 `%APPDATA%/foresight`，会继续沿用而不是静默迁移（Roaming 同步可能损坏 SQLite WAL）；需要移动时请先备份并显式设置 `memoryRoot`。

## 卸载

1. `dsh plugin --profile <name> remove @foresight/memory`（或在 profile 里 `pnpm remove`），同时更新 `package.json` 与 lockfile。
2. 从 profile 的 `dsh.profile.bundles` 列表删除该包，并删除 profile 级 `cordis.patch.yml` 中的 `foresight-core` 条目。
3. 删除你配置过的 `FORESIGHT_*` 环境变量与数据目录（`%LOCALAPPDATA%/foresight`、旧版 `%APPDATA%/foresight`、`$XDG_DATA_HOME/foresight` 或自定义绝对 `memoryRoot`）。目录内含 `foresight.db`、`-wal`/`-shm`，以及启用时的审计日志。
4. 若曾用 `dsh plugin allow-version`，从 profile 的 `compatibility.json` 删除对应条目。

保留数据目录是安全的；删除即硬清除。

## 目录结构

```
src/
├── types.ts            # 领域类型（体×锚）
├── defaults.ts         # 默认值唯一的存放处
├── config.ts           # 解析链 + 数据目录引导
├── policy.ts           # policy.yaml 加载器 + 行为查询
├── schema.ts           # SQLite DDL + 迁移 + sqlite-vec
├── store.ts            # CRUD、软删除、向量、FTS、审计
├── gate/               # 写入门：分类 + 校验（aspect-text）
├── govern/             # 权限模型
├── evolve/             # 时间性过期/TTL、激活、β 冲突消解
├── retrieve/           # 可组合评分因子 + 搜索（3 种形态）
└── store/embed.ts      # embed provider 接口（默认 Ollama）
```

## 验证

```bash
pnpm install
pnpm build     # tsc
pnpm test      # node --test — 无需外部服务
```

所有测试针对内存/临时存储与假 embedder 运行——整套测试在干净机器上通过，不需要 Ollama、不需要 API key、不需要数据目录。

## 许可证

MIT
