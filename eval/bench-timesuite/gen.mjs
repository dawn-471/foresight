#!/usr/bin/env node
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(HERE, 'items.jsonl')
const DAY = 86_400_000
const BASE = Date.parse('2026-01-01T00:00:00Z')

const iso = (ms) => new Date(ms).toISOString()
const day = (ms) => iso(ms).slice(0, 10)

function completion(i) {
  const start = BASE + i * 3 * DAY
  const end = start + 7 * DAY
  const fact = `任务 ${i} 在 ${day(start)} 到 ${day(end)} 期间进行中`
  return {
    id: `ts-completion-${String(i).padStart(3, '0')}`,
    class: 'completion',
    sessions: [
      {
        session_id: 's1',
        date: day(start),
        turns: [
          {
            role: 'user',
            text: fact,
            at: iso(start),
            facts: [{ text: fact, aspect: 'progressive', anchor: { type: 'interval', start: day(start), end: day(end) } }],
          },
        ],
      },
    ],
    probes: [
      {
        q: `任务 ${i} 状态？`,
        at: iso(start + 3 * DAY),
        expect: { injected_aspects: ['progressive'], absent_aspects: ['perfect'], completed_at: null, rendered_contains: null },
      },
      {
        q: `任务 ${i} 状态？`,
        at: iso(end + 3 * DAY),
        expect: { injected_aspects: ['perfect'], absent_aspects: ['progressive'], completed_at: iso(end), rendered_contains: '已完成' },
      },
    ],
  }
}

function clockJump(i) {
  const item = completion(i)
  const start = BASE + i * 3 * DAY
  const end = start + 7 * DAY
  return {
    id: `ts-clock-jump-${String(i).padStart(3, '0')}`,
    class: 'clock_jump',
    sessions: item.sessions,
    on_time_probe: { at: iso(end + DAY), expect: { completed_at: iso(end) } },
    probes: [
      {
        q: `任务 ${i} 状态？`,
        at: iso(end + (30 + 10 * i) * DAY),
        expect: { injected_aspects: ['perfect'], absent_aspects: ['progressive'], completed_at: iso(end), rendered_contains: '已完成' },
      },
    ],
  }
}

function fallback(i) {
  const t0 = BASE + i * DAY
  const text = `事项 ${i} 的时态无法判定（兜底样例）`
  return {
    id: `ts-fallback-${String(i).padStart(3, '0')}`,
    class: 'fallback',
    writes: [{ at: iso(t0), text, classify: null }],
    promotion: { at: iso(t0 + DAY), target: 'perfect', evidence: `用户确认事项 ${i} 已完成` },
    probes: [
      { q: `事项 ${i}`, at: iso(t0 + 12 * 3_600_000), expect: { aspect: 'uncertain', retrievable: true } },
      { q: `事项 ${i}`, at: iso(t0 + 2 * DAY), expect: { aspect: 'perfect', retrievable: true } },
    ],
  }
}

function redundancy(i) {
  const t0 = BASE + i * 2 * DAY
  const done = t0 + 5 * DAY
  return {
    id: `ts-redundancy-${String(i).padStart(3, '0')}`,
    class: 'redundancy',
    writes: [
      { at: iso(t0), text: `项目 ${i} 在做`, classify: { aspect: 'progressive', anchor: { type: 'none' } } },
      { at: iso(done), text: `项目 ${i} 完成了`, classify: { aspect: 'perfect', anchor: { type: 'point', start: day(done) } } },
    ],
    probes: [
      { q: `项目 ${i} 状态？`, at: iso(t0 + 2 * DAY), expect: { injected_aspects: ['progressive'], absent_aspects: ['perfect'] } },
      { q: `项目 ${i} 状态？`, at: iso(done + DAY), expect: { active_total: 1, injected_aspects: ['perfect'], absent_aspects: ['progressive'] } },
    ],
  }
}

function prospective(i) {
  const t0 = BASE + i * 3 * DAY
  const at = t0 + 2 * DAY
  if (i % 2 === 0) {
    const fact = `迭代 ${i} 从 ${day(at)} 开始`
    return {
      id: `ts-prospective-${String(i).padStart(3, '0')}`,
      class: 'prospective',
      sessions: [
        {
          session_id: 's1',
          date: day(t0),
          turns: [
            {
              role: 'user',
              text: fact,
              at: iso(t0),
              facts: [{ text: fact, aspect: 'prospective', anchor: { type: 'point', start: day(at) }, modality: 'plan' }],
            },
          ],
        },
      ],
      probes: [
        { q: `迭代 ${i}`, at: iso(at - DAY), expect: { injected_aspects: ['prospective'], absent_aspects: ['progressive'] } },
        { q: `迭代 ${i}`, at: iso(at + DAY), expect: { injected_aspects: ['progressive'], activated_at: `${day(at)}T00:00:00.000Z` } },
        { q: `迭代 ${i}`, at: iso(at + 60 * DAY), expect: { injected_aspects: ['progressive'] } },
      ],
    }
  }
  const fact = `稿子 ${i} 将于 ${day(at)} 完成`
  return {
    id: `ts-prospective-${String(i).padStart(3, '0')}`,
    class: 'prospective',
    sessions: [
      {
        session_id: 's1',
        date: day(t0),
        turns: [
          {
            role: 'user',
            text: fact,
            at: iso(t0),
            facts: [{ text: fact, aspect: 'prospective', anchor: { type: 'point', start: day(at) }, modality: 'prediction', predict_by: day(at) }],
          },
        ],
      },
    ],
    probes: [
      { q: `稿子 ${i}`, at: iso(at + DAY), expect: { injected_aspects: ['prospective'], overdue_since: `${day(at)}T00:00:00.000Z` } },
    ],
  }
}

function renewal(i) {
  const t0 = BASE + i * 2 * DAY
  const renewAt = t0 + 5 * DAY
  const doneAt = t0 + 8 * DAY
  return {
    id: `ts-renewal-${String(i).padStart(3, '0')}`,
    class: 'renewal',
    writes: [
      { at: iso(t0), text: `项目 ${i} 在做`, classify: { aspect: 'progressive', anchor: { type: 'none' } } },
      { at: iso(renewAt), text: `项目 ${i} 仍在进行`, classify: { aspect: 'progressive', anchor: { type: 'none' } } },
      { at: iso(doneAt), text: `项目 ${i} 完成了`, classify: { aspect: 'perfect', anchor: { type: 'point', start: day(doneAt) } } },
    ],
    probes: [
      { q: `项目 ${i}`, at: iso(renewAt + 12 * 3_600_000), expect: { injected_aspects: ['progressive'], renewed_at: renewAt } },
      { q: `项目 ${i}`, at: iso(doneAt - 3_600_000), expect: { injected_aspects: ['progressive'], renewed_at: renewAt } },
      { q: `项目 ${i}`, at: iso(doneAt + DAY), expect: { injected_aspects: ['perfect'], absent_aspects: ['progressive'] } },
    ],
  }
}

const items = []
for (let i = 0; i < 15; i++) items.push(completion(i))
for (let i = 0; i < 15; i++) items.push(clockJump(i))
for (let i = 0; i < 15; i++) items.push(fallback(i))
for (let i = 0; i < 15; i++) items.push(redundancy(i))
for (let i = 0; i < 15; i++) items.push(prospective(i))
for (let i = 0; i < 15; i++) items.push(renewal(i))

const lines = items.map((it) => JSON.stringify(it))
fs.writeFileSync(OUT, lines.join('\n') + '\n')
console.log(`✔ bench-timesuite: ${items.length} items → ${OUT}`)
for (const cls of ['completion', 'clock_jump', 'fallback', 'redundancy', 'prospective', 'renewal']) {
  console.log(`  ${cls}: ${items.filter((i) => i.class === cls).length}`)
}
