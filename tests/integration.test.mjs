/**
 * Integration tests for the repaired write/read/management paths.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const { ForeSight } = await import('../lib/core.js')
const { FakeEmbedProvider } = await import('../lib/store/embed.js')
const { ManualClock } = await import('../lib/clock.js')

function makeMemory() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foresight-int-'))
  fs.copyFileSync(path.join(process.cwd(), 'templates', 'policy.yaml.example'), path.join(dir, 'policy.yaml'))
  const clock = new ManualClock(1_800_000_000_000)
  const f = new ForeSight({
    memoryRoot: dir,
    embed: new FakeEmbedProvider(768),
    clock,
  })
  return { f, dir, clock }
}

test('core: embedding backfill heals rows written during an embedder outage', async () => {
  const { f } = makeMemory()
  const m = f.store.insertMemory({
    content: '服务器在维护',
    aspect: 'perfect',
    anchor: { type: 'point', start: '2026-01-01' },
    source: 'agent',
  })
  assert.equal(m.embedding, null)
  const n = await f.backfillEmbeddings()
  assert.equal(n, 1)
  assert.ok(f.store.getMemory(m.id).embedding)
  f.close()
})

test('core: derive runs on every_n_turns, embeds, dedups and is restart-safe', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foresight-int-derive-'))
  fs.copyFileSync(path.join(process.cwd(), 'templates', 'policy.yaml.example'), path.join(dir, 'policy.yaml'))
  const llm = {
    call: async () => ({
      content: '',
      json: [{ content: '派生：方案评审已完成', aspect: 'perfect' }],
    }),
  }
  const f = new ForeSight({
    memoryRoot: dir,
    embed: new FakeEmbedProvider(768),
    llm,
    clock: new ManualClock(1_800_000_000_000),
  })
  f.store.insertConversation('s1', 'user', '我们完成了方案评审')
  await f.onTurnEnd('s1', 19)
  assert.equal(f.store.listByAspectStatus('perfect', 'active').filter((m) => m.source === 'derive').length, 0)
  await f.onTurnEnd('s1', 20)
  const derived = f.store.listByAspectStatus('perfect', 'active').filter((m) => m.source === 'derive')
  assert.ok(derived.length >= 1)
  assert.ok(derived[0].embedding, 'derive persists through the embedding path')
  const count = derived.length
  await f.onTurnEnd('s1', 20)
  assert.equal(f.store.listByAspectStatus('perfect', 'active').filter((m) => m.source === 'derive').length, count, 'derive is idempotent within the same cursor')
  f.close()
})

test('core: derive.trigger=session/session_end derives on session end, not turn end', async () => {
  for (const trigger of ['session', 'session_end']) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foresight-int-session-'))
    fs.copyFileSync(path.join(process.cwd(), 'templates', 'policy.yaml.example'), path.join(dir, 'policy.yaml'))
    const llm = { call: async () => ({ content: '', json: [{ content: '派生：会话结论', aspect: 'perfect' }] }) }
    const f = new ForeSight({
      memoryRoot: dir,
      embed: new FakeEmbedProvider(768),
      llm,
      clock: new ManualClock(1_800_000_000_000),
    })
    f.policy.derive.trigger = trigger
    f.store.insertConversation('s1', 'user', '会话内容')
    await f.onTurnEnd('s1', 1)
    assert.equal(
      f.store.listByAspectStatus('perfect', 'active').filter((m) => m.source === 'derive').length,
      0,
      `${trigger}: turn end must not derive`,
    )
    await f.onSessionEnd('s1')
    assert.ok(
      f.store.listByAspectStatus('perfect', 'active').some((m) => m.source === 'derive'),
      `${trigger}: session end must derive`,
    )
    f.close()
  }
})

test('core: scoped write, query, update, delete and restore', async () => {
  const { f } = makeMemory()
  const actorA = { name: 'agent-a', isRoot: false, scope: 'peer-a' }
  const actorB = { name: 'agent-b', isRoot: false, scope: 'peer-b' }

  const rec = await f.write('项目完成了评审', actorA)
  assert.equal(rec.ok, true)
  const id = rec.memory.id
  assert.equal(rec.memory.scope, 'peer-a')

  const hitsA = await f.query('评审', { scope: 'peer-a' })
  assert.ok(hitsA.some((h) => h.id === id))
  const hitsB = await f.query('评审', { scope: 'peer-b' })
  assert.equal(hitsB.length, 0, 'scope isolation')

  const updated = await f.updateMemory(id, { content: '项目完成了验收' }, actorA)
  assert.equal(updated.content, '项目完成了验收')
  assert.ok(updated.metadata.revision >= 1)
  await assert.rejects(() => f.deleteMemory(id, actorA, true), /Root/)

  assert.equal(await f.deleteMemory(id, actorA), true)
  assert.equal(f.store.getMemory(id, 'peer-a').status, 'deleted')
  assert.ok(await f.restoreMemory(id, actorA))
  assert.equal(f.store.getMemory(id, 'peer-a').status, 'active')
  assert.equal(await f.deleteMemory(id, { ...actorA, scope: 'peer-b' }), false)

  const running = f.store.insertMemory({
    content: '项目在跑', aspect: 'progressive', anchor: { type: 'none' }, source: 'agent', scope: 'peer-a',
  })
  const renewed = await f.renewMemory(running.id, '2026-12-31', actorA)
  assert.equal(renewed.anchor.type, 'interval')
  assert.equal(renewed.anchor.end, '2026-12-31')
  f.close()
})
