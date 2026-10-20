# RUNLOG

## smoke-offline-1 · 2026-10-01

- commit: `e043d07` · offline stub reader（无 LLM 调用；真实 reader/judge 需 key）
- 20 items × 7 systems = 140 traces · budget=2000 tokens
- cost: calls=0 · ¥0（离线）· tokenizer=estimate@v1 (cl100k_base unavailable)
- trace: eval/results/smoke/traces.jsonl（校验通过）· 主表: eval/results/smoke/summary.md
- ingest 接受: smoke-ttl-active-0:1/1 smoke-ttl-active-1:1/1 smoke-ttl-active-2:1/1 smoke-ttl-expired-0:1/1 smoke-ttl-expired-1:1/1 smoke-ttl-expired-2:1/1 smoke-point-active-0:1/1 smoke-point-expired-0:1/1 smoke-not-started-0:1/1 smoke-not-started-1:1/1 smoke-interval-active-0:1/1 smoke-interval-active-1:1/1 smoke-update-0:2/1 smoke-update-1:2/1 smoke-prediction-0:1/1 smoke-prediction-1:1/1 smoke-control-empty-0:0/1 smoke-gate-reject-0:0/1 smoke-multisession-0:1/2 smoke-final-0:1/1
- mechanism checklist: C1/C2 expired not injected (foresight) vs nolifecycle contrast=PASS · C10 not-started hidden by lifecycle=PASS · C6 budget respected=PASS · C3 f_embed participates in final score=PASS · C5 gate-eval rules aspect ≥80%=PASS · C7 prediction evidence channel wired=PASS · C8 UTC-stable date extraction=PASS

## smoke-real-1 · 2026-10-02

- commit: `14cdd04` · real reader（deepseek-flash, seed=0, temp=0）+ judge（deepseek-flash@42d5fff0dcb3；gpt-4o 不可得 → §4 同源兜底）
- 20 items × 7 systems = 140 traces · budget=2000 tokens
- LLM usage: calls=78 cached=132 prompt=11628 completion=6909 · tokenizer=estimate@v1 (cl100k_base unavailable)
- cost model 对账: est=210 calls vs actual=210（real=78 + cached=132）→ 误差 0.0%
- trace: eval/results/smoke/traces.jsonl（校验通过）· 主表: eval/results/smoke/summary.md
- ingest 接受: smoke-ttl-active-0:1/1 smoke-ttl-active-1:1/1 smoke-ttl-active-2:1/1 smoke-ttl-expired-0:1/1 smoke-ttl-expired-1:1/1 smoke-ttl-expired-2:1/1 smoke-point-active-0:1/1 smoke-point-expired-0:1/1 smoke-not-started-0:1/1 smoke-not-started-1:1/1 smoke-interval-active-0:1/1 smoke-interval-active-1:1/1 smoke-update-0:2/1 smoke-update-1:2/1 smoke-prediction-0:1/1 smoke-prediction-1:1/1 smoke-control-empty-0:0/1 smoke-gate-reject-0:0/1 smoke-multisession-0:1/2 smoke-final-0:1/1
- mechanism checklist: C1/C2 expired not injected (foresight) vs nolifecycle contrast=PASS · C10 not-started hidden by lifecycle=PASS · C6 budget respected=PASS · C3 f_embed participates in final score=PASS · C5 gate-eval rules aspect ≥80%=PASS · C7 prediction evidence channel wired=PASS · C8 UTC-stable date extraction=PASS

## smoke-real-1 · 2026-10-04

- commit: `6afc4e1` · real reader（deepseek-flash, seed=0, temp=0）+ judge（gpt-6.1-sol@42d5fff0dcb3，经 codex 中转 shim）
- 20 items × 7 systems = 140 traces · budget=2000 tokens
- LLM usage: calls=75 cached=135 prompt=270691 completion=5946 · reader 53/87 · judge 22/48 · tokenizer=estimate@v1 (cl100k_base unavailable)
- cost model 对账: est=210 calls vs actual=210（real=75 + cached=135；reader 140 / judge 70）→ 误差 0.0%
- trace: eval/results/smoke/traces.jsonl（校验通过）· 主表: eval/results/smoke/summary.md
- ingest 接受: smoke-ttl-active-0:1/1 smoke-ttl-active-1:1/1 smoke-ttl-active-2:1/1 smoke-ttl-expired-0:1/1 smoke-ttl-expired-1:1/1 smoke-ttl-expired-2:1/1 smoke-point-active-0:1/1 smoke-point-expired-0:1/1 smoke-not-started-0:1/1 smoke-not-started-1:1/1 smoke-interval-active-0:1/1 smoke-interval-active-1:1/1 smoke-update-0:2/1 smoke-update-1:2/1 smoke-prediction-0:1/1 smoke-prediction-1:1/1 smoke-control-empty-0:0/1 smoke-gate-reject-0:0/1 smoke-multisession-0:1/2 smoke-final-0:1/1
- mechanism checklist: C1/C2 expired not injected (foresight) vs nolifecycle contrast=PASS · C10 not-started hidden by lifecycle=PASS · C6 budget respected=PASS · C3 f_embed participates in final score=PASS · C5 gate-eval rules aspect ≥80%=PASS · C7 prediction evidence channel wired=PASS · C8 UTC-stable date extraction=PASS
## bench-longmemeval-s-foresight · 2026-10-04

- commit: `0d20b5b` · system=foresight · filter=knowledge-update · limit=30 · budget=2000 · seed=0
- 30 traces → eval/results/pilot/lme_ku_foresight.jsonl
- reader calls=30 cached=0 prompt=50312 completion=7473
- judge calls=27 cached=3 prompt=327396 completion=1138 · model=gpt-6.1-sol
- 写入接受率 2181/14740 · 排除 0 题 · guard=ok
## bench-locomo-s-foresight · 2026-10-04

- commit: `0d20b5b` · system=foresight · filter=2 · limit=30 · budget=2000 · seed=0
- 30 traces → eval/results/pilot/locomo_cat2_foresight.jsonl
- reader calls=27 cached=3 prompt=23353 completion=5679
- judge calls=27 cached=3 prompt=327372 completion=1723 · model=gpt-6.1-sol
- 写入接受率 2097/17646 · 排除 0 题 · guard=ok
## bench-longmemeval-s-foresight · 2026-10-04

- commit: `0d20b5b` · system=foresight · gate=llm · filter=knowledge-update · limit=1 · budget=2000 · seed=0
- 1 traces → eval/results/pilot/calib_lme_llmgate.jsonl
- reader calls=1 cached=0 prompt=818 completion=55
- judge calls=1 cached=0 prompt=12139 completion=54 · model=gpt-6.1-sol
- classify calls=281 cached=3 prompt=399315 completion=172201
- 写入接受率 156/413 · 排除 0 题 · guard=ok
## bench-longmemeval-s-foresight · 2026-10-04

- commit: `0d20b5b` · system=foresight · gate=llm · filter=knowledge-update · limit=2 · budget=2000 · seed=0
- 2 traces → eval/results/pilot/calib_lme_llmgate2.jsonl
- reader calls=2 cached=0 prompt=1643 completion=146
- judge calls=1 cached=1 prompt=12107 completion=41 · model=gpt-6.1-sol
- classify calls=357 cached=287 prompt=503951 completion=206078
- 写入接受率 315/881 · 排除 0 题 · guard=ok
## bench-longmemeval-s-foresight · 2026-10-04

- commit: `0d20b5b` · system=foresight · gate=llm · filter=knowledge-update · limit=10 · budget=2000 · seed=0
- 10 traces → eval/results/pilot/lme_ku_foresight_llmgate.jsonl
- reader calls=10 cached=0 prompt=8220 completion=2224
- judge calls=7 cached=3 prompt=84872 completion=258 · model=gpt-6.1-sol
- classify calls=3149 cached=655 prompt=4443483 completion=1749532
- 写入接受率 1587/4897 · 排除 0 题 · guard=ok
## bench-longmemeval-oracle-foresight · 2026-10-04

- commit: `0d20b5b` · system=foresight · gate=rules · filter=knowledge-update · limit=1 · budget=2000 · seed=0
- 1 traces → eval/results/pilot/posttransition-test.jsonl
- reader calls=1 cached=0 prompt=347 completion=66
- judge calls=0 cached=1 prompt=0 completion=0 · model=gpt-6.1-sol
- 写入接受率 5/24 · 排除 0 题 · guard=ok
