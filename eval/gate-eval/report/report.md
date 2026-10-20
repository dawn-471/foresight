# ForeSight gate-eval report（C5）

- items: 400（zh 200 / en 200）· hard 140 · now=2026-10-01T00:00:00Z
- rules aspect 准确率: **90.00%**（阈值 80% → PASS（维持方案 A））

## Rules arm
- overall: n=400 aspect=90.00% anchor=92.50% joint=90.00%
- zh: n=200 aspect=90.00% anchor=95.00% joint=90.00%
- en: n=200 aspect=90.00% anchor=90.00% joint=90.00%
- hard: n=140 aspect=71.43% anchor=78.57% joint=71.43%

### aspect confusion (gold→pred)

```
{
  "progressive→progressive": 100,
  "perfect→perfect": 100,
  "prospective→prospective": 100,
  "gnomic→gnomic": 60,
  "gnomic→prospective": 20,
  "prospective→gnomic": 10,
  "progressive→prospective": 10
}
```
### anchor confusion (gold→pred)

```
{
  "none→none": 150,
  "interval→interval": 50,
  "open→open": 20,
  "point→point": 150,
  "open→none": 10,
  "none→open": 20
}
```

## LLM arm
- overall: n=400 aspect=97.25% anchor=79.75% joint=77.00%
- zh: n=200 aspect=97.50% anchor=79.00% joint=76.50%
- en: n=200 aspect=97.00% anchor=80.50% joint=77.50%

## 与第二标注者一致性（κ/AC1）
- 未采集第二标注者（R14 计划：G1 前人工抽检 40 条；κ/AC1 待补）
