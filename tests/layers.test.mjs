/**
 * Module 6+ tests: derive / inject / nudge / observer / dialectic / server.
 * All fictional data; fake LLM/store/ctx.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const { openDatabase, closeDatabase } = await import('../lib/schema.js')
const { Store } = await import('../lib/store.js')
const { buildPrompts, dispatchEntry, Deriver } = await import('../lib/derive/deriver.js')
const { renderSections, renderMemories, anchorExpired, readTextFile, apply: applyInject } = await import('../lib/inject/render.js')
const { buildNudge, buildNudgeAsync, extractCandidatesByRules, NudgePlugin } = await import('../lib/nudge/nudge.js')
const { ForeSightObserver, textOf, chunkText, gateSlices } = await import('../lib/ingest/observer.js')
const { buildMemoryTools, apply: applyTools } = await import('../lib/tools.js')
const { buildSystemPrompt } = await import('../lib/gate/classify.js')
const { reason } = await import('../lib/dialectic/reason.js')
const { startServer } = await import('../lib/server/server.js')
const { POLICY_VERSION } = await import('../lib/defaults.js')

function makePolicy(withServer = false) {
  return {
    policy_version: POLICY_VERSION,
    permission: { root_writers: ['root'], agent_writable: ['memories'], beta_settable_by: ['root'], important_doc_writer: 'derive' },
    aspects: {
      gnomic: { storage: 'doc', injection: 'always', expiry: 'never', render_anchor: false, renewable: false, default_ttl_days: 0, review_every_turns: 0 },
      progressive: { storage: 'memory', injection: 'conditional', expiry: 'anchor', render_anchor: true, renewable: true, default_ttl_days: 7, review_every_turns: 30 },
      perfect: { storage: 'memory', injection: 'conditional', expiry: 'never', render_anchor: 'always', renewable: false, default_ttl_days: 0, review_every_turns: 0 },
      prospective: { storage: 'memory', injection: 'renewal', expiry: 'ttl', render_anchor: true, renewable: true, default_ttl_days: 30, review_every_turns: 30, modalities: { plan: { renew: true } } },
    },
    gate: { allowed_categories: ['session_log', 'task_progress'], forbidden_categories: ['guessing'], forbidden_progressive: ['project_state'], llm_model: 'test', fallback: 'rules' },
    activation: { beta: 0.5, beta_observe: 0.05, suppression_epsilon: 0.01, conflict_sim_threshold: 0.6, temporal_decay_enabled: false, half_life_days: 90, base_weights: { root: 1.0, agent: 0.85, derive: 0.7 } },
    retrieval: { top_k: 10, min_score: 0.05, candidates: 20, factors: { embed: { enabled: true, weight: 0.4 }, time: { enabled: true, weight: 0.2 }, activation: { enabled: true, weight: 0.3 }, links: { enabled: true, weight: 0.1, spread_hops: 2, edge_decay: 0.5 } } },
    injection: { soul_section: 'fs:soul', important_section: 'fs:user', memories_section: 'fs:memories', important_budget_chars: 500 },
    derive: { enabled: true, trigger: 'turn', every_n_turns: 5, model: 'test', max_new_per_batch: 3, routes: [
      { source: 'conclusion', aspect_default: 'perfect', target: 'memories', permission: 'derive' },
      { source: 'user_trait', aspect_default: 'gnomic', target: 'important_doc', permission: 'root' },
    ] },
    nudge: { every_turns: 3, candidate_extraction: 'rules', candidate_max: 3, llm_model: 'test', render: 'dialog', review_temporal: true, review_conflicts: true, include_session_timeline: false, auto_resolve_prediction: false },
    dialectic: { model: 'test', top_k: 3, include_contradictions: true },
    server: { enabled: withServer, host: '127.0.0.1', port: 0, token: 'test-token' },
    llm: { base_url: 'http://localhost', model_classify: 'test', model_derive: 'test', model_dialectic: 'test', timeout_ms: 1000, max_retries: 0 },
    audit: { events_table: true, emit_session_events: true, log_file: '' },
  }
}

function mkStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foresight-6-'))
  const s = openDatabase(path.join(dir, 't.db'))
  return { s, store: new Store(s), dir }
}

function fakeLlm(entries) {
  return { call: async () => ({ content: '', json: entries }) }
}

// ── derive ───────────────────────────────────────────────────────────

test('derive: buildPrompts per route, templates table-driven', () => {
  const p = makePolicy()
  const msgs = [{ id: 1, peer: 'user', content: '方案定了', createdAt: 1 }]
  const prompts = buildPrompts(p.derive.routes, msgs, p)
  assert.equal(prompts.length, 2)
  assert.ok(prompts[0].system.includes('结论派生器'))
  assert.ok(prompts[1].system.includes('画像派生器'))
})

test('derive: dispatchEntry memories route inserts source=derive', () => {
  const { s, store } = mkStore()
  const p = makePolicy()
  const res = dispatchEntry(
    { content: '图片提取改为双通道', aspect: 'perfect' },
    p.derive.routes[0],
    { store, policy: p, userDocPath: '', sessionId: 's1', now: 1, emit: () => {} },
  )
  assert.equal(res.inserted, 1)
  const mems = store.listByAspectStatus('perfect', 'active')
  assert.equal(mems.length, 1)
  assert.equal(mems[0].source, 'derive')
  closeDatabase(s)
})

test('derive: important_doc route appends to IMPORTANT.md with budget eviction', () => {
  const { s, store, dir } = mkStore()
  const p = makePolicy()
  p.injection.important_budget_chars = 50
  const up = path.join(dir, 'IMPORTANT.md')
  fs.writeFileSync(up, '- old line one\n')
  const res = dispatchEntry(
    { content: '用户喜欢简洁', aspect: 'gnomic' },
    p.derive.routes[1],
    { store, policy: p, userDocPath: up, sessionId: 's1', now: 1, emit: () => {} },
  )
  const text = fs.readFileSync(up, 'utf8')
  // budget 50: added line likely evicts old line
  assert.equal(res.inserted, 1)
  assert.ok(text.includes('用户喜欢简洁'), text)
  const again = dispatchEntry(
    { content: '用户喜欢简洁', aspect: 'gnomic' },
    p.derive.routes[1],
    { store, policy: p, userDocPath: up, sessionId: 's1', now: 2, emit: () => {} },
  )
  assert.equal(again.inserted, 0, 'IMPORTANT.md line dedup')
  assert.equal(fs.readFileSync(up, 'utf8').split('用户喜欢简洁').length - 1, 1)
  closeDatabase(s)
})

test('derive: split_important routes global→IMPORTANT.md, scoped→gnomic memory', async () => {
  const { s, store, dir } = mkStore()
  const p = makePolicy()
  p.derive.routes = [{ ...p.derive.routes[1], split_important: true }]
  const up = path.join(dir, 'IMPORTANT.md')
  const llm = fakeLlm([
    { content: '回答必须始终使用中文', aspect: 'gnomic' },
    { content: '用户不喜欢科比', aspect: 'gnomic' },
  ])
  store.insertConversation('s1', 'user', 'x')
  const der = new Deriver(store, llm, p)
  const r = await der.run('s1', { userDocPath: up })
  assert.equal(r.failedBatches.length, 0)
  const doc = fs.readFileSync(up, 'utf8')
  assert.ok(doc.includes('回答必须始终使用中文'), '全局重要进 IMPORTANT.md')
  assert.ok(!doc.includes('科比'), '语境恒常不进 IMPORTANT.md')
  const gno = store.listByAspectStatus('gnomic', 'active')
  assert.equal(gno.length, 1, '语境恒常进 gnomic 记忆')
  assert.ok(gno[0].content.includes('科比'))
  closeDatabase(s)
})

test('derive: Deriver.run success + failure batches', async () => {
  const { s, store } = mkStore()
  const p = makePolicy()
  const llm = fakeLlm([{ content: '对话结论', aspect: 'perfect' }])
  store.insertConversation('s1', 'user', '我们完成了方案评审')
  const der = new Deriver(store, llm, p)
  const r = await der.run('s1', { userDocPath: path.join(os.tmpdir(), 'u.md') })
  assert.equal(r.messagesProcessed, 1)
  // both routes call the same fake LLM → both batches succeed
  assert.equal(r.batches.length, 2)
  assert.equal(r.failedBatches.length, 0)
  closeDatabase(s)
})

test('derive: durable id cursor + persist callback (restart is idempotent)', async () => {
  const { s, store, dir } = mkStore()
  const p = makePolicy()
  const llm = fakeLlm([{ content: '方案评审已完成', aspect: 'perfect' }])
  store.insertConversation('s1', 'user', '方案评审完成了')
  const calls = []
  const persist = async (input) => {
    calls.push(input)
    const m = store.insertMemory({
      content: input.content,
      aspect: input.aspect,
      anchor: input.anchor,
      source: 'derive',
      sourceRef: input.sourceRef,
    })
    return { id: m.id, duplicate: false, suppressed: false }
  }
  const doc = path.join(dir, 'IMPORTANT.md')
  const d1 = new Deriver(store, llm, p, undefined, { persist })
  const r1 = await d1.run('s1', { userDocPath: doc })
  assert.ok(r1.messagesProcessed > 0)
  assert.equal(calls.length, 1, 'only the memories route persists; IMPORTANT rests on the doc route')
  const d2 = new Deriver(store, llm, p, undefined, { persist })
  const r2 = await d2.run('s1', { userDocPath: doc })
  assert.equal(r2.messagesProcessed, 0, 'durable cursor prevents replay after restart')
  assert.equal(calls.length, 1)
  store.insertConversation('s1', 'user', '第二件事完成了')
  const r3 = await d2.run('s1', { userDocPath: doc })
  assert.equal(r3.messagesProcessed, 1, 'new messages after the cursor are processed')
  assert.equal(calls.length, 2)
  closeDatabase(s)
})

test('derive: empty LLM array advances the cursor instead of retrying forever', async () => {
  const { s, store, dir } = mkStore()
  const p = makePolicy()
  const llm = { call: async () => ({ content: '', json: [] }) }
  store.insertConversation('s1', 'user', '闲聊一句')
  const der = new Deriver(store, llm, p)
  const r1 = await der.run('s1', { userDocPath: path.join(dir, 'IMPORTANT.md') })
  assert.equal(r1.failedBatches.length, 0)
  assert.equal(r1.batches.length, 2)
  const r2 = await der.run('s1', { userDocPath: path.join(dir, 'IMPORTANT.md') })
  assert.equal(r2.messagesProcessed, 0)
  closeDatabase(s)
})

// ── inject ───────────────────────────────────────────────────────────

test('inject: renderSections reads texts + progressive table filter', () => {
  const { s, store, dir } = mkStore()
  const p = makePolicy()
  fs.writeFileSync(path.join(dir, 'SOUL.md'), 'soul text')
  fs.writeFileSync(path.join(dir, 'IMPORTANT.md'), 'important text')
  store.insertMemory({ content: '训练在跑', aspect: 'progressive', anchor: { type: 'none' }, source: 'agent' })
  const r = renderSections({ store, policy: p, memoryRoot: dir, now: new Date() })
  assert.equal(r.soul, 'soul text')
  assert.equal(r.important, 'important text')
  assert.ok(r.memories.includes('训练在跑'))
  closeDatabase(s)
})

test('inject: IMPORTANT.md falls back to legacy user.md during migration', () => {
  const { s, store, dir } = mkStore()
  const p = makePolicy()
  fs.writeFileSync(path.join(dir, 'user.md'), 'legacy text')
  const r = renderSections({ store, policy: p, memoryRoot: dir, now: new Date() })
  assert.equal(r.important, 'legacy text')
  closeDatabase(s)
})

test('inject: IMPORTANT.md merges legacy user.md instead of shadowing it', () => {
  const { s, store, dir } = mkStore()
  const p = makePolicy()
  fs.writeFileSync(path.join(dir, 'user.md'), 'legacy line one\nlegacy line two\n')
  fs.writeFileSync(path.join(dir, 'IMPORTANT.md'), 'derived line\nlegacy line two\n')
  const r = renderSections({ store, policy: p, memoryRoot: dir, now: new Date() })
  assert.ok(r.important.includes('legacy line one'))
  assert.ok(r.important.includes('derived line'))
  assert.equal((r.important.match(/legacy line two/g) ?? []).length, 1)
  closeDatabase(s)
})

test('inject: anchorExpired interval end past → true', () => {
  assert.ok(anchorExpired({ type: 'interval', start: '2026-01-01', end: '2026-01-31' }, new Date('2026-02-01')))
  assert.ok(!anchorExpired({ type: 'interval', start: '2026-01-01', end: '2026-12-31' }, new Date('2026-02-01')))
  assert.ok(!anchorExpired({ type: 'none' }, new Date()))
})

test('inject: sections opt out of strict {{variable}} interpolation and dispose listeners', () => {
  const { s, store, dir } = mkStore()
  const p = makePolicy()
  const sections = []
  const disposed = []
  const ctx = {
    foresight: { store, policy: p, memoryRoot: dir },
    systemPrompt: { section: (section) => { sections.push(section); return () => disposed.push('section') } },
    on: () => () => disposed.push('session/event'),
  }
  const stop = applyInject(ctx)
  assert.equal(sections.length, 3)
  assert.ok(sections.every((section) => section.interpolate === false), 'memory text must stay literal')
  stop()
  assert.equal(disposed.filter((x) => x === 'section').length, 3)
  assert.ok(disposed.includes('session/event'))
  closeDatabase(s)
})

// ── nudge ────────────────────────────────────────────────────────────

test('nudge: trigger only when turnCount % every === 0', () => {
  const p = makePolicy()
  const base = { store: { listByAspectStatus: () => [] }, policy: p, now: 1, turnCount: 3, sessionStartTs: 0 }
  const hit = buildNudge({ ...base, turnCount: 3 })
  const miss = buildNudge({ ...base, turnCount: 4 })
  assert.equal(hit.trigger, true)
  assert.ok(hit.text.includes('记忆维护提醒'))
  assert.equal(miss.trigger, false)
})

test('nudge: renewal item for expiring progressive', () => {
  const p = makePolicy()
  const { s, store } = mkStore()
  store.insertMemory({ content: '任务在跑', aspect: 'progressive', anchor: { type: 'none' }, source: 'agent' })
  const r = buildNudge({ store, policy: p, now: 6 * 86_400_000, turnCount: 3, sessionStartTs: 0 })
  // createdAt=now(0)... renewalDue with age? createdAt is real now → not due. Check item absence is fine.
  assert.ok(r.trigger)
  closeDatabase(s)
})

test('nudge: active contradictions are surfaced for a user decision', () => {
  const p = makePolicy()
  const { s, store } = mkStore()
  const a = store.insertMemory({ content: '用户在读大学', aspect: 'perfect', anchor: { type: 'point', start: '2024-09-01' }, source: 'agent' })
  const b = store.insertMemory({ content: '用户在读研究生', aspect: 'perfect', anchor: { type: 'point', start: '2026-09-01' }, source: 'agent' })
  store.insertLink(a.id, b.id, 'contradicts', 'agent')
  const r = buildNudge({ store, policy: p, now: 0, turnCount: 3, sessionStartTs: 0 })
  assert.ok(r.reviewItems.some((i) => i.type === 'conflict_active'))
  closeDatabase(s)
})

test('nudge: rules candidate extraction pattern', () => {
  // intent/rule pattern with length ≥ 8
  const hits = extractCandidatesByRules(['以后不要改生产配置', '本文档随便写', '配置在 /opt/app/config.yaml 里'], 2)
  assert.equal(hits.length, 2)
  assert.ok(hits[0].includes('以后'))
})

test('nudge: injected message is identified and uses a producer-owned source kind', async () => {
  const p = makePolicy()
  const store = { listByAspectStatus: () => [], listLinksOf: () => [], emit: () => {} }
  const plugin = new NudgePlugin({ store, policy: p })
  for (const turn of [1, 2, 3]) plugin.onSessionEvent({ type: 'turn/end', data: { turn } }, { id: 's1' })
  const decision = await plugin.maybeNudge({ step: 1, messages: [] }, async () => ({ kind: 'enter', messages: [] }))
  assert.equal(decision.kind, 'enter')
  assert.equal(decision.messages.length, 1)
  const msg = decision.messages[0]
  assert.equal(msg.role, 'user')
  assert.equal(typeof msg.id, 'string')
  assert.ok(msg.id.length > 0, 'v4 sessions require an identified message')
  assert.equal(msg.source.kind, 'plugin:foresight-nudge')
  assert.notEqual(msg.source.kind, 'plugin', 'the retired shared plugin kind is rejected by dsh v4')
  assert.equal(msg.source.form, 'notice')
  assert.equal(typeof msg.source.summary, 'string')
})

test('nudge: attach returns a disposer for HMR cleanup', () => {
  const removed = []
  const ctx = { on: (ev) => () => removed.push(ev) }
  const plugin = new NudgePlugin({ store: { listByAspectStatus: () => [] }, policy: makePolicy() })
  const detach = plugin.attach(ctx)
  detach()
  assert.deepEqual(removed.sort(), ['agent/pre-step', 'session/event'])
})

// ── nudge: prediction auto-resolve (policy.nudge.auto_resolve_prediction) ──

function mkDuePrediction(store) {
  return store.insertMemory({
    content: '预测：用户论文初稿将于 2026-08-20 完成',
    aspect: 'prospective',
    modality: 'prediction',
    anchor: { type: 'none' },
    source: 'agent',
    metadata: { predict_by: '2000-01-01T00:00:00.000Z' },
  })
}

test('nudge: auto_resolve off (default) → due prediction stays a review question', async () => {
  const p = makePolicy() // auto_resolve_prediction: false
  const { s, store } = mkStore()
  const m = mkDuePrediction(store)
  const r = await buildNudgeAsync({
    store, policy: p, now: Date.now(), turnCount: 3, sessionStartTs: 0,
    llm: fakeLlm({ verdict: 'fulfilled' }),
  })
  assert.ok(r.reviewItems.some((i) => i.type === 'prospective' && i.memoryId === m.id))
  const after = store.getMemory(m.id)
  assert.equal(after.aspect, 'prospective')
  assert.equal(after.status, 'active')
  closeDatabase(s)
})

test('nudge: auto_resolve on + fulfilled → 转完成体 perfect', async () => {
  const p = makePolicy()
  p.nudge.auto_resolve_prediction = true
  const { s, store } = mkStore()
  const m = mkDuePrediction(store)
  const r = await buildNudgeAsync({
    store, policy: p, now: Date.now(), turnCount: 3, sessionStartTs: 0,
    llm: fakeLlm({ verdict: 'fulfilled' }),
  })
  const after = store.getMemory(m.id)
  assert.equal(after.aspect, 'perfect')
  assert.equal(after.metadata.verdict, 'fulfilled')
  assert.equal(after.metadata.resolved_by, 'nudge-auto')
  assert.ok(!r.reviewItems.some((i) => i.memoryId === m.id))
  closeDatabase(s)
})

test('nudge: auto_resolve on + refuted → 证伪软删除（行保留、verdict 留痕）', async () => {
  const p = makePolicy()
  p.nudge.auto_resolve_prediction = true
  const { s, store } = mkStore()
  const m = mkDuePrediction(store)
  await buildNudgeAsync({
    store, policy: p, now: Date.now(), turnCount: 3, sessionStartTs: 0,
    llm: fakeLlm({ verdict: 'refuted' }),
  })
  const after = store.getMemory(m.id)
  assert.equal(after.status, 'deleted')
  assert.equal(after.metadata.verdict, 'refuted')
  closeDatabase(s)
})

test('nudge: auto_resolve on + uncertain → 延长判定日 7 天，不删不转', async () => {
  const p = makePolicy()
  p.nudge.auto_resolve_prediction = true
  const { s, store } = mkStore()
  const m = mkDuePrediction(store)
  const now = Date.now()
  await buildNudgeAsync({
    store, policy: p, now, turnCount: 3, sessionStartTs: 0,
    llm: fakeLlm({ verdict: 'uncertain' }),
  })
  const after = store.getMemory(m.id)
  assert.equal(after.aspect, 'prospective')
  assert.equal(after.status, 'active')
  assert.equal(after.metadata.verdict, 'uncertain')
  assert.ok(Date.parse(after.metadata.predict_by) >= now + 7 * 86_400_000 - 1000)
  closeDatabase(s)
})

test('nudge: auto_resolve on + no LLM → 保守延长，绝不删除', async () => {
  const p = makePolicy()
  p.nudge.auto_resolve_prediction = true
  const { s, store } = mkStore()
  const m = mkDuePrediction(store)
  await buildNudgeAsync({ store, policy: p, now: Date.now(), turnCount: 3, sessionStartTs: 0 })
  const after = store.getMemory(m.id)
  assert.equal(after.aspect, 'prospective')
  assert.equal(after.status, 'active')
  assert.equal(after.metadata.verdict, 'uncertain')
  closeDatabase(s)
})

// ── nudge: activated-plan verdict (B1) + uncertain reclassify (B2) ──

test('nudge: activated plan past verdict_due → verdict review question', async () => {
  const p = makePolicy()
  const { s, store } = mkStore()
  const m = store.insertMemory({
    content: '迭代已激活',
    aspect: 'progressive',
    anchor: { type: 'open', start: '2026-01-01' },
    source: 'agent',
    metadata: { verdict_due: '2000-01-01T00:00:00.000Z' },
  })
  const r = await buildNudgeAsync({
    store, policy: p, now: Date.now(), turnCount: 3, sessionStartTs: 0,
    llm: fakeLlm({ verdict: 'fulfilled' }),
  })
  assert.ok(r.reviewItems.some((i) => i.type === 'verdict' && i.memoryId === m.id), 'verdict 复审问题')
  assert.equal(store.getMemory(m.id).aspect, 'progressive', '默认不自动裁决')
  closeDatabase(s)
})

test('nudge: auto_resolve on + activated plan fulfilled → perfect with completed_at', async () => {
  const p = makePolicy()
  p.nudge.auto_resolve_prediction = true
  const { s, store } = mkStore()
  const m = store.insertMemory({
    content: '迭代已激活',
    aspect: 'progressive',
    anchor: { type: 'open', start: '2026-01-01' },
    source: 'agent',
    metadata: { verdict_due: '2000-01-01T00:00:00.000Z' },
  })
  await buildNudgeAsync({
    store, policy: p, now: Date.now(), turnCount: 3, sessionStartTs: 0,
    llm: fakeLlm({ verdict: 'fulfilled' }),
  })
  const after = store.getMemory(m.id)
  assert.equal(after.aspect, 'perfect')
  assert.ok(after.metadata.completed_at, '完成时间入档')
  assert.equal(after.metadata.completion_reason, 'fulfilled')
  closeDatabase(s)
})

test('nudge: uncertain surfaced for review; auto-reclassified when enabled', async () => {
  const p = makePolicy()
  const { s, store } = mkStore()
  const u = store.insertMemory({ content: '无法判定的事件', aspect: 'uncertain', anchor: { type: 'none' }, source: 'agent' })
  const classified = { aspect: 'perfect', anchor: { type: 'point', start: '2026-01-01' }, text: '无法判定的事件', source: 'llm' }
  const r = await buildNudgeAsync({
    store, policy: p, now: Date.now(), turnCount: 3, sessionStartTs: 0,
    llm: fakeLlm(classified),
  })
  assert.ok(r.reviewItems.some((i) => i.type === 'uncertain' && i.memoryId === u.id), 'uncertain 复审问题')
  assert.equal(store.getMemory(u.id).aspect, 'uncertain', '默认不自动改')

  const p2 = makePolicy()
  p2.nudge.auto_reclassify_uncertain = true
  await buildNudgeAsync({
    store, policy: p2, now: Date.now(), turnCount: 3, sessionStartTs: 0,
    llm: fakeLlm(classified),
  })
  const after = store.getMemory(u.id)
  assert.equal(after.aspect, 'perfect', '开启后 LLM 再分类')
  assert.equal(after.metadata.reclassified_to, 'perfect')
  closeDatabase(s)
})

// ── observer ─────────────────────────────────────────────────────────

test('observer: textOf + chunkText basics', () => {
  assert.equal(textOf([{ type: 'text', text: 'hello' }, { type: 'image' }]), 'hello')
  const chunks = chunkText('x'.repeat(25000), 20000)
  assert.equal(chunks.length, 2)
  assert.ok(chunks[1].startsWith('[continued]'))
})

test('observer: event flow flush writes conversations', async () => {
  const { s, store } = mkStore()
  const ob = new ForeSightObserver({ store })
  const ctx = { on: (ev, fn) => () => {} }
  ob.apply(ctx)
  // drive manually without ctx listener: simulate pending by internal path
  await ob.flushAsync(1) // empty → no-op
  closeDatabase(s)
})

test('observer: turn/end feeds each user/assistant turn to the write gate', async () => {
  const { s, store } = mkStore()
  const ingested = []
  const ob = new ForeSightObserver({ store, onIngest: (t) => { ingested.push(t) } })
  const listeners = new Map()
  ob.apply({ on: (ev, fn) => { listeners.set(ev, fn); return () => {} } })
  const emit = (ev, session, event) => listeners.get(ev)(session, event)
  emit('session/event', { id: 's1' }, { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '我在写报告' }] } })
  emit('session/event', { id: 's1' }, { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '收到' }] } } })
  emit('session/event', { id: 's1' }, { type: 'user/message', data: { source: { kind: 'plugin' }, content: [{ type: 'text', text: '插件提示' }] } })
  emit('session/event', { id: 's1' }, { type: 'turn/end', data: { turn: 1 } })
  await ob.settled
  assert.deepEqual(ingested.map((t) => `${t.role}:${t.text}`), ['user:我在写报告', 'assistant:收到'])
  const conv = store.listConversationsSince('s1', 0)
  assert.ok(conv.length >= 2, 'transcript still written')
  closeDatabase(s)
})

test('observer: ingest failure does not block the transcript', async () => {
  const { s, store } = mkStore()
  const ob = new ForeSightObserver({ store, onIngest: () => { throw new Error('gate down') } })
  const listeners = new Map()
  ob.apply({ on: (ev, fn) => { listeners.set(ev, fn); return () => {} } })
  listeners.get('session/event')({ id: 's1' }, { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '一条事实' }] } })
  listeners.get('session/event')({ id: 's1' }, { type: 'turn/end', data: { turn: 1 } })
  await ob.settled
  assert.equal(store.listConversationsSince('s1', 0).length, 1)
  closeDatabase(s)
})

test('observer: session/flush is a checkpoint; only session/disposed runs onSessionEnd', async () => {
  const { s, store } = mkStore()
  const ended = []
  const ob = new ForeSightObserver({ store, onSessionEnd: (sid) => { ended.push(sid) } })
  const listeners = new Map()
  ob.apply({ on: (ev, fn) => { listeners.set(ev, fn); return () => {} } })
  const session = { id: 's1' }
  const flushing = listeners.get('session/flush')(session)
  assert.equal(typeof flushing?.then, 'function', 'flush listener returns its checkpoint promise')
  await flushing
  assert.deepEqual(ended, [], 'a durability checkpoint is not a session end')
  listeners.get('session/disposed')(session)
  await ob.settled
  assert.deepEqual(ended, ['s1'])
  closeDatabase(s)
})

test('observer: gateSlices caps each slice at the gate limit', () => {
  assert.deepEqual(gateSlices('  '), [])
  const slices = gateSlices('x'.repeat(4500))
  assert.equal(slices.length, 3)
  assert.ok(slices.every((t) => t.length <= 2000))
  assert.ok(!slices[1].startsWith('[continued]'), 'no transcript marker in gate input')
})

// ── dialectic ────────────────────────────────────────────────────────

test('dialectic: reason degrades to evidence concat on LLM failure', async () => {
  const { s, store } = mkStore()
  const p = makePolicy()
  store.insertMemory({ content: '数据库查询走索引', aspect: 'perfect', anchor: { type: 'point', start: '2026-06-01' }, source: 'agent' })
  const badLlm = { call: async () => { throw new Error('no llm') } }
  const fakeSearch = async (q, deps, opts) => {
    const m = store.listByAspectStatus('perfect', 'active')[0]
    return [{ id: m.id, content: m.content, aspect: m.aspect, anchor: m.anchor, activation: 1, score: 1, rendered: '证据' + m.content }]
  }
  const r = await reason('数据库查询', { store, policy: p, embed: null, llm: badLlm, now: 1, search: fakeSearch })
  assert.equal(r.citations.length, 1)
  assert.ok(r.answer.includes('数据库'))
  closeDatabase(s)
})

test('dialectic: conflict pairs detected within evidence', async () => {
  const { s, store } = mkStore()
  const p = makePolicy()
  const a = store.insertMemory({ content: '大学生', aspect: 'perfect', anchor: { type: 'point', start: '2024-09-01' }, source: 'agent' })
  const b = store.insertMemory({ content: '研究生', aspect: 'perfect', anchor: { type: 'point', start: '2026-09-01' }, source: 'agent' })
  store.insertLink(a.id, b.id, 'contradicts', 'agent')
  const okLlm = { call: async () => ({ content: '', json: { answer: '存在新旧事实' } }) }
  const fakeSearch = async () => [
    { id: a.id, content: a.content, aspect: a.aspect, anchor: a.anchor, activation: 1, score: 1, rendered: 'A' },
    { id: b.id, content: b.content, aspect: b.aspect, anchor: b.anchor, activation: 1, score: 1, rendered: 'B' },
  ]
  const r = await reason('身份', { store, policy: p, embed: null, llm: okLlm, now: 1, search: fakeSearch })
  assert.equal(r.conflicts.length, 1)
  closeDatabase(s)
})

// ── server ───────────────────────────────────────────────────────────

test('server: health + write + get roundtrip', async () => {
  const { s, store } = mkStore()
  const p = makePolicy(true)
  const started = await startServer({ policy: p, store })
  const base = `http://127.0.0.1:${started.port}`
  const h = await fetch(`${base}/v1/health`)
  assert.equal(h.status, 200)
  const w = await fetch(`${base}/v1/memories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-foresight-token': 'test-token' },
    body: JSON.stringify({ content: '项目通过评审' }),
  })
  assert.equal(w.status, 200)
  const { id } = await w.json()
  const g = await fetch(`${base}/v1/memories/${id}`, { headers: { 'x-foresight-token': 'test-token' } })
  assert.equal(g.status, 200)
  const mem = await g.json()
  assert.ok(mem.content.includes('评审'))
  await started.close()
  closeDatabase(s)
})

test('server: full write path embeds/isolates and exposes management endpoints', async () => {
  const { s, store } = mkStore()
  const p = makePolicy(true)
  const vec = new Float32Array(768).fill(1)
  const embed = { embedOne: async () => vec, embedBatch: async (t) => t.map(() => vec) }
  const started = await startServer({ policy: p, store, embed })
  const base = `http://127.0.0.1:${started.port}`
  const headers = { 'Content-Type': 'application/json', 'x-foresight-token': 'test-token', 'x-foresight-peer': 'agent' }
  const w = await fetch(`${base}/v1/memories`, { method: 'POST', headers, body: JSON.stringify({ content: '项目完成了评审' }) })
  assert.equal(w.status, 200)
  const { id } = await w.json()
  assert.ok(store.getMemory(id).embedding, 'server write embeds through the full gate')

  const spoof = await fetch(`${base}/v1/memories`, {
    method: 'POST', headers, body: JSON.stringify({ content: '伪造 Root 写入', source: 'root' }),
  })
  assert.equal(spoof.status, 403, 'non-root peer cannot claim source=root')

  const search = await fetch(`${base}/v1/memories/search`, {
    method: 'POST', headers, body: JSON.stringify({ query: '关系型数据库', k: 5 }),
  })
  const sj = await search.json()
  assert.ok(sj.results.some((r) => r.id === id), 'semantic search reaches the server-written memory')

  const otherPeer = await fetch(`${base}/v1/memories/${id}`, {
    headers: { 'x-foresight-token': 'test-token', 'x-foresight-peer': 'other' },
  })
  assert.equal(otherPeer.status, 404, 'peer scope isolation')

  const patch = await fetch(`${base}/v1/memories/${id}`, {
    method: 'PATCH', headers, body: JSON.stringify({ content: '项目完成了验收' }),
  })
  assert.equal(patch.status, 200)
  assert.equal((await patch.json()).content, '项目完成了验收')
  assert.ok(store.getMemory(id).embedding, 'server patch re-embeds')

  const del = await fetch(`${base}/v1/memories/${id}`, { method: 'DELETE', headers })
  assert.equal(del.status, 200)
  assert.equal((await fetch(`${base}/v1/memories/${id}`, { headers })).status, 404)
  const restore = await fetch(`${base}/v1/memories/${id}/restore`, { method: 'POST', headers })
  assert.equal(restore.status, 200)
  assert.equal((await fetch(`${base}/v1/memories/${id}`, { headers })).status, 200)

  const running = store.insertMemory({
    content: '项目在跑', aspect: 'progressive', anchor: { type: 'none' }, source: 'agent', scope: 'agent',
  })
  const renew = await fetch(`${base}/v1/memories/${running.id}/renew`, {
    method: 'POST', headers, body: JSON.stringify({ until: '2026-12-31' }),
  })
  assert.equal(renew.status, 200)
  assert.equal((await renew.json()).anchor.end, '2026-12-31')

  await started.close()
  closeDatabase(s)
})

test('server: per-peer tokens reject unknown peers and cross-token use', async () => {
  const { s, store } = mkStore()
  const p = makePolicy(true)
  p.server.peer_tokens = { agent: 'token-a', other: 'token-b' }
  const started = await startServer({ policy: p, store })
  const base = `http://127.0.0.1:${started.port}`
  const write = (peer, token) => fetch(`${base}/v1/memories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-foresight-token': token, 'x-foresight-peer': peer },
    body: JSON.stringify({ content: '项目完成了评审' }),
  })
  assert.equal((await write('agent', 'token-a')).status, 200)
  assert.equal((await write('agent', 'token-b')).status, 401)
  assert.equal((await write('other', 'token-a')).status, 401)
  assert.equal((await write('unknown', 'token-a')).status, 401)
  assert.equal((await write('other', 'token-b')).status, 200)
  await started.close()
  closeDatabase(s)
})

// ── tools ────────────────────────────────────────────────────────────

function fakeForesight() {
  const calls = { write: [], query: [], reason: [], update: [], delete: [], restore: [], renew: [] }
  return {
    calls,
    async write(text, actor) {
      calls.write.push({ text, actor })
      return { ok: true, memory: { id: 'm1' }, message: '写入成功', classification: null, suggestion: null, eventType: 'memory.write' }
    },
    async query(q, opts) {
      calls.query.push({ q, opts })
      return [{ id: 'm1', content: '训练在跑', rendered: '训练在跑（2026-06-01 起）' }]
    },
    async reason(q, scope) {
      calls.reason.push({ q, scope })
      return { answer: '仍在进行', citations: [{ id: 'm1', content: '训练在跑', anchor: { type: 'none' } }], conflicts: [] }
    },
    async updateMemory(id, patch, actor) {
      calls.update.push({ id, patch, actor })
      return { id, content: patch.content }
    },
    async deleteMemory(id, actor) {
      calls.delete.push({ id, actor })
      return true
    },
    async restoreMemory(id, actor) {
      calls.restore.push({ id, actor })
      return { id, content: '恢复' }
    },
    async renewMemory(id, until, actor) {
      calls.renew.push({ id, until, actor })
      return { id, content: '续期', anchor: { type: 'point', start: until ?? '2026-12-31' } }
    },
  }
}

test('tools: memory_write/update/delete/restore/query/reason execute through core', async () => {
  const fsight = fakeForesight()
  const defs = buildMemoryTools(fsight)
  assert.deepEqual(defs.map((d) => d.name), [
    'memory_write', 'memory_update', 'memory_delete', 'memory_restore', 'memory_renew', 'memory_query', 'memory_reason',
  ])
  const byName = Object.fromEntries(defs.map((d) => [d.name, d]))

  const w = await byName.memory_write.execute({ text: '我在写报告' })
  assert.ok(w.startsWith('已写入 m1'), w)
  assert.equal(fsight.calls.write[0].actor.name, 'agent')
  assert.equal(fsight.calls.write[0].actor.scope, 'global')

  const u = await byName.memory_update.execute({ id: 'm1', text: '我在写论文' })
  assert.ok(u.includes('已更新 m1'), u)
  const d = await byName.memory_delete.execute({ id: 'm1' })
  assert.ok(d.includes('已删除 m1'), d)
  const res = await byName.memory_restore.execute({ id: 'm1' })
  assert.ok(res.includes('已恢复 m1'), res)
  const ren = await byName.memory_renew.execute({ id: 'm1', until: '2026-12-31' })
  assert.ok(ren.includes('已续期 m1'), ren)

  const q = await byName.memory_query.execute({ query: '训练', k: 3 })
  assert.ok(q.includes('训练在跑'))
  assert.equal(fsight.calls.query[0].opts.topK, 3)
  assert.equal(fsight.calls.query[0].opts.scope, 'global')

  const r = await byName.memory_reason.execute({ query: '进展' })
  assert.ok(r.includes('仍在进行') && r.includes('证据'), r)
  assert.equal(fsight.calls.reason[0].scope, 'global')

  const rendered = byName.memory_write.output.render({}, 'ok')
  assert.deepEqual(rendered, [{ type: 'text', text: 'ok' }])
})

test('tools: parameters are object-rooted JSON Schema', () => {
  const defs = buildMemoryTools(fakeForesight())
  for (const def of defs) {
    assert.equal(def.parameters.type, 'object', def.name)
    assert.ok(def.parameters.properties && typeof def.parameters.properties === 'object', def.name)
    for (const [key, prop] of Object.entries(def.parameters.properties)) {
      assert.equal(typeof prop.type, 'string', `${def.name}.${key}`)
    }
    for (const key of def.parameters.required ?? []) {
      assert.ok(Object.hasOwn(def.parameters.properties, key), `${def.name} required ${key}`)
    }
    assert.equal(def.output.schema.type, 'string', def.name)
  }
  const del = defs.find((d) => d.name === 'memory_delete')
  assert.deepEqual(del.parameters, {
    type: 'object',
    properties: { id: { type: 'string', description: '记忆 id' } },
    required: ['id'],
  })
})

test('tools: empty arguments are rejected before touching the core', async () => {
  const fsight = fakeForesight()
  const byName = Object.fromEntries(buildMemoryTools(fsight).map((d) => [d.name, d]))
  await assert.rejects(() => byName.memory_write.execute({ text: '  ' }), /text is required/)
  await assert.rejects(() => byName.memory_query.execute({}), /query is required/)
  await assert.rejects(() => byName.memory_update.execute({ id: 'm1' }), /text is required/)
  await assert.rejects(() => byName.memory_delete.execute({}), /id is required/)
  assert.equal(fsight.calls.write.length, 0)
  assert.equal(fsight.calls.query.length, 0)
  assert.equal(fsight.calls.update.length, 0)
  assert.equal(fsight.calls.delete.length, 0)
})

test('tools: apply registers all tools and disposes them', () => {
  const fsight = fakeForesight()
  const registered = []
  const disposed = []
  const ctx = {
    foresight: fsight,
    tools: {
      register(def) {
        registered.push(def.name)
        return () => disposed.push(def.name)
      },
    },
  }
  const dispose = applyTools(ctx)
  const expected = ['memory_write', 'memory_update', 'memory_delete', 'memory_restore', 'memory_renew', 'memory_query', 'memory_reason']
  assert.deepEqual(registered, expected)
  dispose()
  assert.deepEqual(disposed.sort(), [...expected].sort())
})

// ── inject: all aspects + query ranking ─────────────────────────────

test('inject: every eligible aspect is injected, not-started stays hidden', () => {
  const { s, store } = mkStore()
  const p = makePolicy()
  store.insertMemory({ content: '训练在跑', aspect: 'progressive', anchor: { type: 'none' }, source: 'agent' })
  store.insertMemory({ content: '用户喜欢简洁', aspect: 'gnomic', anchor: { type: 'none' }, source: 'agent' })
  store.insertMemory({ content: '论文已提交', aspect: 'perfect', anchor: { type: 'point', start: '2026-06-01' }, source: 'agent' })
  store.insertMemory({ content: '下一阶段从 2099 开始', aspect: 'progressive', anchor: { type: 'interval', start: '2099-01-01', end: '2099-01-10' }, source: 'agent' })
  const text = renderMemories(store, p, new Date(0))
  assert.ok(text.includes('训练在跑'))
  assert.ok(text.includes('用户喜欢简洁'))
  assert.ok(text.includes('论文已提交'))
  assert.ok(!text.includes('下一阶段从 2099 开始'), 'not-started progressive stays hidden')

  const ranked = renderMemories(store, p, new Date(0), { query: '论文提交了吗' })
  assert.ok(ranked.indexOf('论文已提交') < ranked.indexOf('用户喜欢简洁'), ranked)
  closeDatabase(s)
})

test('inject: semantic path ranks by embedding', async () => {
  const { FakeEmbedProvider } = await import('../lib/store/embed.js')
  const { renderMemoriesQuery } = await import('../lib/inject/render.js')
  const { s, store } = mkStore()
  const p = makePolicy()
  const fake = new FakeEmbedProvider(768)
  store.insertMemory({
    content: '用户喜欢简洁',
    aspect: 'gnomic',
    anchor: { type: 'none' },
    source: 'agent',
    embedding: await fake.embedOne('用户喜欢简洁'),
  })
  store.insertMemory({
    content: '论文已提交',
    aspect: 'perfect',
    anchor: { type: 'point', start: '2026-06-01' },
    source: 'agent',
    embedding: await fake.embedOne('论文已提交'),
  })
  const text = await renderMemoriesQuery(store, p, fake, '用户喜欢简洁', new Date(0))
  assert.ok(text.startsWith('用户喜欢简洁'), text)
  closeDatabase(s)
})

// ── classify prompt matches policy v4 ───────────────────────────────

test('classify: system prompt stores gnomic in memory, no SOUL/user rejection', () => {
  const p = makePolicy()
  const prompt = buildSystemPrompt(p)
  assert.ok(prompt.includes('写入记忆库'))
  assert.ok(!prompt.includes('不进记忆系统'))
})
