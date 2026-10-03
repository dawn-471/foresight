# G1 人工签字清单（自动项已闭环，2026-10-02；核查内容 2026-10-03 补全并二次核验修正）

> 自动项证据：`eval/STATUS.md` G1 行、`eval/results/RUNLOG.md`、`eval/gate-eval/report/report.md`、
> `eval/results/smoke/summary.md`。以下 6 项需要人工确认后才能将 G1 置为 ✅。
> 2026-10-03 二次核验（GLM-5.3 复核）修正：§1 流程互锁、§2 `unknown` 根因与 interval gold 缺陷、§2B 新增 judge 同源补偿人审、§3 `ts-g5` 天数。
>
> 签核方式：在本文件对应行勾选/填写并署名日期，提交 git；随后 STATUS 将 G1 置为 ✅，启动 P2。
> 勾选格式示例：`[x]`；有疑问的条目请在「备注」写明，转 DECISIONS → Deviations。

## 0. 可执行性总览

| # | 项 | 现在可做？ | 内容位置 |
|---|---|---|---|
| 1 | stale_gt 抽检 ≥90% | ⚠️ 现稿与 G1 互锁，须先裁定（§1） | `eval/adapters/SPEC.md` §7；`eval/DECISIONS.md` §12 |
| 2 | 评分抽查 10 条（预检） | ✅ 现在可做 | `eval/results/smoke/review_sample.md` + `traces.jsonl` |
| 2B | judge 人审 ≥40 条（同源补偿） | ✅ 现在可做 | `DECISIONS.md:328`；样本 `traces.jsonl`（见 §2B） |
| 3 | golden 签核 | ✅ 现在可做 | `eval/adapters/golden/*.jsonl` |
| 4 | gate-eval κ/AC1 | ⏳ 需第二标注者 | `eval/gate-eval/items.jsonl` + `report/report.md` |
| 5 | G0 风险签字 | ✅ 现在可做 | 计划 §11（第 613–632 行）+ `DECISIONS.md` Deviations |

---

## 1. stale_gt 抽检 ≥90%（D14，需 ≥30 条双轮）— ⚠️ 先裁定再执行

- 核验发现的流程矛盾（2026-10-03）：现稿把样本来源写成 P2.1（G2）产出，但 G1 又要求本项通过才允许启动 P2 → 互锁，按现稿 G1 关不了。
- 协议本体不变（`eval/adapters/SPEC.md` §7 第 50–56 行 / `DECISIONS.md` §12 第 217–223 行）：
  1. 抽取 ≥30 条**含注入**的记录，且该题 ground truth 有 `stale: [{old, new}]`；
  2. 双轮独立核对（建议隔日）：每条注入记忆是否**包含 `old` 且不含 `new`** → 应为 `stale_gt=true`；
  3. 两轮逐条比对，记录一致/分歧；一致率 <90% 触发复核/重标并登记；不达标则 H1 公开基准辅证降级为探索性（R17）。
- 处置（二选一，均须写入 `DECISIONS.md → Changelog/Deviations`）：
  - **A（推荐）**：G1 关闭条件改为「标注协议冻结 + `rules@v1` 自检通过 + 抽检流程就绪」；≥30 条双轮抽检移到 **P2.1 产出首批公开基准 traces 后立即执行**，作为 G2 判据之一（STATUS 的 G2 行同步加此条）。理由：不阻塞 P2，且抽检对象与真实评估口径一致。
  - **B**：坚持 G1 前执行——需先补 LME-KU 子集运行能力（`eval/runner.mjs` 当前无 `--limit`，需加子集参数或离线 calibration 脚本），数据已在 P1.7 落盘（`eval/data/`），跑出 ≥30 条注入记录后双轮抽检。
- [ ] 已选择处置 A / B 并登记 DECISIONS（选择：____）
- （选 B 时）执行人/日期：________ · 一致率：____ · 备注：________

## 2. 评分抽查 10 条（judge 校准预检）

- 样本：`eval/results/smoke/review_sample.md`（2026-10-03 按题目分层重新生成；生成器 `eval/score.mjs → reviewSample`）。
- 选题规则：每道有 judge 参评的题取 1 条（优先非「不知道/闭卷」且最长的回答），所以不再是同一题的系统横排。
- gold 来源：下表（取自 `eval/smoke.mjs` 题面定义）；judge 理由中也会复述 gold。
- 判断方法：只看「答案是否与 gold 表达同一当前事实」→ 判断 judge 标签是否合理；
  系统为何失分（如 rag 无注入）不属于本项判定范围。
- 通过标准：与人工一致率 ≥80%（Task 2.1 的 judge 人审门槛；本项为预检）。

| # | system | item_id | gold | 模型答案 | judge 标签 | 你的判定 | 一致？ | 备注/分歧 |
|---|---|---|---|---|---|---|---|---|
| 1 | fullcontext | fullcontext-smoke-ttl-active-0 | 训练任务 0 在跑 | 训练任务 0 正在运行。 | correct | | [ ] 是 [ ] 否 | 同义复述，应 correct |
| 2 | summary | summary-smoke-ttl-active-1 | 训练任务 1 在跑 | 训练任务 1 在跑。 | correct | | [ ] 是 [ ] 否 | |
| 3 | summary | summary-smoke-ttl-active-2 | 训练任务 2 在跑 | 训练任务 2 正在运行。 | correct | | [ ] 是 [ ] 否 | |
| 4 | summary | summary-smoke-point-active-0 | 报告撰写进行中 | 撰写进行中 | correct | | [ ] 是 [ ] 否 | 省略主语，是否算 correct？ |
| 5 | summary | summary-smoke-interval-active-0 | 评审 0（gold 不成立，见下） | 进行中 | unknown | | [ ] 是 [ ] 否 | judge 请求被推理截断，见下 |
| 6 | fullcontext | fullcontext-smoke-interval-active-1 | 评审 1（gold 不成立，见下） | 评审 1 进行中。 | unknown | | [ ] 是 [ ] 否 | 同上；gold 缺陷，勿按"含 gold"判对 |
| 7 | summary | summary-smoke-update-0 | 研究生 | 大学生 | incorrect | | [ ] 是 [ ] 否 | 陈旧值答案，判 incorrect 是否合理？ |
| 8 | summary | summary-smoke-update-1 | 研究生 | 大学生 | incorrect | | [ ] 是 [ ] 否 | 同上 |
| 9 | summary | summary-smoke-multisession-0 | 接口联调已完成 | 接口联调已完成。 | correct | | [ ] 是 [ ] 否 | |
| 10 | summary | summary-smoke-final-0 | 缓存服务在跑 | 缓存服务正在运行。 | correct | | [ ] 是 [ ] 否 | |

**核查发现（2026-10-03，二次核验修正）**：

1. **`unknown` 的根因不是 JSON 解析失败，而是推理吃光 maxTokens**：两条失败的 judge 请求（interval-active-0 的「进行中」×5 系统；interval-active-1 的「评审 1 进行中。」×4 系统）在缓存中为 `content=""`、`json=null`、`completion_tokens=256` 且全是 reasoning tokens——`eval/lib/judge.mjs:72` 的 `maxTokens: 256` 没给正文留量。空结果被 `eval/lib/llm.mjs:106-115` 当作成功写入缓存，同题同答案的后续系统直接命中；所以 140 条 trace 里的 9 条只是 **2 个唯一失败请求**的回放。不加大 maxTokens（或删坏缓存），重跑必然复现。
2. **同类问题不止 judge**：缓存中 `content=""` 共 **5 条**——2 条 judge（如上）、2 条 reader（`eval/smoke.mjs:151` `maxTokens: 200` 被推理吃光；对应 traces 中 3 条空答案：`recency-smoke-update-0/1`、`summary-smoke-gate-reject-0`）、1 条 gate-eval LLM 臂（被 reasoning 吃光后混入 96.5% aspect 统计）。空内容入库 + 推理截断是系统性缺陷，P2 前必须修，否则同样污染主表。
3. **interval 题的 gold 本身不成立**：`eval/smoke.mjs:68` 的事实是「评审 N 在 2026-01-01 到 2026-01-20 期间进行中」，gold 却只写 `评审 N`（不是状态答案）。第 5/6 行不能按"同一当前事实"直接判定；已有一次成功 judge 调用把「进行中」判成与「评审 1」不同。**因此重跑后 0.80 不一定会动**，应先修题面 gold 再重跑受影响的 14 条 interval traces。
4. 处置进展（2026-10-03，已登记 `DECISIONS.md → Changelog v1.17 + Deviations`）：
   - ✅ 已修复：`eval/lib/llm.mjs` 空响应 / `json:true` 解析失败 → 可重试错误且不写缓存；judge `maxTokens` 256→1024；smoke reader 200→512；gate-LLM 1000→2048（`src/gate/classify.ts:82`）；nudge verdict 256→1024；已清理 5 条坏缓存。验证：build ✅ · 单测 120/120 ✅ · llm/judge selfcheck ✅。
   - ⏳ 待 key：重跑 smoke real 与 gate-eval `--llm`，修正汇总/RUNLOG（修复后请求 hash 变化，旧坏缓存不可达）。
   - ⏳ 待裁定：smoke interval 题 gold 修正（`smoke.mjs:68`）并重跑受影响 14 条；`unknown` 口径（现行按错误计入）是否保留。

- 一致率：____/10 · 执行人/日期：________
- [ ] 抽查通过（≥8/10） · [ ] 触发 judge 复核（<8/10，登记 Deviation） · [ ] `unknown` 根因与修复方案已裁定并登记

## 2B. judge 人审 ≥40 条（同源补偿，`DECISIONS.md:328`）

- 依据：judge 同源兜底的补偿要求 **G1 人工抽检 ≥40 条**。注意：§2 只是 10 条预检；§4 的 40 条是 gate 分类器的 aspect/anchor 一致性——都不是这一项。
- 样本：`eval/results/smoke/traces.jsonl` 中 judge 参评的行共 70 条（correct 34 / incorrect 27 / unknown 9）。
  - **排除 interval-active 两道**（gold 缺陷待修，共 14 行，其中含全部 9 条 `unknown`）；余 **56 条**中分层抽 **40 条**（按题 kind 与 correct/incorrect 分布），并注明排除清单。
- 流程：人工只看 query + gold + 模型答案（**不看 judge 标签**），独立判 correct/incorrect；再比对 judge 标签；计算一致率与 Cohen's κ 写入报告附录。
- 通过标准：一致率 ≥80%（Task 2.1 judge 人审门槛口径）；κ 数值报告（P2.4 的 ≥120 条双盲才承担 κ≥0.7 主检验）。
- gold 来源：`eval/smoke.mjs` 题面定义；interval 题 gold 修复后如需纳入，先更新本项抽样规则。
- [ ] 已完成：执行人 ________ 日期 ________ · 一致率 ____/40 · κ ____ · 排除与放宽说明 ________

## 3. golden 签核（每基准 5 条）

- 机器证据：`node eval/adapters/<bench>.mjs --selfcheck` → 各 5/5（自检断言 `accepted` / `stale_marked` / `probe_hit`，三项实际值=expected）。
- 人工判断：逐条确认**场景语义与 expected 是否自洽**（写入条数、aspect/anchor 合理性、过期/未开始抑制、冲突旧值标注）。
- 背景参数：progressive 默认 TTL = 7 天（`templates/policy.yaml.example:38`）；perfect 永不过期；「未开始」门控见 C10。
- 注意：渲染预算/覆盖率不在 selfcheck 断言内，随 P2 报告核验。

### 3.1 timesuite（`eval/adapters/golden/timesuite.jsonl`）

| id | 场景摘要 | expected | 人工结论 |
|---|---|---|---|
| ts-g1 | 在跑（progressive/none），2 天后问 | accepted=1, stale=0, hit=true | [ ] 合理 [ ] 疑问：____ |
| ts-g2 | 大学生→研究生（冲突） | accepted=2, stale_marked=1, hit=true | [ ] 合理 [ ] 疑问：____ |
| ts-g3 | 迭代 3/1–3/10，问于 1/5（未开始） | accepted=1, stale=0, hit=false | [ ] 合理 [ ] 疑问：____ |
| ts-g4 | 在跑，19 天后问（>7 天 TTL） | accepted=1, stale=0, hit=false | [ ] 合理 [ ] 疑问：____ |
| ts-g5 | 联调已完成（perfect/point），30 天后问 | accepted=1, stale=0, hit=true | [ ] 合理 [ ] 疑问：____ |

### 3.2 longmemeval（`eval/adapters/golden/longmemeval.jsonl`）

| id | 场景摘要 | expected | 人工结论 |
|---|---|---|---|
| lme-g1 | moved to Berlin（perfect/point） | accepted=1, stale=0, hit=true | [ ] 合理 [ ] 疑问：____ |
| lme-g2 | Pixel 8→Pixel 9（冲突） | accepted=2, stale_marked=1, hit=true | [ ] 合理 [ ] 疑问：____ |
| lme-g3 | migration running，31 天后问 | accepted=1, stale=0, hit=false | [ ] 合理 [ ] 疑问：____ |
| lme-g4 | review starts 3/1，问于 1/15（未开始） | accepted=1, stale=0, hit=false | [ ] 合理 [ ] 疑问：____ |
| lme-g5 | standing desk（perfect/point） | accepted=1, stale=0, hit=true | [ ] 合理 [ ] 疑问：____ |

### 3.3 locomo（`eval/adapters/golden/locomo.jsonl`）

| id | 场景摘要 | expected | 人工结论 |
|---|---|---|---|
| loco-g1 | cat Miso（perfect/point） | accepted=1, stale=0, hit=true | [ ] 合理 [ ] 疑问：____ |
| loco-g2 | teacher→nurse（冲突） | accepted=2, stale_marked=1, hit=true | [ ] 合理 [ ] 疑问：____ |
| loco-g3 | learning to paint，54 天后问 | accepted=1, stale=0, hit=false | [ ] 合理 [ ] 疑问：____ |
| loco-g4 | Kyoto trip planned 10 月，问于 6/1（未开始） | accepted=1, stale=0, hit=false | [ ] 合理 [ ] 疑问：____ |
| loco-g5 | green tea（perfect/point） | accepted=1, stale=0, hit=true | [ ] 合理 [ ] 疑问：____ |

- [ ] 15/15 全部确认合理（签核）
- 有疑问条目：____ · 执行人/日期：________

## 4. gate-eval κ/AC1（第二标注者）

- 条目：`eval/gate-eval/items.jsonl`（400 条，字段 `{id, lang, text, gold_aspect, gold_anchor_type, hard}`）。
- 标注口径：`eval/gate-eval/SPEC.md` §2（第 15–26 行）——只看句子构造判定 aspect/anchor，不参考 gold。
- 抽样（确定性，冻结）：取 items.jsonl 第 1,11,21,…,391 行（每 10 行取 1 行），共 40 条（zh 20 / en 20）；
  统计 `hard=true` 条数，若 <4 条则从同语言 `hard=true` 项就近替换并记录替换清单。
- 流程：
  1. 第二标注者**独立**标 aspect + anchor（不先看 rules 输出）；
  2. 取 rules 预测（仓库根目录运行，输出全部 400 条，按抽样行号取 40 条）：
     ```
     node --input-type=module -e "import {evaluateRules,loadItems} from './eval/gate-eval/label.mjs'; for (const r of evaluateRules(loadItems()).rows) console.log(r.id, r.lang, r.pred_aspect, r.pred_anchor, '| gold', r.gold_aspect, r.gold_anchor_type, r.hard)"
     ```
  3. 计算 aspect/anchor/joint 一致率 + Cohen's κ + AC1（Gwet），写入 `eval/gate-eval/report/report.md` 附录，
     并在 `eval/DECISIONS.md` Changelog 登记（含标注者、日期、抽样行号）。
- 背景：A/B 终审已维持方案 A（rules aspect 90.0% ≥ 80%，`report.md` 第 4 行）；LLM 臂 anchor 76.0% 低于 rules 90.0%，仅报告项。κ/AC1 不改变 A/B 决定，只补报告附录。
- [ ] 已完成：标注者 ________ 日期 ________ · aspect 一致率 ____ / κ ____ / AC1 ____
- 附录位置：`eval/gate-eval/report/report.md`（当前 `report.json → inter_annotator` 为「未采集」）

## 5. G0 风险签字（计划 §9 G0）

- 阅读材料：
  - 风险登记 R1–R18：计划 `plans/2026-10-01_180525-foresight-eval-plan-v3.1.md` §11 第 613–632 行（适配层工期/成本/judge 可靠性/效果不显著/分类器误差/许可/时间挤压/依赖漂移/LME 污染/写入接受率/未然体验证/C-extension 超期/stale_gt 不可靠/seed 等）；
  - 既有偏离：`eval/DECISIONS.md` Deviations 第 316–328 行（judge 同源兜底、tokenizer `estimate@v1`、D17 tool_retrieval 预算口径、gate-eval 第二标注者待补）；
  - Changelog v1.15（真实 smoke 0.80、成本对账 0.0%、LLM 对照臂）。
- 确认内容：接受上述 18 项风险与 4 项既有偏离进入主实验；接受 judge 同源兜底的补偿安排（G1 人审 ≥40 条 = 本文件 §2B + P2.4 ≥120 条双盲 + C-extension 双 judge）。
- [ ] 已逐条阅读并接受（例外项：________）
- 签字/日期：________

---
签核方式：在本文件对应行改 ✅ 并署名/日期，提交 git；随后 STATUS 将 G1 置为 ✅，启动 P2。
