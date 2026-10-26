/**
 * Transition engine (2026-10-04): write-time plan, completion归位, catch-up
 * semantic time, uncertain fallback, evidence-driven evolve-on-write.
 * Fictional data only; no external services.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const { openDatabase, closeDatabase } = await import('../lib/schema.js')
const { Store } = await import('../lib/store.js')
const { ManualClock } = await import('../lib/clock.js')
const { loadPolicy } = await import('../lib/policy.js')
const { gateWrite } = await import('../lib/gate/gate.js')
const { search, renderMemory } = await import('../lib/retrieve/search.js')
const { FakeEmbedProvider } = await import('../lib/store/embed.js')
const {
  applyDueTransitions,
  lifecyclePlan,
  promoteUncertain,
  activationTime,
  verdictTime,
  renewMemory,
  cancelMemory,
  rescheduleMemory,
  fulfillProspective,
} = await import('../lib/evolve/transitions.js')

const DAY = 86_400_000

function makePolicy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foresight-tr-policy-'))
  fs.copyFileSync(new URL('../templates/policy.yaml.example', import.meta.url), path.join(dir, 'policy.yaml'))
  return loadPolicy(path.join(dir, 'policy.yaml'))
}

function makeStore(clock) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foresight-tr-'))
  const s = openDatabase(path.join(dir, 't.db'))
  return { s, store: new Store(s, null, clock) }
}

const vec = (i = 0) => {
  const v = new Float32Array(768)
  v[i] = 1
  return v
}

test('transitions: lifecyclePlan records window-end plan at write time', () => {
  const p = makePolicy()
  const clock = new ManualClock(0)
  const { s, store } = makeStore(clock)
  const m = store.insertMemory({ content: '任务在跑', aspect: 'progressive', anchor: { type: 'none' }, source: 'agent' })
  const plan = lifecyclePlan(p, m)
  assert.equal(plan.to, 'perfect')
  assert.equal(plan.reason, 'window_end')
  assert.equal(plan.at, new Date(7 * DAY).toISOString())
  closeDatabase(s)
})

test('transitions: catch-up settles with semantic time (offline gap)', () => {
  const p = makePolicy()
  const clock = new ManualClock(0)
  const { s, store } = makeStore(clock)
  const m = store.insertMemory({ content: '离线前在跑', aspect: 'progressive', anchor: { type: 'none' }, source: 'agent' })
  const swept = applyDueTransitions(store, p, 400 * DAY)
  assert.deepEqual(swept, [m.id])
  const done = store.getMemory(m.id)
  assert.equal(done.aspect, 'perfect')
  assert.equal(done.metadata.completed_at, new Date(7 * DAY).toISOString(), '语义时间 = 窗口结束，而非扫描时刻')
  assert.equal(done.anchor.start, new Date(7 * DAY).toISOString().slice(0, 10))
  const ev = s.db.prepare(`SELECT type FROM events WHERE type='memory.transition'`).all()
  assert.ok(ev.length >= 1, 'memory.transition 事件已审计')
  closeDatabase(s)
})

test('transitions: completed memory stays retrievable and renders as completed', async () => {
  const p = makePolicy()
  const clock = new ManualClock(0)
  const { s, store } = makeStore(clock)
  const m = store.insertMemory({ content: '训练任务在跑', aspect: 'progressive', anchor: { type: 'none' }, source: 'agent' })
  applyDueTransitions(store, p, 8 * DAY)
  const done = store.getMemory(m.id)
  assert.equal(renderMemory(done, p), `已完成（于 ${new Date(7 * DAY).toISOString().slice(0, 10)}）：训练任务在跑`)
  const hits = await search('训练任务', store, new FakeEmbedProvider(768), p, 8 * DAY, { topK: 5 })
  assert.ok(hits.some((h) => h.id === m.id), '完成体可检索（不是隐藏）')
  closeDatabase(s)
})

test('transitions: classify failure falls back to uncertain (no data loss)', async () => {
  const p = makePolicy()
  const clock = new ManualClock(0)
  const { s, store } = makeStore(clock)
  const receipt = await gateWrite(
    { text: '这句话无法判定时态', source: 'agent' },
    {
      policy: p,
      store,
      classifyFn: () => null,
      embedFn: async () => vec(),
      clock,
    },
  )
  assert.equal(receipt.ok, true, '兜底写入不拒收')
  assert.equal(receipt.memory.aspect, 'uncertain')
  assert.equal(receipt.clause, 'gate.2.2')
  const hits = await search('无法判定', store, new FakeEmbedProvider(768), p, 0, { topK: 5 })
  assert.ok(hits.some((h) => h.id === receipt.memory.id), 'uncertain 可检索')
  closeDatabase(s)
})

test('transitions: uncertain can be promoted once evidence arrives', () => {
  const p = makePolicy()
  const clock = new ManualClock(0)
  const { s, store } = makeStore(clock)
  const m = store.insertMemory({ content: '待归类', aspect: 'uncertain', anchor: { type: 'none' }, source: 'agent' })
  const promoted = promoteUncertain(store, m, 'perfect', DAY, { evidenceText: '用户确认已完成' })
  assert.equal(promoted.aspect, 'perfect')
  assert.equal(promoted.metadata.reclassified_to, 'perfect')
  closeDatabase(s)
})

test('transitions: prospective plan activates mechanically at anchor start (end=∞)', () => {
  const p = makePolicy()
  const clock = new ManualClock(0)
  const { s, store } = makeStore(clock)
  const start = '2026-03-01'
  const m = store.insertMemory({
    content: '迭代从 2026-03-01 开始',
    aspect: 'prospective',
    anchor: { type: 'point', start },
    modality: 'plan',
    source: 'agent',
  })
  assert.equal(activationTime(m), Date.parse(start))
  applyDueTransitions(store, p, Date.parse('2026-02-20T00:00:00Z'))
  assert.equal(store.getMemory(m.id).aspect, 'prospective', 'start 前不激活')
  applyDueTransitions(store, p, Date.parse('2026-03-02T00:00:00Z'))
  const active = store.getMemory(m.id)
  assert.equal(active.aspect, 'progressive', 'start 到 → 机械激活')
  assert.equal(active.anchor.type, 'open')
  assert.equal(active.metadata.activated_at, `${start}T00:00:00.000Z`, '语义激活时间 = 锚 start')
  applyDueTransitions(store, p, Date.parse('2027-01-01T00:00:00Z'))
  assert.equal(store.getMemory(m.id).aspect, 'progressive', 'end=∞：无证据不机械完成')
  closeDatabase(s)
})

test('transitions: prediction verdict with no evidence holds (overdue, aspect unchanged)', () => {
  const p = makePolicy()
  p.nudge.auto_resolve_prediction = false
  const clock = new ManualClock(0)
  const { s, store } = makeStore(clock)
  const at = '2026-03-01'
  const m = store.insertMemory({
    content: '报告将在 2026-03-01 完成',
    aspect: 'prospective',
    anchor: { type: 'point', start: at },
    modality: 'prediction',
    source: 'agent',
    metadata: { predict_by: at },
  })
  assert.equal(activationTime(m), null, 'prediction×point 是裁决时刻，不是激活')
  assert.equal(verdictTime(m), Date.parse(at))
  applyDueTransitions(store, p, Date.parse('2026-03-02T00:00:00Z'))
  const after = store.getMemory(m.id)
  assert.equal(after.aspect, 'prospective', '无证据不改变')
  assert.equal(after.metadata.overdue_since, `${at}T00:00:00.000Z`, '标记 overdue')
  assert.equal(after.metadata.overdue_reason, 'deadline_no_evidence')
  closeDatabase(s)
})

test('transitions: renewal evidence extends the window (no aspect change)', () => {
  const p = makePolicy()
  const clock = new ManualClock(0)
  const { s, store } = makeStore(clock)
  const m = store.insertMemory({ content: '任务在跑', aspect: 'progressive', anchor: { type: 'none' }, source: 'agent', createdAt: 0 })
  // renew at day 5 (before expiry): TTL base moves to day 5
  renewMemory(store, p, m, 5 * DAY)
  assert.equal(store.getMemory(m.id).metadata.renewed_at, 5 * DAY)
  applyDueTransitions(store, p, 8 * DAY)
  assert.equal(store.getMemory(m.id).aspect, 'progressive', '续期后原 TTL 点（day 7）不再完成')
  applyDueTransitions(store, p, 13 * DAY)
  assert.equal(store.getMemory(m.id).aspect, 'perfect', '续期窗口结束（day 5+7）后归位')
  closeDatabase(s)
})

test('transitions: evidence can cancel (soft delete) / reschedule / fulfill', () => {
  const p = makePolicy()
  const clock = new ManualClock(0)
  const { s, store } = makeStore(clock)
  const plan = store.insertMemory({ content: '计划三月开始', aspect: 'prospective', anchor: { type: 'point', start: '2026-03-01' }, modality: 'plan', source: 'agent' })
  assert.equal(cancelMemory(store, plan, DAY, '用户不做了'), true)
  assert.equal(store.getMemory(plan.id).status, 'deleted', '取消=软删除（行保留）')

  const plan2 = store.insertMemory({ content: '计划三月开始', aspect: 'prospective', anchor: { type: 'point', start: '2026-03-01' }, modality: 'plan', source: 'agent' })
  rescheduleMemory(store, plan2, { type: 'point', start: '2026-04-01' }, DAY, '改到四月')
  assert.equal(store.getMemory(plan2.id).anchor.start, '2026-04-01')

  const pred = store.insertMemory({ content: '报告将在三月完成', aspect: 'prospective', anchor: { type: 'point', start: '2026-03-01' }, modality: 'prediction', source: 'agent' })
  fulfillProspective(store, pred, 2 * DAY, '已完成')
  assert.equal(store.getMemory(pred.id).aspect, 'perfect')
  assert.equal(store.getMemory(pred.id).metadata.completion_reason, 'fulfilled')
  closeDatabase(s)
})

test('transitions: rules renew only with continuation wording (no data loss)', async () => {
  const p = makePolicy()
  const clock = new ManualClock(0)
  const { s, store } = makeStore(clock)
  const running = store.insertMemory({ content: '项目 B 在做', aspect: 'progressive', anchor: { type: 'none' }, source: 'agent', embedding: vec(0) })
  const mkClassify = (text) => ({ aspect: 'progressive', anchor: { type: 'none' }, text, source: 'rules' })
  const renewed = await gateWrite(
    { text: '项目 B 仍在进行', source: 'agent' },
    { policy: p, store, classifyFn: () => mkClassify('项目 B 仍在进行'), embedFn: async () => vec(0), clock },
  )
  assert.equal(renewed.memory.id, running.id, '续期措辞 → 演化既有')
  assert.equal(renewed.memory.metadata.renewed_at, 0)
  const fresh = await gateWrite(
    { text: '项目 B 在做', source: 'agent' },
    { policy: p, store, classifyFn: () => mkClassify('项目 B 在做'), embedFn: async () => vec(0), clock },
  )
  assert.equal(fresh.memory.id, running.id, '完全相同的正文 → 复用既有（去重），不是静默吞写')
  assert.match(fresh.message, /已存在相同记忆/)
  closeDatabase(s)
})

test('transitions: auto_resolve_prediction skips hold (nudge owns verdict)', () => {
  const p = makePolicy()
  p.nudge = { auto_resolve_prediction: true }
  const clock = new ManualClock(0)
  const { s, store } = makeStore(clock)
  const m = store.insertMemory({
    content: '报告将在 2026-03-01 完成',
    aspect: 'prospective',
    anchor: { type: 'point', start: '2026-03-01' },
    modality: 'prediction',
    source: 'agent',
    metadata: { predict_by: '2026-03-01' },
  })
  applyDueTransitions(store, p, Date.parse('2026-03-02T00:00:00Z'))
  assert.equal(store.getMemory(m.id).metadata.overdue_since, undefined, 'auto_resolve 开启时不标记 overdue')
  closeDatabase(s)
})

test('transitions: open anchor = ∞ (no mechanical expiry; evidence only)', () => {
  const p = makePolicy()
  const clock = new ManualClock(0)
  const { s, store } = makeStore(clock)
  const m = store.insertMemory({ content: '自三月以来持续进行', aspect: 'progressive', anchor: { type: 'open', start: '2026-03-01' }, source: 'agent' })
  applyDueTransitions(store, p, Date.parse('2027-01-01T00:00:00Z'))
  assert.equal(store.getMemory(m.id).aspect, 'progressive', 'open=∞ 不机械完成')
  closeDatabase(s)
})

test('transitions: completion evidence evolves the existing progressive (no duplicate)', async () => {
  const p = makePolicy()
  const clock = new ManualClock(0)
  const { s, store } = makeStore(clock)
  const running = store.insertMemory({
    content: '项目 A 在做',
    aspect: 'progressive',
    anchor: { type: 'none' },
    source: 'agent',
    embedding: vec(0),
  })
  const receipt = await gateWrite(
    { text: '项目 A 完成了', source: 'agent' },
    {
      policy: p,
      store,
      classifyFn: () => ({ aspect: 'perfect', anchor: { type: 'point', start: '1970-01-02' }, text: '项目 A 完成了', source: 'rules' }),
      embedFn: async () => vec(0),
      clock,
    },
  )
  assert.equal(receipt.ok, true)
  assert.equal(receipt.memory.id, running.id, '演化既有记忆，而非新增')
  assert.equal(receipt.memory.aspect, 'perfect')
  assert.equal(store.listByAspectStatus('progressive', 'active').length, 0)
  assert.equal(store.listByAspectStatus('perfect', 'active').length, 1, '无冗余新条目')
  closeDatabase(s)
})
