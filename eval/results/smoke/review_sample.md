# 人工抽查样本（Task 1.8：judge 校准预检，共 10 条）

> 选题规则：每道有 judge 参评的题取 1 条（优先非「不知道/闭卷」且最长的回答）；gold 答案见 judge 理由。

| system | item | query | answer | judge 标签 | judge 理由 | correct(机器) | 人工判定 |
|---|---|---|---|---|---|---|---|
| fullcontext | fullcontext-smoke-ttl-active-0 | 训练任务状态？ | 训练任务 0 在跑。 | correct | 回答与标准答案一致，均表示训练任务 0 正在运行。 | true | [ ] 一致 [ ] 分歧 |
| summary | summary-smoke-ttl-active-1 | 训练任务状态？ | 训练任务 1 在跑。 | correct | 答案与标准答案一致，均表示训练任务 1 在跑。 | true | [ ] 一致 [ ] 分歧 |
| summary | summary-smoke-ttl-active-2 | 训练任务状态？ | 训练任务 2 在跑。 | correct | 答案与 ground_truth 一致，均表示训练任务 2 正在运行。 | true | [ ] 一致 [ ] 分歧 |
| summary | summary-smoke-point-active-0 | 报告状态？ | 报告撰写进行中。 | correct | 答案与标准答案表达了相同的报告状态。 | true | [ ] 一致 [ ] 分歧 |
| summary | summary-smoke-interval-active-0 | 评审状态？ | 进行中 | correct | 答案“进行中”与 ground_truth 中的评审状态一致。 | true | [ ] 一致 [ ] 分歧 |
| summary | summary-smoke-interval-active-1 | 评审状态？ | 进行中 | correct | 答案“进行中”与标准答案“评审 1 进行中”的状态一致。 | true | [ ] 一致 [ ] 分歧 |
| fullcontext | fullcontext-smoke-update-0 | 用户现在的学历？ | 大学生 | incorrect | 答案为“大学生”，而真实学历是“研究生”，两者不一致。 | false | [ ] 一致 [ ] 分歧 |
| fullcontext | fullcontext-smoke-update-1 | 用户现在的学历？ | 大学生 | incorrect | 答案为“大学生”，而真实学历是“研究生”，两者不一致。 | false | [ ] 一致 [ ] 分歧 |
| fullcontext | fullcontext-smoke-multisession-0 | 接口联调状态？ | 接口联调已完成。 | correct | 答案与ground_truth一致，均表示接口联调已完成。 | true | [ ] 一致 [ ] 分歧 |
| fullcontext | fullcontext-smoke-final-0 | 缓存服务状态？ | 缓存服务正在运行。 | correct | 答案与标准答案表达了缓存服务正在运行这一相同事实。 | true | [ ] 一致 [ ] 分歧 |
