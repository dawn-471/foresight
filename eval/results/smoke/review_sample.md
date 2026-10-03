# 人工抽查样本（Task 1.8：judge 校准预检，共 10 条）

> 选题规则：每道有 judge 参评的题取 1 条（优先非「不知道/闭卷」且最长的回答）；gold 答案见 judge 理由。

| system | item | query | answer | judge 标签 | judge 理由 | correct(机器) | 人工判定 |
|---|---|---|---|---|---|---|---|
| fullcontext | fullcontext-smoke-ttl-active-0 | 训练任务状态？ | 训练任务 0 正在运行。 | correct | 答案“训练任务 0 正在运行”与标准答案“训练任务 0 在跑”表达相同的当前事实。 | true | [ ] 一致 [ ] 分歧 |
| summary | summary-smoke-ttl-active-1 | 训练任务状态？ | 训练任务 1 在跑。 | correct | 答案与 ground_truth 表达相同事实，仅标点差异。 | true | [ ] 一致 [ ] 分歧 |
| summary | summary-smoke-ttl-active-2 | 训练任务状态？ | 训练任务 2 正在运行。 | correct | 答案与标准答案均表示训练任务 2 正在运行，含义一致。 | true | [ ] 一致 [ ] 分歧 |
| summary | summary-smoke-point-active-0 | 报告状态？ | 撰写进行中 | correct | Answer '撰写进行中' conveys the same status as ground truth '报告撰写进行中'. | true | [ ] 一致 [ ] 分歧 |
| summary | summary-smoke-interval-active-0 | 评审状态？ | 进行中 | unknown |  | false | [ ] 一致 [ ] 分歧 |
| fullcontext | fullcontext-smoke-interval-active-1 | 评审状态？ | 评审 1 进行中。 | unknown |  | false | [ ] 一致 [ ] 分歧 |
| summary | summary-smoke-update-0 | 用户现在的学历？ | 大学生 | incorrect | 答案称用户是大学生，而事实是研究生，学历不符。 | false | [ ] 一致 [ ] 分歧 |
| summary | summary-smoke-update-1 | 用户现在的学历？ | 大学生 | incorrect | 答案称用户是大学生，而事实是研究生，学历不符。 | false | [ ] 一致 [ ] 分歧 |
| summary | summary-smoke-multisession-0 | 接口联调状态？ | 接口联调已完成。 | correct | 答案与标准答案表达的当前事实完全一致，均为接口联调已完成。 | true | [ ] 一致 [ ] 分歧 |
| summary | summary-smoke-final-0 | 缓存服务状态？ | 缓存服务正在运行。 | correct | “正在运行”与“在跑”表达同一状态。 | true | [ ] 一致 [ ] 分歧 |
