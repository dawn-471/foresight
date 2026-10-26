#!/usr/bin/env node
/**
 * Module 2 tests: config resolution chain + policy loading.
 * All ficitonal data; temp dirs only.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const { resolveConfig, defaultMemoryRoot, ensureDataDir } = await import('../lib/config.js')
const { loadPolicy, behavior } = await import('../lib/policy.js')
const { POLICY_VERSION } = await import('../lib/defaults.js')

test('config: defaults are platform-safe, no user paths', () => {
  const c = resolveConfig()
  assert.equal(c.dbFile, 'foresight.db')
  assert.equal(c.embedBaseUrl, 'http://localhost:11434')
  assert.equal(c.embedModel, 'nomic-embed-text-v2-moe')
  // data dir must NOT contain any personal path fragment
  assert.ok(!c.memoryRoot.includes('Users/'), 'memoryRoot must not hardcode user dir')
})

test('config: env overrides defaults', () => {
  process.env.FORESIGHT_MEMORY_DIR = '/tmp/foresight-env-test'
  process.env.FORESIGHT_EMBED_MODEL = 'some-other-model'
  const c = resolveConfig()
  assert.equal(c.memoryRoot, '/tmp/foresight-env-test')
  assert.equal(c.embedModel, 'some-other-model')
  delete process.env.FORESIGHT_MEMORY_DIR
  delete process.env.FORESIGHT_EMBED_MODEL
})

test('config: explicit options win over env', () => {
  process.env.FORESIGHT_MEMORY_DIR = '/tmp/env-root'
  const c = resolveConfig({ memoryRoot: '/tmp/explicit-root' })
  assert.equal(c.memoryRoot, '/tmp/explicit-root')
  delete process.env.FORESIGHT_MEMORY_DIR
})

test('config: ensureDataDir creates missing dir and seeds templates', () => {
  const p = path.join(os.tmpdir(), 'foresight-cfg-' + Date.now())
  ensureDataDir({ memoryRoot: p })
  assert.ok(fs.existsSync(p))
  assert.ok(fs.existsSync(path.join(p, 'policy.yaml')))
  assert.ok(fs.existsSync(path.join(p, 'SOUL.md')))
  assert.ok(fs.existsSync(path.join(p, 'IMPORTANT.md')))
  const pol = loadPolicy(path.join(p, 'policy.yaml'))
  assert.equal(pol.policy_version, POLICY_VERSION)
  fs.rmSync(p, { recursive: true, force: true })
})

test('config: Windows prefers LocalAppData but keeps an existing Roaming data dir', { skip: process.platform !== 'win32' }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'foresight-win-root-'))
  const local = path.join(root, 'Local')
  const roaming = path.join(root, 'Roaming')
  const oldLocal = process.env.LOCALAPPDATA
  const oldRoaming = process.env.APPDATA
  process.env.LOCALAPPDATA = local
  process.env.APPDATA = roaming
  try {
    fs.mkdirSync(path.join(roaming, 'foresight'), { recursive: true })
    fs.writeFileSync(path.join(roaming, 'foresight', 'policy.yaml'), 'foresight:\n  policy_version: 4\n')
    assert.equal(defaultMemoryRoot(), path.join(roaming, 'foresight'), 'legacy Roaming data is not lost')
    fs.mkdirSync(path.join(local, 'foresight'), { recursive: true })
    fs.writeFileSync(path.join(local, 'foresight', 'policy.yaml'), 'foresight:\n  policy_version: 4\n')
    assert.equal(defaultMemoryRoot(), path.join(local, 'foresight'), 'LocalAppData wins once it has data')
  } finally {
    if (oldLocal === undefined) delete process.env.LOCALAPPDATA
    else process.env.LOCALAPPDATA = oldLocal
    if (oldRoaming === undefined) delete process.env.APPDATA
    else process.env.APPDATA = oldRoaming
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('config: ensureDataDir seeds optional docs into a pre-created empty directory', () => {
  const p = fs.mkdtempSync(path.join(os.tmpdir(), 'foresight-cfg-empty-'))
  ensureDataDir({ memoryRoot: p })
  assert.ok(fs.existsSync(path.join(p, 'policy.yaml')))
  assert.ok(fs.existsSync(path.join(p, 'SOUL.md')))
  assert.ok(fs.existsSync(path.join(p, 'IMPORTANT.md')))
  fs.rmSync(p, { recursive: true, force: true })
})

test('config: ensureDataDir keeps an existing data dir minimal (no template docs)', () => {
  const p = fs.mkdtempSync(path.join(os.tmpdir(), 'foresight-cfg-existing-'))
  fs.writeFileSync(path.join(p, 'policy.yaml'), `foresight:\n  policy_version: ${POLICY_VERSION}\n`)
  ensureDataDir({ memoryRoot: p })
  assert.equal(fs.existsSync(path.join(p, 'policy.yaml')), true)
  assert.equal(fs.existsSync(path.join(p, 'SOUL.md')), false)
  assert.equal(fs.existsSync(path.join(p, 'IMPORTANT.md')), false)
  fs.rmSync(p, { recursive: true, force: true })
})

test('config: dsh apply honors FORESIGHT_MEMORY_DIR (no cwd default)', async () => {
  const { apply } = await import('../lib/index.js')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'foresight-apply-'))
  process.env.FORESIGHT_MEMORY_DIR = root
  const ctx = { provide(key, value) { this[key] = value } }
  const dispose = apply(ctx, {})
  try {
    assert.equal(ctx.foresight.memoryRoot, root)
  } finally {
    dispose()
    delete process.env.FORESIGHT_MEMORY_DIR
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('policy: loads valid file, version checked', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foresight-pol-'))
  const p = path.join(dir, 'policy.yaml')
  fs.writeFileSync(p, `foresight:\n  policy_version: ${POLICY_VERSION}\n  aspects:\n    progressive:\n      storage: memory\n      injection: conditional\n      expiry: anchor\n      render_anchor: true\n      renewable: true\n      default_ttl_days: 7\n      review_every_turns: 30\n    perfect:\n      storage: memory\n      injection: conditional\n      expiry: never\n      render_anchor: short\n      renewable: false\n      default_ttl_days: 0\n      review_every_turns: 0\n    gnomic:\n      storage: doc\n      injection: always\n      expiry: never\n      render_anchor: false\n      renewable: false\n      default_ttl_days: 0\n      review_every_turns: 0\n    prospective:\n      storage: memory\n      injection: renewal\n      expiry: ttl\n      render_anchor: true\n      renewable: true\n      default_ttl_days: 30\n      review_every_turns: 30\n`)
  const pol = loadPolicy(p)
  assert.equal(pol.policy_version, POLICY_VERSION)
  const b = behavior(pol, 'progressive')
  assert.equal(b.default_ttl_days, 7)
  assert.equal(b.review_every_turns, 30)
  assert.equal(b.storage, 'memory')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('policy: version mismatch raises', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foresight-pol-'))
  const p = path.join(dir, 'policy.yaml')
  fs.writeFileSync(p, `foresight:\n  policy_version: 99\n`)
  assert.throws(() => loadPolicy(p), /version mismatch/)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('policy: v3 policy maps to v4 in memory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foresight-pol-v3-'))
  const p = path.join(dir, 'policy.yaml')
  fs.writeFileSync(p, `foresight:
  policy_version: 3
  permission:
    user_doc_writer: derive
  aspects:
    gnomic:
      storage: doc
      injection: always
  gate:
    fallback: rules
`)
  const pol = loadPolicy(p)
  assert.equal(pol.policy_version, POLICY_VERSION)
  assert.equal(pol.permission.important_doc_writer, 'derive')
  assert.ok(pol.aspects.uncertain, 'v4 uncertain aspect filled')
  assert.ok(pol.transitions?.progressive, 'v4 transitions filled')
  assert.equal(typeof pol.gate.fallback_write, 'boolean')
  fs.rmSync(dir, { recursive: true, force: true })
})
