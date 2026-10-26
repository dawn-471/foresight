#!/usr/bin/env node
/**
 * Verify the published tarball actually contains the files a fresh install
 * needs. Run after `pnpm build` (CI does this before packaging).
 */
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

const required = [
  'lib/index.js',
  'lib/config.js',
  'lib/policy.js',
  'lib/runtime-guard.js',
  'lib/store/embed.js',
  'templates/policy.yaml.example',
  'templates/SOUL.md.example',
  'templates/IMPORTANT.md.example',
  'scripts/migrate-policy.mjs',
  'CHANGELOG.md',
  'cordis.patch.yml',
]

for (const file of required) {
  if (!fs.existsSync(path.join(process.cwd(), file))) {
    console.error(`[check-pack] missing on disk before pack: ${file} (run pnpm build)`)
    process.exit(1)
  }
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const raw = execFileSync(npm, ['pack', '--dry-run', '--json', '--ignore-scripts'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
  // .cmd shims cannot be spawned directly by Node on Windows (EINVAL).
  shell: process.platform === 'win32',
})
const packed = JSON.parse(raw)[0]
const files = new Set(packed.files.map((f) => f.path))
const missing = required.filter((file) => !files.has(file))
if (missing.length > 0) {
  console.error(`[check-pack] tarball is missing: ${missing.join(', ')}`)
  process.exit(1)
}
console.log(`[check-pack] ok: ${packed.entryCount} files packed; templates + lib + bundle patch present`)
