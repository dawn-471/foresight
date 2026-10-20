#!/usr/bin/env node
import * as fs from 'node:fs'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { LlmClient } from './llm.mjs'
import { assertFrozenPrompt, createJudge } from './judge.mjs'
import { loadTokenizer } from './tokens.mjs'
import { validateTraces, writeTraces } from './trace.mjs'
import { STALE_ANNOTATOR_ID, annotateStale } from './stale.mjs'
import { Ledger, guardEstimate } from './budget.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const DAY = 86_400_000
const READER_PROMPT = path.join(ROOT, 'reader', '223c8691-reader-qa.md')
const JUDGE_PROMPT = path.join(ROOT, 'judge', '42d5fff0-judge-correctness.md')
const TEMPLATE = path.join(ROOT, '..', 'templates', 'policy.yaml.example')

function repoCommit() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return 'bench-local'
  }
}

function configHash(policy) {
  return createHash('sha256').update(JSON.stringify(policy)).digest('hex').slice(0, 16)
}

function resolveData(bench, variant) {
  if (bench === 'longmemeval') {
    return path.join(ROOT, 'data', 'longmemeval', variant === 'oracle' ? 'longmemeval_oracle.json' : 'longmemeval_s_cleaned.json')
  }
  if (bench === 'locomo') return path.join(ROOT, 'data', 'locomo', 'locomo10.json')
  return null
}

function usageSnapshot(clients) {
  return clients.map((c) => ({ ...c.usage }))
}

function usageDelta(clients, before) {
  const d = { calls: 0, cached: 0, prompt: 0, completion: 0 }
  clients.forEach((c, i) => {
    d.calls += c.usage.calls - before[i].calls
    d.cached += c.usage.cached - before[i].cached
    d.prompt += c.usage.prompt_tokens - before[i].prompt_tokens
    d.completion += c.usage.completion_tokens - before[i].completion_tokens
  })
  return d
}

async function ingestRaw(store, item, embed) {
  let accepted = 0
  let turns = 0
  for (const s of item.sessions) {
    const texts = s.turns.map((t) => String(t.text ?? '').trim())
    let vectors = null
    try {
      vectors = await embed.embedWithRetry(texts)
    } catch {
      vectors = null
    }
    for (const [i, t] of s.turns.entries()) {
      turns += 1
      const text = texts[i]
      if (!text) continue
      store.insertMemory({
        content: text,
        aspect: 'perfect',
        anchor: { type: 'none' },
        source: 'agent',
        sourceRef: `${t.role}:${s.session_id}`,
        embedding: vectors?.[i] ?? null,
      })
      accepted += 1
    }
  }
  return { accepted, rejected: turns - accepted, turns, acceptanceRate: turns > 0 ? accepted / turns : 0 }
}

export async function runBench(opts) {
  const bench = opts.bench
  const systemName = opts.system
  const budgetTokens = Number(opts['budget-tokens'] ?? 2000)
  const limit = Number(opts.limit ?? 0)
  const seed = Number(opts.seed ?? 0)
  const variant = opts.variant ?? 's'
  const filter = opts.filter ?? null

  const dataFile = resolveData(bench, variant)
  if (!dataFile || !fs.existsSync(dataFile)) throw new Error(`数据文件不存在: ${dataFile}`)
  const out = opts.out

  const { closeDatabase } = await import('../../lib/schema.js')
  const { OllamaEmbedProvider } = await import('../../lib/store/embed.js')
  const { gateWrite } = await import('../../lib/gate/gate.js')
  const { buildClassifyFn } = await import('../../lib/gate/classify.js')
  const { makeIsolatedWorld, ingestTurns } = await import('../adapters/common.mjs')
  const { SYSTEM_FACTORIES } = await import('../systems/index.mjs')
  const { activeMemories } = await import('../systems/common.mjs')

  let items
  if (bench === 'longmemeval') {
    const lme = await import('../adapters/longmemeval.mjs')
    items = lme.load(dataFile, { variant })
  } else if (bench === 'locomo') {
    const locomo = await import('../adapters/locomo.mjs')
    items = locomo.load(dataFile)
  } else {
    throw new Error(`真实 bench 暂不支持: ${bench}`)
  }
  if (filter) items = items.filter((it) => String(it.type ?? it.category ?? '') === String(filter))
  if (limit > 0 && bench === 'locomo') {
    const groups = new Map()
    for (const it of items) {
      const conv = String(it.id).replace(/-q\d+$/, '')
      if (!groups.has(conv)) groups.set(conv, [])
      groups.get(conv).push(it)
    }
    const spread = []
    for (let round = 0; ; round++) {
      let any = false
      for (const list of groups.values()) {
        if (list[round]) {
          spread.push(list[round])
          any = true
        }
      }
      if (!any) break
    }
    items = spread
  }
  if (limit > 0) items = items.slice(0, limit)
  if (items.length === 0) throw new Error(`筛选后无题（bench=${bench} filter=${filter}）`)

  const policyPath = opts.config ?? TEMPLATE
  const embedBaseUrl = process.env.FORESIGHT_EMBED_BASE_URL ?? 'http://127.0.0.1:11434'
  const embedModel = process.env.FORESIGHT_EMBED_MODEL ?? 'nomic-embed-text-v2-moe'
  const embed = new OllamaEmbedProvider({ baseUrl: embedBaseUrl, model: embedModel })
  const { id: tokenizerId, count } = await loadTokenizer()

  const readerClient = new LlmClient({ seed })
  const judgeClient =
    process.env.EVAL_JUDGE_BASE_URL || process.env.EVAL_JUDGE_API_KEY
      ? new LlmClient({
          baseUrl: process.env.EVAL_JUDGE_BASE_URL,
          apiKey: process.env.EVAL_JUDGE_API_KEY,
          seed,
          timeoutMs: Number(process.env.EVAL_JUDGE_TIMEOUT_MS ?? 300000),
        })
      : readerClient
  const judgeModel = process.env.EVAL_JUDGE_MODEL ?? 'deepseek-flash'
  const judge = createJudge({ client: judgeClient, promptFile: JUDGE_PROMPT, model: judgeModel })
  const readerPrompt = assertFrozenPrompt(READER_PROMPT)
  const gateClassifier = opts.gate === 'llm' ? 'llm' : 'rules'
  const gateConcurrency = Math.max(1, Number(process.env.EVAL_GATE_CONCURRENCY ?? 1))
  const classifyClient = gateClassifier === 'llm' ? new LlmClient({ seed }) : null
  const llmClients = [...new Set([readerClient, judgeClient, classifyClient].filter(Boolean))]
  const commit = repoCommit()
  const gateMode = systemName === 'foresight' || systemName === 'nolifecycle'
  const ledger = new Ledger()
  const traces = []
  const ingestStats = {}
  let excluded = 0

  if (opts.estimate) {
    const { estimateCalls } = await import('./cost.mjs')
    const est = estimateCalls({ questions: items.length, judgePerQuestion: 1, runs: 1 })
    console.log(`estimate: ${items.length} 题 × 1 系统 → reader+judge ≈ ${est.total} calls（judge=${est.perRun.judge} reader=${est.perRun.reader}）`)
    return 0
  }
  if (!out) throw new Error('缺少 --out')

  for (const item of items) {
    const firstTurn = item.sessions[0]?.turns?.[0]
    const at = Date.parse(firstTurn?.at ?? `${item.sessions[0]?.date ?? '1970-01-01'}T00:00:00Z`) || 0
    const world = await makeIsolatedWorld({ item, policyTemplatePath: policyPath, at })
    if (gateClassifier === 'llm') world.policy.gate = { ...world.policy.gate, classifier: 'llm' }
    const before = usageSnapshot(llmClients)
    let ingest
    if (gateMode) {
      const { buildEvidenceFn } = await import('../../lib/evolve/transitions.js')
      const evidenceFn = classifyClient ? buildEvidenceFn(world.policy, classifyClient) : undefined
      ingest = await ingestTurns(world.store, world.policy, item, {
        mode: 'gate',
        gateWrite,
        clock: world.clock,
        buildClassifyFn: (policy) => buildClassifyFn(policy, classifyClient),
        embedFn: (t) => embed.embedOne(t).catch(() => null),
        evidenceFn,
        concurrency: gateConcurrency,
      })
      const missing = activeMemories(world.store).filter((m) => !m.embedding)
      if (missing.length > 0) {
        try {
          const vectors = await embed.embedWithRetry(missing.map((m) => m.content))
          missing.forEach((m, i) => world.store.setEmbedding(m.id, vectors[i]))
        } catch {
          /* degrade to no-vector retrieval */
        }
      }
    } else {
      ingest = await ingestRaw(world.store, item, embed)
    }
    ingestStats[item.id] = ingest
    world.clock.set(Date.parse(item.question_date))
    const history = item.sessions.flatMap((s) =>
      s.turns.map((t) => ({ peer: t.role, content: t.text, createdAt: Date.parse(t.at ?? item.question_date) })),
    )
    const reader = async ({ query, injected }) => {
      const mem = injected.length > 0 ? injected.map((i) => `- ${i.content}`).join('\n') : '（无）'
      const r = await readerClient.call({
        system: readerPrompt.content,
        user: `记忆：\n${mem}\n\n问题：${query}`,
        maxTokens: 2048,
        temperature: 0,
        seed,
      })
      return { answer: r.content, calls: 1 }
    }
    const ctx = {
      policy: world.policy,
      store: world.store,
      embed,
      clock: world.clock,
      reader,
      countTokens: count,
      budgetTokens,
      history,
      llm: null,
    }
    let r
    try {
      r = await SYSTEM_FACTORIES[systemName](ctx).query({ query: item.question, now: Date.parse(item.question_date) })
    } catch (e) {
      closeDatabase(world.schema)
      excluded += 1
      fs.appendFileSync(
        `${out}.excluded.jsonl`,
        JSON.stringify({ item_id: item.id, system: systemName, error: e.message, at: new Date().toISOString() }) + '\n',
      )
      console.error(`  ! ${systemName}/${item.id} 排除: ${e.message}`)
      continue
    }
    const staleSet = new Set(annotateStale(item, r.injected).map((m) => m.memory_id))
    const injected = r.injected.map((i) => {
      const m = world.store.getMemory(i.memory_id)
      return {
        memory_id: i.memory_id,
        aspect: m?.aspect ?? 'perfect',
        anchor_type: m?.anchor?.type ?? 'none',
        status: m?.status ?? 'active',
        expires_at_ms: null,
        suppressed_by: null,
        stale_gt: staleSet.has(i.memory_id),
        stale_reason: staleSet.has(i.memory_id) ? 'pre_update_value' : null,
        created_at_ms: m?.createdAt ?? Date.parse(item.question_date),
        age_days: Math.round(((Date.parse(item.question_date) - (m?.createdAt ?? Date.parse(item.question_date))) / DAY) * 10) / 10,
        score: 1,
        tokens: i.tokens,
        included: true,
      }
    })
    let correct = null
    let judgeRec = null
    if (item.answer && item.answer.trim()) {
      const j = await judge.judge({ query: item.question, answer: r.answer, groundTruth: item.answer })
      judgeRec = { judge_id: j.judge_id, model: j.model, prompt_hash: j.prompt_hash, label: j.label, reason: j.reason }
      correct = j.label === 'correct'
    } else {
      correct = r.injected.length === 0
    }
    const delta = usageDelta(llmClients, before)
    traces.push({
      run_id: `bench-${commit}-${systemName}-${item.id}`,
      system: systemName,
      bench,
      variant,
      item_id: `${systemName}-${item.id}`,
      query: item.question,
      query_time_ms: Date.parse(item.question_date),
      channel: r.channel,
      injected,
      candidate_count: injected.length,
      budget_tokens: budgetTokens,
      injected_tokens: r.injected_tokens,
      answer: r.answer,
      correct,
      judge: judgeRec,
      versions: {
        repo_commit: commit,
        policy_version: world.policy.policy_version,
        config_hash: configHash(world.policy),
        node: process.version,
        embed_model: `${embedModel} (Ollama)`,
        llm_model: readerClient.model,
        reader_prompt_hash: readerPrompt.hash.slice(0, 12),
        gate_classifier: gateClassifier,
        tokenizer: tokenizerId,
        seed,
        stale_annotator: STALE_ANNOTATOR_ID,
      },
      cost: { llm_calls: delta.calls, prompt_tokens: delta.prompt, completion_tokens: delta.completion, cny: 0, cache_hit: delta.calls === 0 && delta.cached > 0 },
      timing_ms: { ingest: 0, retrieve: 0, answer: 0 },
    })
    ledger.add(item.id, { cny: 0, calls: delta.calls })
    closeDatabase(world.schema)
    console.log(`  ${systemName}/${item.id} → ${correct === null ? 'n/a' : correct ? 'correct' : 'incorrect'}（注入 ${injected.length}）`)
  }

  writeTraces(out, traces)
  const errors = validateTraces(traces)
  if (errors.length > 0) {
    console.error(`✘ trace 校验失败 (${errors.length}): ${errors[0]}`)
    return 1
  }
  const guard = guardEstimate(ledger.totals())
  const accepted = Object.values(ingestStats).reduce((a, s) => a + s.accepted, 0)
  const turns = Object.values(ingestStats).reduce((a, s) => a + s.turns, 0)
  const judgeUsage = judgeClient !== readerClient ? judgeClient.usage : { calls: 0, cached: 0, prompt_tokens: 0, completion_tokens: 0 }
  const classifyUsage = classifyClient ? classifyClient.usage : null
  const totalCalls = readerClient.usage.calls + judgeUsage.calls + (classifyUsage?.calls ?? 0)
  const totalCached = readerClient.usage.cached + judgeUsage.cached + (classifyUsage?.cached ?? 0)
  const runlog = [
    `## bench-${bench}-${variant}-${systemName} · ${new Date().toISOString().slice(0, 10)}`,
    '',
    `- commit: \`${commit}\` · system=${systemName} · gate=${gateClassifier} · filter=${filter ?? 'none'} · limit=${limit > 0 ? limit : 'all'} · budget=${budgetTokens} · seed=${seed}`,
    `- ${traces.length} traces → ${out}`,
    `- reader calls=${readerClient.usage.calls} cached=${readerClient.usage.cached} prompt=${readerClient.usage.prompt_tokens} completion=${readerClient.usage.completion_tokens}`,
    `- judge calls=${judgeUsage.calls} cached=${judgeUsage.cached} prompt=${judgeUsage.prompt_tokens} completion=${judgeUsage.completion_tokens} · model=${judgeModel}`,
    ...(classifyUsage
      ? [`- classify calls=${classifyUsage.calls} cached=${classifyUsage.cached} prompt=${classifyUsage.prompt_tokens} completion=${classifyUsage.completion_tokens}`]
      : []),
    `- 写入接受率 ${accepted}/${turns} · 排除 ${excluded} 题 · guard=${guard.ok ? 'ok' : guard.violations.join('; ')}`,
    '',
  ].join('\n')
  fs.appendFileSync(path.join(ROOT, 'results', 'RUNLOG.md'), runlog)
  console.log(`✔ bench: ${items.length} 题 × ${systemName} → ${traces.length} traces（排除 ${excluded}）→ ${out}`)
  console.log(`  写入接受率 ${accepted}/${turns} · LLM calls=${totalCalls} cached=${totalCached} · gate=${gateClassifier}`)
  console.log(`  ${ledger.report()} · guard=${guard.ok ? 'ok' : guard.violations.join('; ')}`)
  return 0
}
