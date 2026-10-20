# ForeSight 评估预注册（DECISIONS）

> **状态**：PRE-REGISTRATION v1 — 冻结于首次主跑前（Task 0.1, P0）
> **依据计划**：`plans/2026-10-01_180525-foresight-eval-plan-v3.1.md`（SHA256 `66229837950D204CB2BD444618C085B7520365CFFA6EFCF690A2CBF62631E067`）
> **执行规则**：本文件冻结行不可修改；一切变更只能**追加**到 `Changelog`（版本/时间/内容）或 `Deviations`（时间/原因/影响/补偿实验）。
> **审计基线**：本预注册基于代码审计 commit `ebd642b`（详见计划 §2；C1–C11 机制问题在 P1 修复，未过 G1 不得进入 P2）。

- 预注册版本：`pre-reg-v1`
- 创建日期：2026-10-01
- 执行者：solo（+ 抽检复核；C-extension 前补第二位标注者，见 §11.3）
- 预注册提交记录：见 git log（本文件首个 commit）；commit hash 于 `eval/STATUS.md` 登记

---

## 1. 主张、操作化定义与反驳条件（H1–H3）

### H1（陈旧抑制）

带生命周期的记忆系统，注入已过期/已被取代内容的比率显著更低。

| 指标 | 定义 | 来源 |
|---|---|---|
| **SIR-i（主）** | stale 注入条数 / 注入总条数 | trace 确定性复算（不依赖 judge） |
| SIR（次） | 含 ≥1 条 stale 注入的查询数 / 总查询数 | trace |

- stale 判定以 **ground truth** 为准：`stale_gt=true`（timesuite 期望行为；公开基准旧值证据的冻结标注，见 §12）。每条注入明细携带 `stale_gt/stale_reason`。
- **等预算要求**：SIR-i/SIR 比较必须在同一 eval 层 token 预算档（§5）下进行；同时报告原始注入条数。
- 主证据：timesuite；辅证：公开基准 knowledge-update 的「旧值答案」+ stale 代理标注。**两路必须同向**才主张 H1。
- **反驳条件**：配对检验（McNemar）经 Holm 校正后不显著，**或** SIR-i 差值的配对 bootstrap 95% CI 含 0。**不使用「CI 重叠」判据，不使用 Wilson（配对差无效）。**

### H2（事实更新跟随）

在知识更新场景中，显著更常给出当前事实而非历史事实。

| 指标 | 定义 | 来源 |
|---|---|---|
| **UFA（主）** | LME cleaned knowledge-update 全量上，**冻结 judge**（prompt hash 入档）判定的正确率 | judge |
| CRA（机制辅证） | timesuite 冲突题「返回当前事实且不再注入旧值」/ n | 期望行为（确定性） |

- 措辞不称「官方判定」；官方 `evaluate_qa.py`（GPT-4o）口径仅作辅证/敏感性分析。
- **覆盖率分层**：主分析 = 全题集（未写入证据的系统自然失分，如实呈现）；次分析 = ForeSight 写入接受子集（报告写入接受率与证据覆盖率）。两层均预注册。
- **功效前置（LME-KU underpowered 处理，D13）**：LME-KU 题量固定且偏小（cleaned 约 78，以 `fetch --check` 回填），不参与扩样。P2.1 功效分析后若主比较 underpowered，按以下**预注册顺序**执行，不得临时改口径：
  1. 主分析切换为 **pooled**（KU + timesuite CRA，要求同向）；
  2. pooled 仍 underpowered 或方向不一致 → **H2 降级为探索性**；
  3. 均不成立 → 如实报告 **inconclusive**，不主张 H2。
- **反驳条件**：UFA 差值（配对 bootstrap）95% CI 含 0（校正后）。

### H3（预算效率）

同等注入预算下正确率更高；或达到同等正确率所需注入 token 更少。

- 预算由 eval 层统一渲染器（`lib/render-budget.mjs`）定义，所有系统同一实现、同一 tokenizer。
- 主报告：**等预算点差**（3 档预注册，§5）+ **曲线 AUC（粗粒度）**；同时报 mean/p95 注入 token。
- `fullcontext` 仅作上界参考，**排除于 H3 支配判定**。
- **评估口径（D17）**：优先把 token 预算下沉到插件注入路径（单一实现，评估=shipped 行为）；若保留 eval 层渲染，登记 deviation + 按 `channel`（system_prompt vs tool_retrieval）分层报告，并在论文显式声明。
- **反驳条件（D22 改写）**：3 档预算上，ForeSight 的 accuracy 均不高于**且**注入 token 不少于同一基线（配对校正后），即被该基线支配。

### 次要 / 探索性

- 检索层：LME turn/session recall（官方标签口径）。
- 幻觉控制：LME 30 条 abstention（`_abs`）+ LoCoMo adversarial（category 5）。
- 机制级：锚渲染正确率、未然体到期验证正确率（fulfilled/falsified/uncertain 三分类）。
- 写入接受率、证据覆盖率、闭卷对照正确率、参数知识泄漏指标（reader 对更新前/后值的偏好）。
- 延迟与成本（本地 embedding、LLM 调用数）。

---

## 2. 数据集与子集

| 数据集 | 用途 | 子集 | 版本/许可 |
|---|---|---|---|
| **LongMemEval（ICLR 2025, MIT）** | 主（H2）+ H1 辅证 | cleaned **KU 全量（78，实测确认）**；temporal-reasoning（133，次要）；30 abstention（控制） | hub rev `98d7416c`（2025-09-19），下载 2026-10-01；`longmemeval_s_cleaned.json` SHA256 `d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442`（与上游独立记录一致）；`longmemeval_oracle.json` SHA256 `821a2034d219ab45…`；MIT |
| **LoCoMo（ACL 2024）** | H2 次要辅证（cat2）；控制（cat5） | `locomo10.json`：10 段对话 / 1986 QA；cat1=282、**cat2=321**、cat3=96、cat4=841、**cat5=446** | 许可实测为 **CC BY-NC 4.0**（LICENSE.txt，2026-10-01）；SHA256 `79fa87e90f040813…`；仅非商业研究、不再分发 |
| **timesuite（自建）** | H1 主 + 机制表 | 7 类 × 60 ≈ 420 题；含 ≥120 独立生成留出集；盲评 140（每类 20） | 生成 SPEC 冻结于 P3.1 |
| LongMemEval-V2（2026/05） | 不进 B 主实验 | C-extension Track C 选项 + related work | P4 查新 |

- 题量、类别分布以 `fetch --check` 实测回填（Task 1.7）。
- LME 双角色写入（user + assistant，assistant 为次要分析）；LoCoMo 角色映射 A→user、B→assistant，cat2 仅次要辅证。

---

## 3. 系统、消融与预注册矩阵

系统（7）：`foresight`（3 预算档）、`nolifecycle`、`recency`、`rag`、`summary`、`fullcontext`、`closedbook`。
消融（5，ForeSight 家族）：decay-off / anchor-off / conflict-off / prospective-off / lifecycle-off；外加 gate-LLM 小样本敏感性（n≈100）。

| 数据集 | foresight(3 预算) | nolifecycle | recency | rag | summary | fullcontext | closedbook |
|---|---|---|---|---|---|---|---|
| LME-KU（主） | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| LME temporal（次） | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| LoCoMo cat2（次） | ✓ | ✓ | ✓ | ✓ | N/A | ✓ | ✓ |
| LoCoMo cat5（控制） | ✓ | ✓ | ✓ | ✓ | N/A | ✓ | ✓ |
| timesuite（主） | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 5 消融（ForeSight 家族） | ✓ × 5（跑 LME-KU + timesuite；其余 N/A） | — | — | — | — | — | — |

- 标 N/A 的格在本文登记理由（summary 成本控制），不算缺失。
- **主比较对象（预注册）**：机制主对比 = `nolifecycle`（隔离生命周期）；实用主对比 = `recency`。其余 baseline 为 secondary（BH 校正）。
- `fullcontext` 截断策略在 Task 1.5 冻结（超长按最旧会话截断，或声明无截断上界并排除 H3 支配判定）。

---

## 4. 判定协议（reader / judge）

- **Reader**：`deepseek-flash`（冻结，2026-10-01 用户指令全局改名；原名 `deepseek-v4-flash`），temperature 0；reader prompt 冻结并记录 hash（Task 1.4）。
- **Judge（冻结）**：主 judge = `gpt-4o`（LME 官方 `evaluate_qa.py` 默认，与 reader 不同源）。
  - **不可得时（预注册兜底）**：改用 `deepseek-flash` 同源 judge，登记 deviation，主表附人类子集敏感性分析，并**触发 C-extension 双 judge**。
  - judge prompt 一文件一版本（文件名带 hash 前缀）；模型 + prompt hash 写入每条 trace 的 `judge.judge_id/prompt_hash`。
- **人审**：分层抽 ≥120 条双盲标注，计算 κ（目标 **≥0.7**）与 per-stratum 一致率 + **AC1**。
  - κ ∈ [0.6, 0.7)：主表附人类子集敏感性分析 + 触发 C-extension 双 judge；
  - κ < 0.6：重写 prompt 重跑。
- **seed**：`--seed` 全链路参数化；seed 支持性探针 `eval/scripts/seed-probe.mjs`（P0.6 已交付）。**状态：已实测（2026-10-01）**——`deepseek-v4-flash` @ `https://api.deepseek.com/v1`，seed=0、temperature=0、重放 3 次：`outputs_identical=false`（输出与 usage 均存在差异；reasoning_tokens 63/64/57），无接口错误 → 结论 `seed_effective`（差异存在 → 方案可用）；不触发 §11.1 扰动替代，C-extension 维持 seed ∈ {0,1,2}。归档 `eval/results/seed-probe_deepseek-v4-flash.json`；同日复跑 2 次结论同型；官方 API 参考页（中/英，2026-10-01 核对）未列出 seed 参数，以实测口径为准。附注：探针 `max_tokens=64` 对 thinking 输出偏紧，多次 content 截断为空串；差异判定以 outputs+usage 联合为准。若输出无差异或接口不支持 seed，按 §11.1 扰动方案替代（温度 / 提示顺序 / 同义改写）。

---

## 5. H3 预算预注册（D10）

- 3 档：`(retrieval.top_k=5, budget=1k tokens)`、`(10, 2k)`、`(20, 4k)`。
- 所有系统在同一 eval 层 token 预算下**扫描其自身 k/N**（recency 窗口、rag top-k）。
- AUC 由 3 点估计（声明为粗粒度）；主报告为等预算点差。
- tokenizer 冻结：`cl100k_base`（tiktoken）；不可用时以 provider usage 差值记账并登记 deviation。版本写入 `trace.versions.tokenizer`。

---

## 6. 分析计划（预注册）

- **实验单元**：question；所有系统同题配对。
- **二值指标**：McNemar 精确检验；差值 CI = paired bootstrap（10,000 次）或 McNemar-consistent（Wald/Miettinen）。**删除 Newcombe（面向独立两比例差）；不使用 Wilson 近似配对差。**
- **连续指标**：配对 bootstrap percentile CI；效应量 OR / Cohen's h / Cliff's δ。
- **聚类修正**：timesuite 按模板 cluster bootstrap；LME/LoCoMo 按 session 聚类（如适用）。报告 design effect / 有效样本量。
- **多重比较**：3 主张族内 Holm；secondary 比较（其余 baseline/数据集）BH 校正；**全量报告原始 p**；不做「事后选最强基线」。
- **样本量与 MDE**：pilot 仅校准成本与方差；**仿真功效**（power=0.8、最小感兴趣效应预注册）决定样本量与扩样顺序。扩样顺序：LME temporal-reasoning 全量 → LoCoMo cat2 全量 → 再考虑 oracle。LME-KU 不参与扩样（§1 H2）。
- **偏差登记**：一切偏离进 `Deviations`（时间/原因/影响/补偿实验）。

---

## 7. 冻结项

| 项 | 冻结值 |
|---|---|
| 审计基线 repo commit | `ebd642b` |
| policy_version | `4`（v1.25 起：gnomic 回归检索体 + IMPORTANT.md 重命名） |
| Node | pin 24（`.nvmrc`；`engines >=22.13`）；CI 矩阵 22/24（node:sqlite 需要，2026-10-02 存储层切换后）；实验记录 `24.11.1` |
| Ollama | `nomic-embed-text-v2-moe:latest`，digest `ff9c2f10ef5e3722623a1b396e1e04efc27a93112c83e9b7b7b9ca1d05620965`（768 维，2026-10-02 本机实测在线） |
| DeepSeek reader | `deepseek-flash`（temperature 0；2026-10-01 由 `deepseek-v4-flash` 改名） |
| Judge | `gpt-4o`（不同源；兜底见 §4） |
| judge prompt hash | 冻结文件 `eval/judge/42d5fff0-judge-correctness.md`（sha256 `42d5fff0dcb3…`）；`judge_id = gpt-4o@42d5fff0dcb3`（文件名前缀 = 内容 hash8，`judge.mjs` 强制校验） |
| reader prompt hash | Task 1.4 冻结并回填 |
| tokenizer | 目标 `cl100k_base`；本机未安装 tiktoken → 实际 `estimate@v1`（偏离已登记；若安装须 Changelog 并评估影响） |
| config_hash | runner 每条结果记录（全部配置序列化 hash） |
| retrieval.factors 权重 | `embed 0.4 / time 0.2 / activation 0.25 / links 0.15`（P1.2 冻结；主实验前不得更改） |
| 注入预算 | 插件侧 `injection.memories_budget_tokens`（0=不限）；eval 统一 `render-budget.mjs` + 同一 token counter；3 档见 §5 |
| 价格表 | 见 §10（执行日复核，差异入 Changelog） |

---

## 8. 排除规则

1. 数据损坏（下载不完整、解析失败）；
2. 官方证据缺失（LME `answer_session_ids` / LoCoMo `evidence` 缺失）；
3. 单题超时 > 3 次；
4. 命中排除的题在 `results/` 记录 item_id 与原因，并在论文报告排除计数。

---

## 9. 停止规则与扩样顺序

- **预算硬帽**：`EVAL_MAX_CNY` + `EVAL_MAX_CALLS`（§10）；超帽按预注册顺序裁剪：先裁 LoCoMo 至子集 → 再裁 temporal-reasoning → **不动 LME-KU 与 timesuite**。
- **扩样顺序（仿真功效后执行）**：LME temporal-reasoning 全量 → LoCoMo cat2 全量 → oracle。
- **G3.5 决策门**：按 §11.2 触发条件执行 `ship-only / ship+C / revise-B`，规则在看结果前冻结。

---

## 10. 预算帽与成本口径（D20）

- 统一命名：**`EVAL_MAX_CNY`**（人民币口径），默认等值 **¥300**；硬顶 `EVAL_MAX_CALLS = 50000`。
- 成本公式：`calls = ingest_classify×turns + derive×(turns/N) + summary×sessions + judge×questions + reader×questions + nudge×(turns/N) + dialectic×reason_calls`；fullcontext 超长 prompt 成本入模；主单元 `--no-cache` 双跑按 **×2** 入模。
- 价格表（执行日抄录/复核）：

| 模型 | 输入 cache miss | 输入 cache hit | 输出 | 记录日期 |
|---|---|---|---|---|
| deepseek-flash（off-peak） | $0.15 /M | $0.003 /M | $0.60 /M | 2026-10-02（官方定价页 + 独立核验 2026-09-18） |
| deepseek-flash（peak 01:00–04:00、06:00–10:00 UTC 工作日） | $0.30 /M | $0.006 /M | $1.20 /M | 同上 |
| gpt-4o（计划 judge） | 不可得（无 OPENAI_API_KEY） | — | — | 已按 §4 同源兜底：deepseek-flash judge |
| gpt-6.1-sol（codex 中转，≤272K） | $1.00 /M | $0.05 /M | $5.00 /M | 2026-10-03（用户提供） |
| gpt-6.1-sol（codex 中转，>272K） | $2.00 /M | $0.10 /M | $7.50 /M | 同上 |

- gpt-6.1-sol 缓存创建价：$1.25 /M（≤272K）/ $2.50 /M（>272K）。经 codex 通道每次调用固定 ~11.9K 输入 token（其中 ~10.5K 命中缓存），成本对账须按此计。**主实验 judge 成本需重估**（估计约 $20–45，取决于系统×题量与双跑；必要时按计划 §10 经 Changelog 上调 `EVAL_MAX_CNY`）。

- runner `--estimate` 先行；`RUNLOG.md` 每单元对账（含双跑 ×2）。
- 预期区间（B 档）：主实验 judge+reader 约 ¥80–150；pilot/敏感性/双跑约 ¥40–100；留 20% 缓冲。

---

## 11. C-extension 预注册段（全文；P0.1 第 11 项）

### 11.1 升级内容（相对 B，不新增主张）

1. **多随机种子**：主表单元在 seed ∈ {0,1,2} 下重跑（`--no-cache`），报告跨种子方差与合并估计；**若 P0.6 实测模型不支持 seed，则改用预注册扰动方案**（温度 / 提示顺序 / 同义改写）并报告「扰动方差」。
2. **LME-M 长上下文压力**：`--variant m` 跑 ForeSight + 2 主比较基线，检验长历史下生命周期/预算优势是否保持。
3. **双 judge**：第二位 judge 模型（与第一位及 reader 尽量不同源）独立判定争议题与分层子集；报告双 judge 一致性 + 仲裁规则。
4. **外部评审**：≥2 位外部评审按评审表读稿，修订记录归档。
5. 可选：LME temporal-reasoning 全量、双标注者 κ。

### 11.2 G3.5 触发条件（满足任一即触发）

1. **主效应边缘**：H1–H3 任一主比较的配对差值 95% CI 含 0，或校正后 p ∈ (0.05, 0.15)；
2. **非确定性偏大**：任一主表单元 `--no-cache` 双跑 Δ > 2pp；
3. **judge 可靠性未达标**：κ ∈ [0.6, 0.7)（或 per-stratum/AC1 显示分层不稳）；
4. **内部评审要求**：评审人或作者判定需要外部加固。

输出三选一：`ship-only` / `ship+C` / `revise-B`；决策与依据写入 Changelog。

### 11.3 分析口径与时间线

- C 结果作为稳健性附录并入论文 v2；若 C 与 B 冲突，**以预注册主分析（B）为准**并如实报告冲突。
- 时间线：G3.5 判定 `ship+C` 后约 3 周（种子重跑 ~1 周 / LME-M + adapter ~0.5 周 / 双 judge + 仲裁 ~1 周 / 外部评审 ~0.5 周，可部分并行）。
- 合作者：solo + 抽检复核；C-extension 前找好第二位标注者。

---

## 12. stale_gt 标注协议（D14）

- **定义**：对知识更新类查询，注入证据若包含「更新前的旧值」（pretraining/历史值）即标 `stale_gt=true`，并附 `stale_reason`（如 `pre_update_value`、`superseded_anchor_expired`）。
- **标注器**：`eval/lib/stale.mjs`，**规则优先**（更新前答案匹配 + 人工抽检）；版本冻结为 **`rules@v1`**（P1.6 交付，文件名/常量即版本；自检通过）。
- **抽检**：≥30 条双轮抽检，一致率 **≥90%**；<90% 触发复核/重标。
- **留档**：标注器版本写入 `trace.versions.stale_annotator`；公开基准 stale 辅证结果必须附一致率；一致率不达标时 H1 公开基准辅证降级为探索性。
- **禁止**：标注器不得读取答案字段以外信息用于记忆侧写入（泄漏控制，见 Task 1.6 SPEC）。

---

## 13. decorative / reserved 策略字段清单（C9，Task 1.2 定稿）

> 原则：`policy.yaml` 每个配置字段必须有执行者，或显式登记为 **reserved/decorative**。以下为审计终稿；`tests/policy-consistency.test.mjs` 强制「模板每个叶子字段要么有执行者、要么出现在本节」。README/论文措辞同步降级为「已实现的策略字段」。

**decorative / reserved（无执行者，仅文档语义或 nudge 文案）**：

| 字段 | 现状 | 说明 |
|---|---|---|
| `gate.fallback` | 无执行者 | 分类器兜底当前恒为 rules（P1.9 双语扩展后由代码决定）；该字段保留 |
| `aspects.*.storage`（gnomic 已执行） | 其余三个未读 | `aspects.gnomic.storage` 由 gate 执行（memory=写入记忆库 / doc=拒写并提示 IMPORTANT.md 路由）；其余仅 nudge 文案 |
| `aspects.*.injection` | 仅 nudge 文案 | 注入资格由 aspect 类型 + 生命周期（progressive 窗口）实现 |
| `aspects.*.expiry` | 无执行者 | 过期语义在 `evolve/temporal` 按 aspect 硬编码（progressive 才过期，perfect/prospective 永不过期） |
| `aspects.*.renewable`（progressive 已执行） | 其余三个未读 | `renewalDue` 只查 progressive |
| `aspects.*.default_ttl_days`（progressive 已执行） | 其余三个未读 | TTL 只对 progressive 生效 |
| `aspects.*.review_every_turns`（prospective 已执行） | 其余三个未读 | progressive 复审由 TTL 窗口驱动，不按 turn 数 |
| `aspects.progressive.telicity.unbounded_force_ttl` | 无执行者 | unbounded 强制 TTL 在 `progressiveWindow` 硬编码 |
| `aspects.*.modalities.*` | 无执行者 | 情态复审分支在 nudge 按 modality 硬编码 |
| `derive.trigger` / `derive.every_n_turns` | 无执行者 | 当前由 session turnEnd 触发（observer），不按 N 轮 |
| `nudge.render` | 无执行者 | 渲染恒为 dialog |
| `llm.base_url` | 无执行者 | base URL 走 config 解析链（显式选项 → 环境变量 → defaults），policy 副本保留 |
| `audit.events_table` / `audit.emit_session_events` | 无执行者 | events 表恒写；`log_file` 已执行 |
| `consistency_check` / `chinese_markers.bounded` | 无执行者 | 一致性检查由测试承担；rules 中文标记编译在 `gate/classify.ts` |
| （已接线）`transitions.*` | — | 转换表全部字段已由 `src/evolve/transitions.ts` 读取执行（v1.26 起） |

**因子权重（已执行，预注册冻结）**：`retrieval.factors` = `embed 0.4 / time 0.2 / activation 0.25 / links 0.15`（P1.2 起冻结；主实验前不得更改，见 §7）。

---

## 14. 其他待拍板开关（计划 §13，默认值）

1. 时间线档位：**B（默认，8–9 周）+ G3.5 决定 C-extension**。
2. venue：**arXiv cs.CL 先行**；workshop 待反馈；中文期刊备选。
3. 开放范围：代码+脚本+timesuite 开放（MIT）；第三方数据仅脚本拉取；汇总结果与 traces 开放（不含原始数据）。
4. 分类器：**默认 A（双语 rules）+ 切换规则，G1 按 Task 1.9 全量实测（400 条，中英各 200）终审**（见 §15）。
5. H3 预算口径：优先下沉插件；否则登记 deviation + channel 分层（§1 H3）。
6. 公开基准 stale_gt：规则标注器 + ≥30 条抽检一致率 ≥90%（§12）。
7. 成本口径：双跑 ×2、nudge/dialectic 入模、`EVAL_MAX_CNY` 统一（§10）。
8. 时间线目标（2026-10-01 起，业余节奏；**非冻结**，实际以 `STATUS.md` 为准）：

| 阶段 | 目标窗口 | 说明 |
|---|---|---|
| P0 预注册与基线 | 2026-10-01 → 10-03 | G0 |
| P1 机制修复与基建 | 10-04 → 10-16 | 2 checkpoint；未过 G1 不进 P2 |
| P2 主实验 | 10-17 → 10-26 | pilot → 主矩阵 → 消融 → 人审 → 冻结（G2/G3） |
| P3 bench-timesuite | 10-27 → 11-02 | 生成 + 校验 + 全系统运行（G4） |
| P4 分析与写作 | 11-03 → 11-17 | 统计图表 → 草稿 → 合规审计 → 评审 → G3.5 |
| P5 发布 | 11-18 → 11-21 | repo 0.2.0 / artifact / arXiv（B 预印本） |

- B 档预印本目标：**2026-11 下旬**（≈8–9 周）；G3.5 判定 `ship+C` 则 C-extension 再 +3 周。

---

## 15. 分类器语言决策门（C5，看结果前定规则）

**背景（代码证据）**：现有 rules 分类器只识别中文强信号（`src/gate/classify.ts:40-43`：会/要/了过/正在）；英文无标记陈述一律落入 `gnomic`（`classify.ts:118-124`），而 gate 明确拒绝 gnomic 写入（`src/gate/gate.ts:242-248`）。因此 LME/LoCoMo 英文 turn 几乎全部拒写、记忆库≈空（C5）。本决策门在看结果前冻结「默认方案 + 切换规则」，G1 按 Task 1.9 全量实测终审（D16，避免循环依赖）。

- **A（默认）**：双语 rules 扩展——英文时态/日期标记、`extractDate` 英文相对日期、中英混合。
  - P1.9 交付范围（冻结）：英文时态/体标记（如 did/have done/am doing/will），ISO 与相对日期解析统一 **UTC**（C8 联动），中英混合句式；**不改变 4 aspect × 4 anchor 定义**。
- **B（备选）**：主实验改用 LLM gate（reader/judge 之外新增分类调用）。
- **切换规则（冻结）**：G1 时若 A 的 gate-eval 全量（400 条，中英各 200）**aspect 准确率 ≥80%** 则维持 A，否则切 B。P0 预实验可用 150/语 做 smoke，**不作最终判据**。anchor/category/forbidden 准确率与混淆矩阵作为报告项（不设切换门槛）。
- **成本影响**：
  - A 增量 LLM 成本 = **¥0**（rules，0 调用），与「确定性优先 / 无 key 可跑」一致；
  - B 增量 = `turns × 1` 分类调用/单元（`cost.mjs` 以 `classifyPerTurn=1` 建模）；若 G1 切 B，按 Task 0.5 执行日价目重估总调用与成本，并**经 Changelog 上调 `EVAL_MAX_CNY`**（默认 ¥300 可能不足）。
- 无论选哪个，adapter 必须报告写入接受率（D7/R14）；英文接受率 <50% 触发 R14 处置。
- **终审在 G1（Task 1.9 实测后）**：实测值与 A/B 决定追加到 Changelog；冻结后的默认与切换规则不得事后更改。

---

## Changelog

| 日期 | 版本 | 内容 |
|---|---|---|
| 2026-10-01 | pre-reg-v1 | 初次预注册（Task 0.1）；对应计划 v3.1 |
| 2026-10-01 | pre-reg-v1.1 | Task 0.6：§14 十项开关 + 时间线目标冻结；seed 探针脚本交付（`eval/scripts/seed-probe.mjs`），实测 pending（无 API key，D19 替代方案已预注册于 §11.1） |
| 2026-10-01 | pre-reg-v1.2 | Task 0.7：§15 分类器语言决策门定稿（默认 A + G1 切换规则 + 成本影响 + P1.9 范围冻结） |
| 2026-10-01 | pre-reg-v1.4 | Task 1.2：检索因子名对齐（embed/time/activation/links）+ 权重冻结（0.40/0.20/0.25/0.15）；`render_anchor` 值域接线（true/short/always/endpoint）；§13 decorative 清单定稿（全 policy 表面审计） |
| 2026-10-01 | pre-reg-v1.5 | Task 1.3：trace 写入器 + token 计数（estimate@v1）+ 预算护栏接入 runner；`--selfcheck` 5 题离线端到端（真实 Store/search/render + ManualClock），运行时 SIR-i/SIR 与 `trace.mjs --sir` 复算一致（0.3333/0.2000） |
| 2026-10-01 | pre-reg-v1.6 | Task 1.4：LLM 内容哈希缓存 + `--no-cache` + 退避重试 + usage 记账（`eval/lib/llm.mjs`）；judge 冻结机制（文件名 hash 前缀强制校验、篡改检测、可插拔）+ 官方 judge prompt 冻结 `eval/judge/42d5fff0-judge-correctness.md`（judge_id `gpt-4o@42d5fff0dcb3`） |
| 2026-10-01 | pre-reg-v1.7 | Task 1.5：消融开关（`lifecycle.enabled` / `activation.conflict_enabled` / `gate.classifier`）走 policy + 单测；插件侧 token 预算（`injection.memories_budget_tokens`，`src/tokens.ts` 单一估算器）+ eval `render-budget.mjs`；7 系统（foresight/nolifecycle/recency/rag/summary/fullcontext/closedbook）；`runner --dry-run` 21 条 trace 校验通过 |
| 2026-10-01 | pre-reg-v1.8 | Task 1.6：`adapters/SPEC.md` 冻结（隔离/抽取/双角色/UTC/探针/答案/泄漏/stale）；`lib/stale.mjs` `rules@v1` 自检通过；三基准 adapter + golden 各 5/5 自动核对；`extract.mjs` 抽取器接口冻结；人工签核在 G1 前完成 |
| 2026-10-01 | pre-reg-v1.9 | Task 1.7：基准拉取完成 — LME cleaned（MIT，rev 98d7416c，s SHA256 `d6f21ea9…` 与上游独立记录一致；KU=78、abstention=30 实测确认）；LoCoMo（CC BY-NC 4.0 实测；1986 QA，cat2=321/cat5=446）；`--check` 全绿；数据仅本地 `eval/data/`（gitignore，不再分发）；LME-M（~2.7GB）留待 C-extension |
| 2026-10-01 | pre-reg-v1.10 | Task 1.8：评分器 `eval/score.mjs` + 统计骨架 `eval/lib/stats.mjs`（McNemar exact / paired bootstrap CI / Holm / BH / 效应量 / seeded，自检通过）；输出 JSON+markdown+10 条人工抽查样本；对 dry-run 产出 foresight vs recency 配对表（D18：20 题 smoke 表在 1.10 替换）；人工抽查 10 条待签核 |
| 2026-10-01 | pre-reg-v1.11 | 全局改名（用户指令）：reader/LLM 默认模型名 `deepseek-v4-flash` → **`deepseek-flash`**（`src/defaults.ts`、templates、README、eval 脚本/样例 trace、DECISIONS §4/§7/§10）；无既有主实验结果受影响；P0.6 seed 探针归档与历史记录保留原模型名以如实留痕 |
| 2026-10-01 | pre-reg-v1.12 | Task 1.9（离线部分）：双语 rules 扩展（英文时态/相对日期 + 中英混合 + CN 计划/未然 + ISO 区间/开放锚）；gate-eval 400 条冻结（zh/en 各 200，含 40 条对抗盲点如实计错）：**rules aspect 90.0%**（zh 90.0 / en 90.0 / hard 71.4%）→ **PASS，G1 维持方案 A**（切换规则不触发）；CI 门槛测试守住 ≥80%。LLM 对照臂 pending（需 key，见 Deviations）；第二标注者 κ/AC1 待人工抽检 ≥40 条（G1 前） |
| 2026-10-01 | pre-reg-v1.13 | Task 1.10（离线部分）+ **G1 C5 终审记录**：20 题 × 7 系统 smoke = 140 trace（校验通过），机制清单 C1/C2/C3/C5/C6/C7/C8/C10 全 PASS；foresight acc 0.90 vs recency 0.60 / nolifecycle 0.60（stub reader，离线）；RUNLOG 首条；CI 增加 smoke 守卫（ubuntu/node24/UTC）。**方案 A 终审：维持**（依据 §15 切换规则，aspect 90.0% ≥ 80%）；真实 reader/judge 成本对账与人工项待 key（Deviations） |
| 2026-10-02 | pre-reg-v1.14 | **运行时适配（主实验前）**：存储层由 better-sqlite3 切换为内置 `node:sqlite`（Electron-ready，blob→f32 集中为 `src/f32.ts`）；dsh peer 放宽至 0.2.0-rc 线（作者在 dsh 0.2.0-rc.2 实测消息往返）。**验证（本机 Node 24.11.1，新驱动）**：build ✅ · 单测 120/120 ✅ · smoke 20×7 数字与切换前逐项一致（foresight 0.90、SIR-i 0.1429；机制清单全 PASS）✅ · gate-eval rules 90.0% 不变 ✅ · 全部 selfcheck ✅ · `fetch --check` ✅。policy/schema/机制语义无变化（policy_version 仍 3），H1–H3 与既有 Deviations 均不受影响；engines 提升至 >=22.13、CI 矩阵改 22/24（原 12/12 证据由新矩阵首跑取代）。运行注记：`node:sqlite` 在 Node 24 仍标记 experimental（stderr warning，无功能影响）；实验记录 Node 固定 24.11.1 |
| 2026-10-02 | pre-reg-v1.15 | **G1 key 依赖项闭环（临时 key 周期）**：①gate-eval **LLM 臂** 400 条完成：aspect 96.5%（zh 99.5 / en 93.5）、anchor 76.0%、joint 74.5%；306 实调 + 94 缓存；tokens 39.9万/8.5万。注意 LLM anchor 低于 rules（76% vs 90%），A/B 切换判据仍只取 aspect（rules 90% → 维持 A）。②**真实 smoke**（real reader `deepseek-flash` temp 0/seed 0 + judge 同源兜底）：140 trace 校验通过，机制清单全 PASS，foresight acc **0.80**（recency 0.40 / nolifecycle 0.50 / closedbook 0.50）；78 实调 + 132 缓存；**成本模型调用数对账 est=210 vs actual=210 → 误差 0.0%**（<15% 达标）。③judge：gpt-4o 不可得，按 §4 同源兜底 `deepseek-flash@42d5fff0dcb3`，主表将附人类子集敏感性、C-extension 触发双 judge。④价格表抄录（见 §10）；⑤Ollama digest 回填（见 §7） |
| 2026-10-01 | pre-reg-v1.3 | Task 0.6 补测：seed 支持性探针实测完成（`deepseek-v4-flash`，seed=0 重放 3 次：`outputs_identical=false`、无接口错误 → `seed_effective`）；§4 回填；归档 `eval/results/seed-probe_deepseek-v4-flash.json`；C-extension 维持 seed 方案、§11.1 不变；Deviations「无 API key 未实测」偏离消解 |
| 2026-10-02 | pre-reg-v1.16 | 勘误：清除误入文档的无关人员字样（笔误，共 3 处）；执行者与抽检复核均为作者本人；无判定协议、指标或口径变更 |
| 2026-10-03 | pre-reg-v1.17 | **基础设施修复（G1 核验发现）**：① `eval/lib/llm.mjs` 空响应、或 `json:true` 而解析失败 → 按可重试错误处理且**不写缓存**（错误信息含 completion/reasoning 计数）；② judge `maxTokens` 256→1024（`eval/lib/judge.mjs:72`）；③ smoke real reader `maxTokens` 200→512（`eval/smoke.mjs:149`）；④ gate-LLM 分类 `maxTokens` 1000→2048（`src/gate/classify.ts:82`）；⑤ nudge verdict `maxTokens` 256→1024（`src/nudge/nudge.ts:377`）；⑥ 清理 5 条空内容坏缓存。验证：build ✅ · 单测 120/120 ✅ · llm/judge selfcheck ✅。请求 hash 含 maxTokens，修复后旧坏缓存不可达；受影响产出（smoke real、gate-eval LLM 臂）重跑待 key |
| 2026-10-03 | pre-reg-v1.18 | **judge 切换为 gpt-6.1-sol（PackyAPI codex 中转通道，经本机 codex-bridge + chat/completions shim）**：§4 预注册主 judge gpt-4o 不可得，改用不同源 gpt-6.1-sol（非官方中转；Responses-only，经 `scripts/codex-chat-shim.mjs` 翻译为 chat/completions）；judge prompt hash 不变（`42d5fff0dcb3`）。约束：每次调用 ~11.9K 输入（~10.5K 缓存）、单次 5–35s、无 `response_format`/`max_tokens` 支持（JSON 依赖 prompt + `parseJsonContent` 容错）；价格入 §10。同源兜底 deviation 随之消解（改记中转通道 deviation） |
| 2026-10-04 | pre-reg-v1.27 | **架构审计修复（P0+P1）**：① B1 激活后未然体的 `verdict_due` 接入 nudge（复审问题 + auto_resolve 裁决：实现→perfect / 未实现→软删 / 存疑→延后 7 天）；② B2 uncertain 兜底接入 nudge（默认复审问题；`nudge.auto_reclassify_uncertain` 开启时 LLM 再分类，失败保持兜底）；③ B3 golden/adapter 自检切新语义（`probeItem` 改用 `applyDueTransitions`；ts-g4/lme-g3/loco-g3 过期题 `probe_hit` false→true；SPEC/G1_SIGNOFF 同步）；④ B4 rules 证据层 renew 增加续期措辞约束（无措辞→新事实，防静默吞写）；⑤ B5 `auto_resolve_prediction` 开启时 transitions 不再重复 hold；⑥ P1 清理：server 体校验补 uncertain、nudge 冲突复审补 gnomic/uncertain、文档陈旧修正、transient 结果目录入 gitignore。单测 **139/139** · golden 5/5×3 · 离线 smoke 机制全 PASS |
| 2026-10-04 | pre-reg-v1.26 | **正交转换模型补全（体×锚，用户裁定）**：① 锚承载时间几何：prospective 分类改为 point（事件/激活时刻）/interval（窗口）/none（无时间→等证据）；prediction 的 predict_by 迁入锚（保留 metadata 兼容）；② 转换引擎扩展：prospective `start` → **机械激活**（转 progressive、end=∞、语义时间）；`interval.end`/prediction point → 裁决到期**无证据不改变**（标记 `overdue_since` 等证据）；证据动作 **complete / renew / activate / cancel(软删) / reschedule**；open / interval 缺 end = **∞**（不机械到期，除 `unbounded_force_ttl`）；续期证据 → 延窗（`metadata.renewed_at` 作为 TTL 基）；③ gate 证据层支持五种动作（LLM-assisted + 规则兜底）；④ 锚语义变更同步 gate-eval：SPEC/gold 重生成（400 条），rules aspect **90.0%**（不变）、anchor **90.0%→92.5%**，LLM 臂 aspect 97.25% / anchor 79.75%；单测 **134/134**；⑤ timesuite 第二波：新增 prospective（激活+保持）与 renewal 两类，**6 类 × 15 = 90 题离线全过** |
| 2026-10-04 | pre-reg-v1.25 | **gnomic 回归检索体 + IMPORTANT.md（用户裁定）**：① gnomic 不再"始终注入"：`aspects.gnomic.storage='memory'`、injection=conditional，写入记忆库、与其他体一样按语义检索注入（语境天然来自检索）；`f_time` 对 gnomic 中性（不再随锚龄衰减）；gnomic×gnomic、gnomic×perfect 纳入冲突矩阵（偏好可更新/被完成事实取代）。② `user.md` → **`IMPORTANT.md`**（读取回退旧名一版）；policy 字段重命名（`important_doc_writer` / `important_section` / `important_budget_chars` / derive target `important_doc`）+ **policy_version 3→4**。③ derive `user_trait` 分流（`split_important`）：全局重要 → IMPORTANT.md；语境恒常 → gnomic 记忆；LLM-assisted + 规则兜底（"始终/必须/身份/语言/安全/禁忌"等）。④ 验证：build ✅ · 单测 **129/129** · README/模板同步。**待办**：smoke real 重跑（系统冻结后） |
| 2026-10-04 | pre-reg-v1.24 | **bench-timesuite 第一波（转换引擎四类）**：`eval/bench-timesuite/` 交付 SPEC/gen/verify/selfcheck + `items.jsonl`（4 类 × 15 = 60 题，确定性、不依赖 judge）：**完成归位 / 时钟跳跃（离线一致性）/ 兜底升级 / 降冗余序列**；离线自检 **60/60**（真实 Store/transitions/search）。**附带修复**：`Store.insertMemory` 支持 `createdAt` 覆盖，`gateWrite` 以分类时间（`input.now`）作为记录时间——修复 gate 写入 `created_at` 取 store clock 导致 TTL 窗口漂移的 bug（对 P2 真实跑同样重要）。单测 126/126 |
| 2026-10-04 | pre-reg-v1.23 | **系统功能补全：时态演化（恒常体除外，用户裁定 2026-10-04）**：① 新增 `aspect='uncertain'` 兜底桶（分类失败写入、可检索、可再分类；`gate.fallback_write`）；② 转换引擎 `src/evolve/transitions.ts`：写入时 `metadata.lifecycle` 计划、窗口结束 → 完成体（**语义时间**，离线补扫不漂移）、`memory.transition` 审计、`promoteUncertain`；③ 演化式降冗余：完成证据使同题进行体**归位完成体**而非新插条目；证据层默认 **LLM-assisted + 规则兜底**（`buildEvidenceFn`，core 已接线）；④ 读路径：search 含 uncertain、完成体渲染「已完成（于 T）」、`core`/`render`/eval `foresight` 系统改用 `applyDueTransitions`；⑤ 验证：单测 **126/126**；离线 smoke 新语义机制清单全 PASS（C1/C2 改为「归位完成体、无进行中注入」），foresight 0.80。待办：smoke real 重跑、timesuite 对应题型（完成归位/时钟跳跃/兜底/降冗余）、恒常体 scope（另议） |
| 2026-10-04 | pre-reg-v1.22 | **R14 处置：切换 LLM gate（方案 B）**：runner 增 `--gate llm`（`gate.classifier='llm'`），分类走 DeepSeek（`gate.llm_model`）、逐 turn 1 调用；eval 侧 `EVAL_GATE_CONCURRENCY`（实测 6）并发，分类请求与 shipped 逐 turn 语义一致（非批处理）。校准（LME-KU s，1–2 题）：接受率 **14.8% → 35.8%**（仍 <50% 阈值，R14 口径待复议）；分类约 1.4k prompt / 0.58k completion tokens 每调用，≈$0.20/题，6 并发 ≈7 min/题。**主矩阵可行性警示**：主表 `--no-cache` 双跑 × 7 系统会重跑分类（LME-KU ≈49 万次调用、墙钟数天，预算或超 ¥300）。待裁定：分类批处理 / `--no-cache` 例外（分类缓存视为 ingest 冻结）/ 缩档；trace 记 `gate_classifier` |：① LME cleaned s × KU × 30 题：**12/30 correct**，mean 注入 11.6 条，写入接受率 2181/14740=**14.8%**，排除 0；reader 30 + judge 27 实调。② LoCoMo cat2 × 30 题（跨对话轮转采样）：**0/30**，mean 注入 20 条，接受率 2097/17646=**11.9%**，排除 0；reader 27 + judge 27 实调。③ 成本/时间：两单元合计 LLM calls≈114（judge prompt≈32.7 万 tokens，gpt-6.1-sol），远低于 ¥300 帽；无崩溃、缓存/护栏正常。④ 发现：**R14 英文写入接受率 <50% 触发**（两基准均 ~12–15%，待处置）；LoCoMo 对话数据上 gate 抽取+检索未能命中证据（需证据覆盖率诊断；trace 注入未存 content，覆盖率暂不可算）；LME-KU 抽样取文件序前 30 题、LoCoMo 改为跨对话轮转（规则固化在 `bench-run.mjs`）。运行 commit 记录为 `0d20b5b`，实际含未提交的集成修复（v1.20） |：① `eval/runner.mjs` 真实 bench 管线落地（新 `eval/lib/bench-run.mjs`）：数据加载 → 逐题隔离世界 → gate/raw 写入 → 统一预算检索 → reader（冻结 prompt）→ judge → trace v2，含 `--limit/--filter`（pilot 子集）、双 client 记账、预算护栏；② 修复 P1 遗留：LME 真实日期格式 `YYYY/MM/DD (Day) HH:MM` 解析（原假设 ISO，真实数据全挂）、归一化保留 `question_type`、LoCoMo 由「每对话仅首条 QA」改为展开全部 QA；③ reader prompt 冻结：`eval/reader/223c8691-reader-qa.md`（sha256 前缀 `223c8691`），trace `versions.reader_prompt_hash` 记录；④ 端到端验证：LME oracle × KU × 1 题 × foresight → correct（注入 5，接受率 5/24，guard ok）。仍未完成：configs 文件（现用模板 + `--budget-tokens`）、公开基准 stale 配对、timesuite（P3） |
| 2026-10-03 | pre-reg-v1.19 | **P1 重跑结果（gpt-6.1-sol judge）**：① gate-eval LLM 臂重跑：aspect 96.50%→**97.25%**（anchor 76.0→73.5、joint 74.5→72.0；rules 臂 90.0% 不变，A/B 维持 A；差异含模型非确定性——classifier 调用未传 seed）；② smoke real 重跑（全新缓存）：foresight acc **0.90**（recency/nolifecycle 0.60、closedbook/rag 0.50、summary 0.40、fullcontext 0.40；配对 vs recency/nolifecycle 均 +0.30，p=0.0313，CI [0.10, 0.50]），judge 标签 correct 46 / incorrect 24 / **unknown 0**、空答案 0；成本对账 est=210 vs actual=210 → **0.0%**（reader 140 / judge 70；real 75 = reader 53 + judge 22；prompt 270,691 / completion 5,946，judge 通道 ~11.9K/次占主）；③ 修复 judge 独立 client 的记账缺口（`eval/smoke.mjs` trace cost/RUNLOG 现合计 reader+judge）；④ interval 题 gold 修正后重跑（原同源 0.80 结果被取代；reader 运行间方差：summary 0.35↔0.40，foresight 0.90 稳定）。附：首轮重跑因 bridge 未运行致全部 judge `fetch failed`（无效运行，已被本次取代） |

## Deviations

| 日期 | 偏离项 | 原因 | 影响 | 补偿实验 |
|---|---|---|---|---|
| 2026-10-01 | seed 支持性实测未执行（无 API key） | 环境无 `DEEPSEEK_API_KEY` | C-extension 跨种子方案待定 | `eval/scripts/seed-probe.mjs` 待 key 就绪后补测并回填 §4/§11.1 |
| 2026-10-01 | （消解）seed 支持性实测补测完成：探针已执行并回填 §4 | 环境 key 临时注入提供 | 原偏离无遗留影响 | 已执行 `eval/scripts/seed-probe.mjs`；归档见 §4 |
| 2026-10-01 | H3 token 计数使用 `estimate@v1` 估算器（非冻结的 cl100k_base） | tiktoken 未安装；本地 pnpm 11.22 与 CI pin（10.34.6）版本线冲突，安装会扰动 lockfile | 所有系统使用同一 counter → 等预算与相对比较有效；绝对 token 预算为估算口径 | P1.5 统一预算渲染沿用同一 counter；若安装 tiktoken 精确计数须在 Changelog 登记并评估对已产结果的影响 |
| 2026-10-01 | **D17 混合口径**：插件侧预算已实现（`renderMemories` 读 `injection.memories_budget_tokens`），但 eval 的 ForeSight `tool_retrieval` 通道仍由 eval 统一渲染器（`render-budget.mjs`，同 counter）截断 shipped search 结果 | 单一实现优先项①对 system_prompt 通道成立；tool 检索通道的 shipped 路径无预算参数，强行下沉会改动检索契约 | H3 主报告按 `channel`（system_prompt vs tool_retrieval）分层；跨系统同 counter 同预算仍有效 | 论文显式声明该评估口径；Task 4.2 披露；若下沉 tool 通道预算则登记 changelog 并重跑 H3 |
| 2026-10-01 | gate-eval LLM 对照臂未运行（P1.9） | 环境无 `DEEPSEEK_API_KEY` | A 臂 90.0% ≥80% 已足以执行 G1 切换规则（维持 A）；LLM 臂仅论文报告项 | key 就绪后 `node eval/gate-eval/report.mjs --llm` 补报告并回填 Changelog |
| 2026-10-01 | gate-eval 第二标注者 κ/AC1 未采集（P1.9） | 单人项目（solo + 抽检复核） | 报告标注 n/a；不影响 A/B 切换判据 | G1 前人工抽检 ≥40 条，补 κ/AC1 到报告附录 |
| 2026-10-01 | smoke（1.10）使用 stub reader，非真实 LLM 端到端 | 环境无 API key；机制检查与预算/trace 全链路可离线验证 | G1 的「真实端到端 + 成本估算误差 <15%」未闭环 | key 就绪后重跑 smoke（真实 reader/judge）并补成本对账，回填 Changelog |
| 2026-10-02 | （消解）gate-eval LLM 对照臂补测完成 + 真实 smoke 补测完成（临时 key） | 用户提供临时官方 key；判据与预算模型均闭环 | 原偏离无遗留 | 见 Changelog v1.15；真实 smoke：foresight 0.80、对账误差 0.0% |
| 2026-10-02 | **judge 同源**（计划 gpt-4o → 实际 `deepseek-flash`） | 无 OPENAI_API_KEY；§4 预注册兜底生效 | 存在自偏好风险：主表将附人类子集敏感性分析；C-extension 触发双 judge | G1 人工抽检 ≥40 条；P2.4 分层抽 ≥120 条双盲；必要时空运 gpt-4o/他源复核 |
| 2026-10-03 | **P1 产出含推理截断的空响应**：smoke real 9 行 judge `unknown`（实为 2 个唯一失败请求：interval-active-0「进行中」×5 系统、interval-active-1「评审 1 进行中。」×4 系统）、3 行空答案（`recency-smoke-update-0/1`、`summary-smoke-gate-reject-0`，实为 2 个唯一 reader 请求）、gate-eval LLM 臂 1 条空响应 | `maxTokens`（judge 256 / reader 200 / gate-LLM 1000）被 reasoning tokens 吃光，且空结果被 `llm.mjs` 缓存当成功复用 | smoke 汇总（foresight 0.80 等）与 gate-eval LLM 臂（96.5%）含此污染；机制清单与 SIR（ground truth）不受影响 | 已修复并清理坏缓存（Changelog v1.17）；有 key 后重跑 smoke real 与 `gate-eval/report.mjs --llm`，修正汇总/RUNLOG 并回填 |
| 2026-10-03 | **smoke interval-active 题 gold 不成立**（`eval/smoke.mjs:68`：事实为「评审 N 在 2026-01-01~01-20 进行中」，gold 只写「评审 N」） | 合成题面设计缺陷 | 14 条 interval traces 的 correct 判定与相关 judge 请求语义失真；人工抽查不可按「含 gold」判对 | 修正题面 gold（建议「评审 N 进行中」）后重跑该 14 条；G1_SIGNOFF §2 已标注、§2B 已排除 interval |
| 2026-10-04 | **prospective 锚语义变更 + gate-eval gold 重生成**：§15 冻结时约定"不改变 4 aspect × 4 anchor 定义"；本次把时间迁入锚（point/interval/none），gate-eval 400 条 `gold_anchor_type` 随之更新 | 正交模型要求锚承载时间几何（用户裁定） | 旧 gold（prospective 全 open）与新语义不符；C5 证据已用新 gold 重算（rules aspect 90%、anchor 92.5%）；smoke real 待重跑 | 已更新 SPEC/gold/report；Changelog v1.26；G1_SIGNOFF 相关条目以新报告为准 |
| 2026-10-04 | **policy_version 3→4（§7 冻结值变更）**：gnomic 回归检索体、`user.md→IMPORTANT.md`、injection/permission/derive 字段重命名 | 用户裁定的架构修正（恒常体不再特权注入，语境由检索提供） | 既有 traces 的 `policy_version=3/config_hash` 不再对应当前系统；G1 smoke real 证据语义过时（本就要重跑） | 已同步模板/测试/README；Changelog v1.25；smoke real 重跑后回填 |
| 2026-10-04 | **G1 机制语义变更**：C1/C2 由「过期=不注入（沉默）」改为「过期=归位完成体（可检索、渲染已完成）」；`expired` 状态不再由读路径写入 | 设计意图要求"准确记住已完成"而非隐藏（用户裁定） | 既有 G1 smoke real 证据（v1.19）语义过时；SIR-i/SIR 口径不变（以 stale_gt 为准） | 已更新单测与离线 smoke 机制检查；smoke real 重跑待执行；本变更登记入 Changelog v1.23 |
| 2026-10-04 | **P1 验收遗漏：真实 bench 编排从未实现**（`runner.mjs` 仅 selfcheck/dry-run；smoke 自带编排绕开 runner/adapters）；连带 LoCoMo `load()` 仅取首条 QA、LME 日期解析与 `question_type` 丢失、configs 目录为空、reader prompt 未冻结 | P1 任务验收聚焦单测/golden/smoke，未做真实数据端到端 | P2 无法按计划命令启动；上述均为集成层缺陷，不影响已入库的 G1 证据（smoke 使用合成题） | 已补：bench-run 管线 + adapter 修复 + reader prompt 冻结（Changelog v1.20）；pilot 前仍需 configs/公开 stale 配对；timesuite 依赖 P3 |
| 2026-10-03 | **judge 经第三方中转（PackyAPI codex 通道）而非官方 API**：需真实 codex CLI + 本机 bridge（127.0.0.1:3220）+ shim（127.0.0.1:3222）；模型名 gpt-6.1-sol 无法与官方模型卡逐字对齐 | 官方 OpenAI key 不可得；中转站为唯一可用的异源强模型通道 | ① 可用性/定价受中转站与系统代理影响（R8）；② 每次调用固定 ~11.9K 输入 token 开销（缓存后仍计费）；③ 无 `response_format`/`max_tokens`，输出约束靠 prompt；④ 模型版本不可冻结（仅 judge_id=模型名+prompt hash 入 trace） | smoke/P2 按 trace 的 judge_id 记录；C-extension 双 judge 保留；中转失效时回退 deepseek-flash 同源并登记；成本按 §10 对账 |
