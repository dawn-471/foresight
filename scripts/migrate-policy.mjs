#!/usr/bin/env node
/**
 * Explicit ForeSight data-dir migration: policy v3 → v4 and user.md → IMPORTANT.md.
 *
 * Usage:
 *   node scripts/migrate-policy.mjs <memoryRoot> [--write]
 *
 * Default is a dry run that writes `policy.yaml.v4-<ts>` next to the original.
 * With `--write`, the original policy.yaml is backed up first, then replaced.
 * `user.md` is merged into IMPORTANT.md (deduplicated) and left on disk as a
 * safety copy; the runtime also merges both during the transition.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import yaml from 'js-yaml'

const args = process.argv.slice(2)
const root = args.find((a) => !a.startsWith('--'))
const write = args.includes('--write')
if (!root) {
  console.error('usage: node scripts/migrate-policy.mjs <memoryRoot> [--write]')
  process.exit(2)
}

const policyPath = path.join(root, 'policy.yaml')
const templatePath = new URL('../templates/policy.yaml.example', import.meta.url)
const ts = new Date().toISOString().replace(/[:.]/g, '-')

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function deepMerge(base, override) {
  if (override === undefined) return base
  if (Array.isArray(base)) return Array.isArray(override) ? override : base
  if (isPlainObject(base) && isPlainObject(override)) {
    const out = { ...base }
    for (const [key, value] of Object.entries(override)) {
      out[key] = key in out ? deepMerge(out[key], value) : value
    }
    return out
  }
  return override
}

function mergeDocs(rootDir) {
  const read = (name) => {
    try {
      return fs.readFileSync(path.join(rootDir, name), 'utf8').trim()
    } catch {
      return ''
    }
  }
  const legacy = read('user.md')
  const current = read('IMPORTANT.md')
  if (!legacy) return null
  const lines = []
  const seen = new Set()
  for (const line of [...legacy.split(/\r?\n/), ...current.split(/\r?\n/)]) {
    const key = line.trim()
    if (key) {
      if (seen.has(key)) continue
      seen.add(key)
    }
    lines.push(line)
  }
  return lines.join('\n')
}

if (!fs.existsSync(policyPath)) {
  console.error(`[migrate] no policy.yaml at ${policyPath}`)
  process.exit(1)
}

const raw = yaml.load(fs.readFileSync(policyPath, 'utf8'))
const p = raw?.foresight
if (!p) {
  console.error('[migrate] policy.yaml has no foresight root')
  process.exit(1)
}

if (Number(p.policy_version) === 4) {
  console.log('[migrate] policy is already v4; no policy rewrite needed')
} else if (Number(p.policy_version) === 3) {
  const template = yaml.load(fs.readFileSync(templatePath, 'utf8'))?.foresight
  if (!template) {
    console.error(`[migrate] invalid template at ${templatePath.pathname}`)
    process.exit(1)
  }
  const merged = deepMerge(template, p)
  const legacyWriter = p.permission?.user_doc_writer
  if (legacyWriter !== undefined && p.permission?.important_doc_writer === undefined) {
    merged.permission.important_doc_writer = String(legacyWriter)
  }
  delete merged.permission.user_doc_writer
  merged.policy_version = 4

  const target = write ? policyPath : path.join(root, `policy.yaml.v4-${ts}`)
  if (write) fs.copyFileSync(policyPath, path.join(root, `policy.yaml.bak-${ts}`))
  fs.writeFileSync(target, yaml.dump({ foresight: merged }, { lineWidth: 120, noRefs: true }), 'utf8')
  console.log(`[migrate] wrote v4 policy: ${target}${write ? ' (original backed up)' : ' — review, then rename to policy.yaml'}`)
  console.log('[migrate] note: YAML comments are not preserved; v4 changes gnomic storage/injection and important-doc routing, review the generated values')
} else {
  console.error(`[migrate] unsupported policy_version: ${p.policy_version}`)
  process.exit(1)
}

const mergedDoc = mergeDocs(root)
if (mergedDoc !== null) {
  const target = path.join(root, 'IMPORTANT.md')
  if (!write) {
    console.log('[migrate] dry run: user.md and IMPORTANT.md would be merged; rerun with --write to apply')
  } else {
    if (fs.existsSync(target)) fs.copyFileSync(target, path.join(root, `IMPORTANT.md.bak-${ts}`))
    fs.writeFileSync(target, `${mergedDoc}\n`, 'utf8')
    console.log(`[migrate] merged user.md into IMPORTANT.md (user.md kept as-is): ${target}`)
  }
}
