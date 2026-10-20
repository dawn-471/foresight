# bench-timesuite SPEC（转换引擎六类题型，v1 两波）

> 目标：把 ForeSight 的"时态演化"贡献变成**确定性可判定**的题目（不依赖 judge）。
> 第一波（Changelog v1.23）：**完成归位 / 时钟跳跃（离线一致性）/ 兜底升级 / 降冗余序列**。
> 第二波（Changelog v1.26）：**未然体激活与裁决保持 / 续期**（正交转换模型）。
> 计划中的其余类别（TTL 过期负例、冲突取代、锚渲染、否定抑制、负对照、gnomic 语境）
> 在后续波次补充；编号与目录已预留。

## 1. 判定口径（全部确定性）

| 机制 | 判据 |
|---|---|
| 完成归位 | 窗口结束后：注入条目的 `aspect=perfect`、`metadata.completed_at` = 窗口结束 ISO；渲染含「已完成」；窗口内仍为 `progressive` |
| 时钟跳跃 | 与"按时结算"对比：`completed_at` 必须等于**语义时间**（窗口结束），与多久后才启动无关 |
| 兜底升级 | 分类失败 → `aspect=uncertain` 且可检索；证据到达后 → 升级为 `perfect` 且可检索 |
| 降冗余 | "在做" + "完成了" 序列后：活跃记忆总数 = 1、`aspect=perfect`、无进行中残留；完成前查询看到进行中，完成后看到完成体 |

## 2. 条目 schema（items.jsonl，一行一题）

```jsonc
// 完成归位 / 时钟跳跃：结构化事实 + 多探针
{
  "id": "ts-completion-001",
  "class": "completion",              // completion | clock_jump | fallback | redundancy
  "sessions": [{ "session_id": "s1", "date": "2026-01-01",
    "turns": [{ "role": "user", "text": "...", "at": "2026-01-01T00:00:00Z",
      "facts": [{ "text": "...", "aspect": "progressive",
        "anchor": { "type": "interval", "start": "2026-01-01", "end": "2026-01-08" } }] }] }],
  "probes": [
    { "q": "...", "at": "2026-01-04T00:00:00Z",
      "expect": { "injected_aspects": ["progressive"], "rendered_contains": null,
                  "completed_at": null } },
    { "q": "...", "at": "2026-01-11T00:00:00Z",
      "expect": { "injected_aspects": ["perfect"], "rendered_contains": "已完成",
                  "completed_at": "2026-01-08T00:00:00.000Z" } }
  ]
}

// 时钟跳跃：额外带按时对照
{ "class": "clock_jump", "sessions": [...],
  "on_time_probe": { "at": "2026-01-09T00:00:00Z", "expect": { "completed_at": "2026-01-08T00:00:00.000Z" } },
  "probes": [ { "q": "...", "at": "2027-03-01T00:00:00Z",
    "expect": { "injected_aspects": ["perfect"], "completed_at": "2026-01-08T00:00:00.000Z" } } ] }

// 兜底升级：写入序列 + 升级动作 + 探针
{ "class": "fallback",
  "writes": [{ "at": "2026-01-01T00:00:00Z", "text": "...", "classify": null }],
  "promotion": { "at": "2026-01-02T00:00:00Z", "target": "perfect", "evidence": "用户确认..." },
  "probes": [ { "q": "...", "at": "2026-01-01T12:00:00Z",
      "expect": { "aspect": "uncertain", "retrievable": true } },
    { "q": "...", "at": "2026-01-02T12:00:00Z",
      "expect": { "aspect": "perfect", "retrievable": true } } ] }

// 降冗余：两次写入（同题）+ 探针
{ "class": "redundancy",
  "writes": [
    { "at": "2026-01-01T00:00:00Z", "text": "项目 1 在做",
      "classify": { "aspect": "progressive", "anchor": { "type": "none" } } },
    { "at": "2026-01-06T00:00:00Z", "text": "项目 1 完成了",
      "classify": { "aspect": "perfect", "anchor": { "type": "point", "start": "2026-01-06" } } }
  ],
  "probes": [
    { "q": "项目 1", "at": "2026-01-03T00:00:00Z",
      "expect": { "injected_aspects": ["progressive"], "absent_aspects": ["perfect"] } },
    { "q": "项目 1", "at": "2026-01-07T00:00:00Z",
      "expect": { "active_total": 1, "injected_aspects": ["perfect"], "absent_aspects": ["progressive"] } }
  ] }
```

- 时间戳全部 UTC ISO；`facts` 使用 SPEC §2 的冻结抽取口径（结构化事实直接写入，不走 gate 分类；分类质量另由 gate-eval 评测）。
- `fallback` / `redundancy` 走 gate 写入路径（`classify: null` 触发兜底；`redundancy` 的第二次写入用规则证据层演化既有记忆）。

## 3. 生成规则（gen.mjs，确定性）

- 6 类 × 15 题 = **90 题**；日期参数化（起点 2026-01-01 + i×3 天），无随机。
- 完成归位/时钟跳跃：interval 锚 `[start, start+7d]`；探针在窗口内（start+3d）与窗口后（end+3d / end+30+10i d）。
- 兜底：`classify:null` 文本固定模板；升级目标 `perfect`。
- 降冗余：同题两写（进行体 → 完成体），完成前/后各一探针。
- `gen.mjs` 重复执行必须逐字节一致（`verify.mjs` 可重生成比对）。

## 4. 命令

```bash
node eval/bench-timesuite/gen.mjs        # 生成 items.jsonl（确定性）
node eval/bench-timesuite/verify.mjs     # 静态校验（schema/去重/时间线/可判定）
node eval/bench-timesuite/selfcheck.mjs  # 离线执行：真实 Store/transitions/search（无 LLM）
```

## 5. 指标映射（论文）

| 指标 | 来源 |
|---|---|
| 完成归位率 | completion probes 全通过数 / n |
| 迟到结算一致性 | clock_jump 的 `completed_at` 与按时对照一致数 / n |
| 兜底保留率 / 升级率 | fallback 两阶段探针通过数 / n |
| 降冗余合并率 | redundancy「活跃=1 且无进行中残留」通过数 / n |
| 误归因率（负向） | 完成后查询中仍出现进行体注入的题数 / n |
| 未然体激活正确率 | prospective 计划题：start 后转 progressive 且 `activated_at` = 语义 start |
| 到期保持率 | prospective 预测题：无证据时 aspect 不变且标记 `overdue_since` |
| 续期延窗率 | renewal：续期后原 TTL 点不完成、`renewed_at` 生效 |
