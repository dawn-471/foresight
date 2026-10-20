#!/usr/bin/env node
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')

const { openDatabase, closeDatabase } = await import('../../lib/schema.js')
const { Store } = await import('../../lib/store.js')
const { ManualClock } = await import('../../lib/clock.js')
const { loadPolicy } = await import('../../lib/policy.js')
const { gateWrite } = await import('../../lib/gate/gate.js')
const { search } = await import('../../lib/retrieve/search.js')
const { applyDueTransitions, promoteUncertain } = await import('../../lib/evolve/transitions.js')
const { FakeEmbedProvider } = await import('../../lib/store/embed.js')
const { ingestTurns } = await import('../adapters/common.mjs')
const { activeMemories } = await import('../systems/common.mjs')

const TEMPLATE = path.join(ROOT, 'templates', 'policy.yaml.example')
const DAY = 86_400_000
const embed = new FakeEmbedProvider(768)
const vec = () => {
  const v = new Float32Array(768)
  v[0] = 1
  return v
}

function makeWorld() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foresight-ts-'))
  fs.copyFileSync(TEMPLATE, path.join(dir, 'policy.yaml'))
  const policy = loadPolicy(path.join(dir, 'policy.yaml'))
  const clock = new ManualClock(0)
  const schema = openDatabase(path.join(dir, 'ts.db'))
  const store = new Store(schema, null, clock)
  return { dir, policy, clock, schema, store }
}

async function probe(store, policy, p) {
  const at = Date.parse(p.at)
  applyDueTransitions(store, policy, at)
  const hits = await search(p.q, store, embed, policy, at, { topK: 10 })
  return { hits, aspects: hits.map((h) => h.aspect) }
}

const items = fs
  .readFileSync(path.join(HERE, 'items.jsonl'), 'utf8')
  .split(/\r?\n/)
  .filter(Boolean)
  .map((l) => JSON.parse(l))

const results = {}
let failures = 0
const fail = (id, msg) => {
  failures += 1
  console.error(`  ✘ ${id}: ${msg}`)
}

async function runCompletion(item, late = false) {
  const w = makeWorld()
  await ingestTurns(w.store, w.policy, item, { mode: 'extract', clock: w.clock })
  for (const p of item.probes) {
    const { hits, aspects } = await probe(w.store, w.policy, p)
    for (const a of p.expect.injected_aspects ?? []) {
      if (!aspects.includes(a)) fail(item.id, `探针 ${p.at} 缺注入 aspect=${a}（实际 ${aspects.join(',') || '空'}）`)
    }
    for (const a of p.expect.absent_aspects ?? []) {
      if (aspects.includes(a)) fail(item.id, `探针 ${p.at} 不应出现 aspect=${a}`)
    }
    if (p.expect.completed_at !== null && p.expect.completed_at !== undefined) {
      const done = w.store.listByAspectStatus('perfect', 'active')[0]
      if (!done || done.metadata.completed_at !== p.expect.completed_at) {
        fail(item.id, `completed_at=${done?.metadata.completed_at ?? 'n/a'} ≠ ${p.expect.completed_at}`)
      }
    }
    if (p.expect.rendered_contains && !hits.some((h) => h.rendered.includes(p.expect.rendered_contains))) {
      fail(item.id, `渲染缺「${p.expect.rendered_contains}」`)
    }
    if (late && p.expect.completed_at) {
      const onTime = makeWorld()
      await ingestTurns(onTime.store, onTime.policy, item, { mode: 'extract', clock: onTime.clock })
      await probe(onTime.store, onTime.policy, { q: p.q, at: item.on_time_probe.at, expect: {} })
      const a = onTime.store.listByAspectStatus('perfect', 'active')[0]?.metadata.completed_at
      const b = w.store.listByAspectStatus('perfect', 'active')[0]?.metadata.completed_at
      if (a !== b) fail(item.id, `迟到结算 ${b} ≠ 按时结算 ${a}`)
      closeDatabase(onTime.schema)
    }
  }
  closeDatabase(w.schema)
}

async function runFallback(item) {
  const w = makeWorld()
  const events = [
    ...item.writes.map((x) => ({ at: Date.parse(x.at), kind: 'write', x })),
    { at: Date.parse(item.promotion.at), kind: 'promote' },
    ...item.probes.map((x) => ({ at: Date.parse(x.at), kind: 'probe', x })),
  ].sort((a, b) => a.at - b.at)
  let memoryId = null
  for (const ev of events) {
    if (ev.kind === 'write') {
      const receipt = await gateWrite(
        { text: ev.x.text, source: 'agent', now: new Date(ev.at) },
        { policy: w.policy, store: w.store, classifyFn: () => null, embedFn: async () => vec(), clock: w.clock },
      )
      if (!receipt.ok || receipt.memory.aspect !== 'uncertain') fail(item.id, '兜底写入未产生 uncertain')
      memoryId = receipt.memory.id
    } else if (ev.kind === 'promote') {
      promoteUncertain(w.store, w.store.getMemory(memoryId), item.promotion.target, ev.at, { evidenceText: item.promotion.evidence })
    } else {
      const { aspects } = await probe(w.store, w.policy, ev.x)
      if (ev.x.expect.aspect && !aspects.includes(ev.x.expect.aspect)) {
        fail(item.id, `探针 ${ev.x.at} 缺 aspect=${ev.x.expect.aspect}（实际 ${aspects.join(',') || '空'}）`)
      }
      if (ev.x.expect.retrievable && aspects.length === 0) fail(item.id, `探针 ${ev.x.at} 不可检索`)
    }
  }
  closeDatabase(w.schema)
}

async function runProspective(item) {
  const w = makeWorld()
  await ingestTurns(w.store, w.policy, item, { mode: 'extract', clock: w.clock })
  for (const p of item.probes) {
    const { aspects } = await probe(w.store, w.policy, p)
    for (const a of p.expect.injected_aspects ?? []) {
      if (!aspects.includes(a)) fail(item.id, `探针 ${p.at} 缺 aspect=${a}（实际 ${aspects.join(',') || '空'}）`)
    }
    for (const a of p.expect.absent_aspects ?? []) {
      if (aspects.includes(a)) fail(item.id, `探针 ${p.at} 不应出现 aspect=${a}`)
    }
    const mem = activeMemories(w.store)[0]
    if (p.expect.activated_at && mem?.metadata.activated_at !== p.expect.activated_at) {
      fail(item.id, `activated_at=${mem?.metadata.activated_at ?? 'n/a'} ≠ ${p.expect.activated_at}`)
    }
    if (p.expect.overdue_since && mem?.metadata.overdue_since !== p.expect.overdue_since) {
      fail(item.id, `overdue_since=${mem?.metadata.overdue_since ?? 'n/a'} ≠ ${p.expect.overdue_since}`)
    }
  }
  closeDatabase(w.schema)
}

async function runRenewal(item) {
  const w = makeWorld()
  const events = [
    ...item.writes.map((x) => ({ at: Date.parse(x.at), kind: 'write', x })),
    ...item.probes.map((x) => ({ at: Date.parse(x.at), kind: 'probe', x })),
  ].sort((a, b) => a.at - b.at)
  let firstId = null
  for (const ev of events) {
    if (ev.kind === 'write') {
      const classify = { ...ev.x.classify, text: ev.x.text, source: 'rules' }
      const receipt = await gateWrite(
        { text: ev.x.text, source: 'agent', now: new Date(ev.at) },
        { policy: w.policy, store: w.store, classifyFn: () => classify, embedFn: async () => vec(), clock: w.clock },
      )
      if (!receipt.ok) fail(item.id, '写入失败')
      if (!firstId) firstId = receipt.memory.id
      else if (receipt.memory.id !== firstId && ev.x.classify.aspect !== 'perfect') {
        fail(item.id, '续期未演化既有记忆')
      }
    } else {
      const { aspects } = await probe(w.store, w.policy, ev.x)
      for (const a of ev.x.expect.injected_aspects ?? []) {
        if (!aspects.includes(a)) fail(item.id, `探针 ${ev.x.at} 缺 aspect=${a}（实际 ${aspects.join(',') || '空'}）`)
      }
      for (const a of ev.x.expect.absent_aspects ?? []) {
        if (aspects.includes(a)) fail(item.id, `探针 ${ev.x.at} 不应出现 aspect=${a}`)
      }
      if (ev.x.expect.renewed_at !== undefined) {
        const mem = w.store.getMemory(firstId)
        if (mem?.metadata.renewed_at !== ev.x.expect.renewed_at) {
          fail(item.id, `renewed_at=${mem?.metadata.renewed_at ?? 'n/a'} ≠ ${ev.x.expect.renewed_at}`)
        }
      }
    }
  }
  closeDatabase(w.schema)
}

async function runRedundancy(item) {
  const w = makeWorld()
  const events = [
    ...item.writes.map((x) => ({ at: Date.parse(x.at), kind: 'write', x })),
    ...item.probes.map((x) => ({ at: Date.parse(x.at), kind: 'probe', x })),
  ].sort((a, b) => a.at - b.at)
  let firstId = null
  for (const ev of events) {
    if (ev.kind === 'write') {
      const classify = { ...ev.x.classify, text: ev.x.text, source: 'rules' }
      const receipt = await gateWrite(
        { text: ev.x.text, source: 'agent', now: new Date(ev.at) },
        { policy: w.policy, store: w.store, classifyFn: () => classify, embedFn: async () => vec(), clock: w.clock },
      )
      if (!receipt.ok) fail(item.id, '写入失败')
      if (!firstId) firstId = receipt.memory.id
      else if (receipt.memory.id !== firstId) fail(item.id, '完成证据未演化既有记忆（新插了条目）')
    } else {
      const { aspects } = await probe(w.store, w.policy, ev.x)
      for (const a of ev.x.expect.injected_aspects ?? []) {
        if (!aspects.includes(a)) fail(item.id, `探针 ${ev.x.at} 缺 aspect=${a}（实际 ${aspects.join(',') || '空'}）`)
      }
      for (const a of ev.x.expect.absent_aspects ?? []) {
        if (aspects.includes(a)) fail(item.id, `探针 ${ev.x.at} 不应出现 aspect=${a}`)
      }
      if (ev.x.expect.active_total !== undefined && activeMemories(w.store).length !== ev.x.expect.active_total) {
        fail(item.id, `活跃记忆 ${activeMemories(w.store).length} ≠ ${ev.x.expect.active_total}`)
      }
    }
  }
  closeDatabase(w.schema)
}

for (const item of items) {
  const before = failures
  if (item.class === 'completion') await runCompletion(item)
  else if (item.class === 'clock_jump') await runCompletion(item, true)
  else if (item.class === 'fallback') await runFallback(item)
  else if (item.class === 'redundancy') await runRedundancy(item)
  else if (item.class === 'prospective') await runProspective(item)
  else if (item.class === 'renewal') await runRenewal(item)
  const cls = (results[item.class] ??= { pass: 0, total: 0 })
  cls.total += 1
  if (failures === before) cls.pass += 1
}

for (const [cls, r] of Object.entries(results)) {
  console.log(`  ${cls.padEnd(12)} ${r.pass}/${r.total}`)
}
if (failures > 0) {
  console.error(`✘ bench-timesuite selfcheck: ${failures} 处断言失败`)
  process.exitCode = 1
} else {
  console.log(`✔ bench-timesuite selfcheck: ${items.length} 题全部通过（离线，真实 Store/transitions/search）`)
}
