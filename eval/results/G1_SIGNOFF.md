# G1 人工签字清单（自动项已闭环，2026-10-02）

> 自动项证据：`eval/STATUS.md` G1 行、`eval/results/RUNLOG.md`、`eval/gate-eval/report/report.md`、
> `eval/results/smoke/summary.md`。以下 5 项需要人工确认后才能将 G1 置为 ✅。

## 1. stale_gt 抽检 ≥90%（D14，需 ≥30 条双轮）
- 样本来源：P2.1 pilot 的公开基准 traces（`stale_annotator=rules@v1`）。
- 操作：对每条注入标记 `stale_gt` 双轮抽检；一致率 <90% 触发复核并在 DECISIONS 登记。
- 状态：⬜ 待 P2.1 产出样本后执行。

## 2. 评分抽查 10 条（judge 校准预检）
- 样本：`eval/results/smoke/review_sample.md`（真实 smoke，judge=deepseek-flash 同源兜底）。
- 操作：逐条人工核对 judge 的 correct/incorrect 是否合理，记录分歧。
- 状态：⬜ 待作者核对。

## 3. golden 签核（每基准 5 条）
- 证据：`node eval/adapters/{timesuite,longmemeval,locomo}.mjs --selfcheck` → 各 5/5。
- 操作：人工复核 `eval/adapters/golden/*.jsonl` 的写入条数/aspect/anchor/过期抑制/预算。
- 状态：⬜ 待作者签核（机器核对已通过）。

## 4. gate-eval κ/AC1（第二标注者）
- 证据：`eval/gate-eval/report/report.md`（LLM 臂 aspect 96.5%、rules 90.0%）。
- 操作：人工抽检 ≥40 条（zh/en 各半，含 hard 子集），计算一致率/κ/AC1 写入报告附录。
- 状态：⬜ 待第二标注者。

## 5. G0 风险签字（计划 §9 G0）
- 风险登记见计划 §11（R1–R18）；主实验前确认接受。
- 状态：⬜ 待作者签字。

---
签核方式：在本文件对应行改 ✅ 并署名/日期，提交 git；随后 STATUS 将 G1 置为 ✅，启动 P2。
