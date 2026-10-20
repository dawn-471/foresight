#!/usr/bin/env node
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { LlmClient } from '../eval/lib/llm.mjs'
import { loadTraces } from '../eval/lib/trace.mjs'
import { evaluateRules, loadItems } from '../eval/gate-eval/label.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const OUT = path.join(ROOT, 'eval', 'results', 'G1_PRESCREEN.md')

const client = new LlmClient({
  baseUrl: process.env.EVAL_JUDGE_BASE_URL,
  apiKey: process.env.EVAL_JUDGE_API_KEY,
  model: process.env.EVAL_JUDGE_MODEL ?? 'gpt-6.1-sol',
  timeoutMs: Number(process.env.EVAL_JUDGE_TIMEOUT_MS ?? 300000),
})

async function ask(system, user) {
  const r = await client.call({ system, user, json: true, maxTokens: 2048 })
  return { json: r.json, usage: r.usage }
}

function goldOf(key) {
  const m = key.match(/^smoke-(ttl-active|point-active|interval-active|update|multisession|final)-(\d+)$/)
  if (!m) return null
  const [, kind, n] = m
  if (kind === 'ttl-active') return `训练任务 ${n} 在跑`
  if (kind === 'point-active') return '报告撰写进行中'
  if (kind === 'interval-active') return `评审 ${n} 进行中`
  if (kind === 'update') return '研究生'
  if (kind === 'multisession') return '接口联调已完成'
  if (kind === 'final') return '缓存服务在跑'
  return null
}

function pairKey(t) {
  const id = String(t.item_id ?? '')
  const prefix = `${t.system}-`
  return id.startsWith(prefix) ? id.slice(prefix.length) : id
}

function listOf(json, key) {
  if (Array.isArray(json)) return json
  return json?.[key] ?? []
}

function kappa(a, b) {
  const n = a.length
  const cats = [...new Set([...a, ...b])]
  const po = a.filter((x, i) => x === b[i]).length / n
  const pe = cats.reduce((s, c) => s + (a.filter((x) => x === c).length / n) * (b.filter((x) => x === c).length / n), 0)
  return pe === 1 ? 1 : (po - pe) / (1 - pe)
}

const traces = loadTraces(path.join(ROOT, 'eval/results/smoke/traces.jsonl'))
const judged = traces.filter((t) => t.judge)
const byItem = new Map(judged.map((t) => [t.item_id, t]))

const sampleIds = []
const sampleMd = fs.readFileSync(path.join(ROOT, 'eval/results/smoke/review_sample.md'), 'utf8')
for (const line of sampleMd.split(/\r?\n/)) {
  const m = line.match(/^\|\s*\w+\s*\|\s*([\w-]+)\s*\|/)
  if (m && m[1] !== 'item') sampleIds.push(m[1])
}
const tenRows = sampleIds.map((id) => {
  const t = byItem.get(id)
  return { id, query: t.query, gold: goldOf(pairKey(t)), answer: t.answer, judge_label: t.judge.label }
})

const sorted = [...judged].sort((a, b) => a.item_id.localeCompare(b.item_id))
const forty = []
for (let i = 0; i < 40; i++) {
  const t = sorted[Math.round((i * (sorted.length - 1)) / 39)]
  forty.push({ id: t.item_id, query: t.query, gold: goldOf(pairKey(t)), answer: t.answer, judge_label: t.judge.label })
}

const golden = []
for (const bench of ['timesuite', 'longmemeval', 'locomo']) {
  const lines = fs.readFileSync(path.join(ROOT, `eval/adapters/golden/${bench}.jsonl`), 'utf8').split(/\r?\n/).filter(Boolean)
  for (const line of lines) {
    const it = JSON.parse(line)
    const facts = it.sessions.flatMap((s) => s.turns.flatMap((t) => (t.facts ?? []).map((f) => `${f.text} [${f.aspect}/${f.anchor?.type}${f.anchor?.start ? ` ${f.anchor.start}` : ''}${f.anchor?.end ? `..${f.anchor.end}` : ''}]`)))
    golden.push({
      id: `${bench}/${it.id}`,
      facts,
      question: it.question,
      question_date: it.question_date,
      stale: it.stale ?? [],
      expected: it.expected,
    })
  }
}

const gateItems = loadItems()
const gateSampleIdx = []
for (let i = 1; i <= 391; i += 10) gateSampleIdx.push(i - 1)
const gateSample = gateSampleIdx.map((i) => gateItems[i])
const rulesRows = evaluateRules(gateItems).rows
const rulesById = new Map(rulesRows.map((r) => [r.id, r]))

const usage = []
const report = ['# G1 机器预审报告（gpt-6.1-sol，非人工）', '', `- 生成时间：${new Date().toISOString()}`, `- 模型：${client.model}（经 codex 中转 shim）`, '']

const labelCheck = async (rows, title) => {
  const sys = '你是严格的答案判定器。对每条数据判断「答案」与「标准答案」是否表达同一当前事实，只输出 JSON。'
  const user = JSON.stringify({
    task: '输出 {"labels":[{"id":"...","label":"correct"|"incorrect"}]}，逐条对应输入。',
    rows: rows.map((r) => ({ id: r.id, question: r.query, answer: r.answer, gold: r.gold })),
  })
  const { json, usage: u } = await ask(sys, user)
  usage.push({ call: title, usage: u })
  const labels = new Map(listOf(json, 'labels').map((l) => [String(l.id), l.label]))
  const agree = rows.filter((r) => labels.get(r.id) === r.judge_label).length
  const dis = rows.filter((r) => labels.get(r.id) !== r.judge_label)
  report.push(`## ${title}`, '', `- n=${rows.length} · 与 judge 标签一致 ${agree}/${rows.length}${dis.length ? ` · 分歧：${dis.map((d) => `${d.id}(judge=${d.judge_label}, prescreen=${labels.get(d.id)})`).join('; ')}` : ''}`, '')
  return { agree, total: rows.length, dis }
}

const ten = await labelCheck(tenRows, '§2 十条抽查（同模型一致性，非独立）')
const fortyCheck = await labelCheck(forty, '§2B 40 条 judge 人审样本（同模型一致性，非独立）')

const goldenSys = '你是评估数据审计员。给定每条黄金样例的事实、提问日、问题与 expected 断言，以及规则（progressive 默认 TTL=7 天；perfect 永不过期；question_date 早于 interval start 视为未开始不注入；冲突时旧值应标 stale_marked=1；probe_hit 表示该题是否有注入），判断 expected 是否与场景自洽。只输出 JSON。'
const goldenUser = JSON.stringify({
  task: '输出 {"results":[{"id":"...","verdict":"pass"|"fail","reason":"..."}]}。',
  rules: 'progressive 默认 TTL=7 天；perfect 永不过期；未开始不注入；冲突旧值 stale_marked=1；accepted=写入条数；probe_hit=是否有注入',
  items: golden,
})
const goldenRes = await ask(goldenSys, goldenUser)
usage.push({ call: '§3 golden 15', usage: goldenRes.usage })
const goldenMap = new Map(listOf(goldenRes.json, 'results').map((r) => [String(r.id), r]))
const goldenFail = golden.filter((g) => goldenMap.get(g.id)?.verdict !== 'pass')
report.push('## §3 golden 15 条（独立语义审计）', '', `- pass ${golden.length - goldenFail.length}/${golden.length}${goldenFail.length ? ` · 疑问：${goldenFail.map((g) => `${g.id}(${goldenMap.get(g.id)?.reason ?? 'no reason'})`).join('; ')}` : ''}`, '')

const gateSys = '你是时相分类器。对每条文本判断 aspect（progressive|perfect|prospective|gnomic）与 anchor 类型（none|point|interval|open），只输出 JSON。'
const gateUser = JSON.stringify({
  task: '输出 {"labels":[{"id":"...","aspect":"...","anchor":"..."}]}。',
  items: gateSample.map((it) => ({ id: it.id, lang: it.lang, text: it.text })),
})
const gateRes = await ask(gateSys, gateUser)
usage.push({ call: '§4 gate 40 条第二标注', usage: gateRes.usage })
const gateMap = new Map(listOf(gateRes.json, 'labels').map((l) => [String(l.id), l]))
const gateRows = gateSample.map((it) => {
  const r = rulesById.get(it.id)
  const m = gateMap.get(it.id)
  return { id: it.id, goldA: it.gold_aspect, goldN: it.gold_anchor_type, rulesA: r.pred_aspect, rulesN: r.pred_anchor, modelA: m?.aspect ?? null, modelN: m?.anchor ?? null }
})
const acc = (f) => (gateRows.filter(f).length / gateRows.length * 100).toFixed(1)
const aspectKappa = kappa(gateRows.map((r) => r.modelA ?? 'null'), gateRows.map((r) => r.rulesA ?? 'null'))
const anchorKappa = kappa(gateRows.map((r) => r.modelN ?? 'null'), gateRows.map((r) => r.rulesN ?? 'null'))
report.push(
  '## §4 gate-eval 40 条抽样（模型 vs rules vs gold）', '',
  `- 模型 aspect 准确率 ${acc((r) => r.modelA === r.goldA)}% · anchor ${acc((r) => r.modelN === r.goldN)}%`,
  `- rules aspect 准确率 ${acc((r) => r.rulesA === r.goldA)}% · anchor ${acc((r) => r.rulesN === r.goldN)}%`,
  `- 模型×rules 一致率 aspect ${acc((r) => r.modelA === r.rulesA)}%（κ=${aspectKappa.toFixed(3)}）· anchor ${acc((r) => r.modelN === r.rulesN)}%（κ=${anchorKappa.toFixed(3)}）`,
  '',
)

report.push('## §1 / §5', '', '- §1 stale_gt 抽检：需公开基准注入记录（P2.1 产出后）；本轮无法预审。', '- §5 G0 风险签字：属作者接受行为，无法由模型代签。', '', '## 用量', '')
for (const u of usage) report.push(`- ${u.call}: calls=${client.usage.calls} tokens in=${u.usage?.prompt_tokens ?? 0} out=${u.usage?.completion_tokens ?? 0}`)

fs.writeFileSync(OUT, report.join('\n') + '\n')
console.log(`✔ prescreen → ${OUT}`)
console.log(`  §2 一致 ${ten.agree}/${ten.total} · §2B 一致 ${fortyCheck.agree}/${fortyCheck.total} · §3 pass ${golden.length - goldenFail.length}/${golden.length} · §4 κ aspect ${aspectKappa.toFixed(3)} / anchor ${anchorKappa.toFixed(3)}`)
