# G1 机器预审报告（gpt-6.1-sol，非人工）

- 生成时间：2026-10-04T03:44:01.176Z
- 模型：gpt-6.1-sol（经 codex 中转 shim）

## §2 十条抽查（同模型一致性，非独立）

- n=10 · 与 judge 标签一致 8/10 · 分歧：summary-smoke-interval-active-0(judge=correct, prescreen=incorrect); summary-smoke-interval-active-1(judge=correct, prescreen=incorrect)

## §2B 40 条 judge 人审样本（同模型一致性，非独立）

- n=40 · 与 judge 标签一致 40/40

## §3 golden 15 条（独立语义审计）

- pass 15/15

## §4 gate-eval 40 条抽样（模型 vs rules vs gold）

- 模型 aspect 准确率 100.0% · anchor 67.5%
- rules aspect 准确率 90.0% · anchor 90.0%
- 模型×rules 一致率 aspect 90.0%（κ=0.866）· anchor 62.5%（κ=0.487）

## §1 / §5

- §1 stale_gt 抽检：需公开基准注入记录（P2.1 产出后）；本轮无法预审。
- §5 G0 风险签字：属作者接受行为，无法由模型代签。

## 用量

- §2 十条抽查（同模型一致性，非独立）: calls=4 tokens in=12288 out=640
- §2B 40 条 judge 人审样本（同模型一致性，非独立）: calls=4 tokens in=13258 out=672
- §3 golden 15: calls=4 tokens in=13385 out=928
- §4 gate 40 条第二标注: calls=4 tokens in=12821 out=3019
