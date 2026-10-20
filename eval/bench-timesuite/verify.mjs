#!/usr/bin/env node
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ITEMS = path.join(HERE, 'items.jsonl')
const CLASSES = ['completion', 'clock_jump', 'fallback', 'redundancy', 'prospective', 'renewal']
const EXPECT_KEYS = new Set([
  'injected_aspects',
  'absent_aspects',
  'completed_at',
  'rendered_contains',
  'aspect',
  'retrievable',
  'active_total',
  'activated_at',
  'overdue_since',
  'renewed_at',
])

const isoOk = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v))
const errors = []
const items = fs
  .readFileSync(ITEMS, 'utf8')
  .split(/\r?\n/)
  .filter(Boolean)
  .map((l, i) => {
    try {
      return JSON.parse(l)
    } catch (e) {
      errors.push(`line ${i + 1}: JSON 解析失败 ${e.message}`)
      return null
    }
  })
  .filter(Boolean)

const ids = new Set()
for (const it of items) {
  const at = (m) => errors.push(`${it?.id ?? '?'}: ${m}`)
  if (!it.id || ids.has(it.id)) at('id 缺失或重复')
  ids.add(it.id)
  if (!CLASSES.includes(it.class)) at(`未知 class ${it.class}`)
  if (it.class === 'completion' || it.class === 'clock_jump' || it.class === 'prospective') {
    if (!Array.isArray(it.sessions) || it.sessions.length === 0) at('sessions 缺失')
    for (const s of it.sessions ?? []) {
      for (const t of s.turns ?? []) {
        if (!['user', 'assistant'].includes(t.role)) at('turn.role 非法')
        if (typeof t.text !== 'string' || !t.text) at('turn.text 缺失')
        if (!isoOk(t.at)) at('turn.at 非 ISO')
        for (const f of t.facts ?? []) {
          if (!f.text || !f.aspect) at('fact 缺 text/aspect')
          if (!f.anchor || !f.anchor.type) at('fact 缺 anchor.type')
        }
      }
    }
    if (it.class === 'clock_jump') {
      if (!it.on_time_probe || !isoOk(it.on_time_probe.at)) at('on_time_probe 缺失')
      if (!isoOk(it.on_time_probe?.expect?.completed_at)) at('on_time_probe.completed_at 非 ISO')
    }
  }
  if (it.class === 'fallback' || it.class === 'redundancy' || it.class === 'renewal') {
    if (!Array.isArray(it.writes) || it.writes.length === 0) at('writes 缺失')
    let last = -Infinity
    for (const w of it.writes ?? []) {
      if (!isoOk(w.at)) at('write.at 非 ISO')
      else if (Date.parse(w.at) < last) at('write 时间非单调')
      else last = Date.parse(w.at)
      if (typeof w.text !== 'string' || !w.text) at('write.text 缺失')
      if (it.class === 'fallback' && w.classify !== null) at('fallback.write.classify 必须为 null')
      if ((it.class === 'redundancy' || it.class === 'renewal') && (!w.classify || !w.classify.aspect)) at(`${it.class}.write.classify 缺失`)
    }
    if (it.class === 'fallback') {
      if (!isoOk(it.promotion?.at) || !it.promotion?.target) at('promotion 缺失')
    }
  }
  if (!Array.isArray(it.probes) || it.probes.length === 0) at('probes 缺失')
  for (const p of it.probes ?? []) {
    if (typeof p.q !== 'string' || !p.q) at('probe.q 缺失')
    if (!isoOk(p.at)) at('probe.at 非 ISO')
    const keys = Object.keys(p.expect ?? {})
    if (keys.length === 0 || !keys.every((k) => EXPECT_KEYS.has(k))) at(`probe.expect 非法: ${keys.join(',')}`)
    if ('completed_at' in (p.expect ?? {}) && p.expect.completed_at !== null && !isoOk(p.expect.completed_at)) at('expect.completed_at 非 ISO')
  }
}

for (const cls of CLASSES) {
  const n = items.filter((i) => i.class === cls).length
  if (n !== 15) errors.push(`class ${cls} 数量 ${n} ≠ 15`)
}
if (items.length !== 90) errors.push(`总题数 ${items.length} ≠ 90`)

if (errors.length > 0) {
  console.error(`✘ bench-timesuite verify: ${errors.length} 个问题`)
  for (const e of errors.slice(0, 20)) console.error(`  - ${e}`)
  process.exitCode = 1
} else {
  console.log(`✔ bench-timesuite verify: ${items.length} 题全部通过（6 类 × 15）`)
}
