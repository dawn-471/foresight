# ForeSight eval summary

| system | n | accuracy | SIR-i | SIR | tokens mean | tokens p95 | calls |
|---|---|---|---|---|---|---|---|
| closedbook | 20 | 0.5000 | n/a | 0.0000 | 0.0 | 0 | 21 |
| summary | 20 | 0.3000 | 0.1000 | 0.1000 | 10.6 | 18 | 28 |
| fullcontext | 20 | 0.3000 | 0.0952 | 0.1000 | 10.6 | 18 | 23 |
| rag | 20 | 0.5000 | n/a | 0.0000 | 0.0 | 0 | 0 |
| recency | 20 | 0.4000 | 0.1000 | 0.1000 | 8.3 | 16 | 4 |
| nolifecycle | 20 | 0.5000 | 0.1000 | 0.1000 | 10.9 | 22 | 2 |
| foresight | 20 | 0.8000 | 0.1429 | 0.1000 | 8.0 | 22 | 0 |

## Pair foresight vs nolifecycle（paired n=20）

- McNemar: a_only=6, b_only=0, both=10/4, p=0.0313
- accuracy diff (a−b): 0.3000  95% CI [0.1000, 0.5000]
- SIR-i diff (a−b): 0.0000  95% CI [0.0000, 0.0000]

## Pair foresight vs recency（paired n=20）

- McNemar: a_only=8, b_only=0, both=8/4, p=0.0078
- accuracy diff (a−b): 0.4000  95% CI [0.2000, 0.6000]
- SIR-i diff (a−b): 0.0000  95% CI [0.0000, 0.0000]
