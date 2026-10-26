import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { execFileSync } from 'node:child_process'

const script = path.join(process.cwd(), 'scripts', 'migrate-policy.mjs')

test('migrate-policy: dry run does not mutate docs; --write backs up and merges', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'foresight-migrate-'))
  fs.writeFileSync(path.join(root, 'policy.yaml'), 'foresight:\n  policy_version: 3\n  permission:\n    user_doc_writer: derive\n')
  fs.writeFileSync(path.join(root, 'user.md'), '- old trait\n')
  fs.writeFileSync(path.join(root, 'IMPORTANT.md'), '- new trait\n')
  try {
    const dry = execFileSync(process.execPath, [script, root], { encoding: 'utf8' })
    assert.match(dry, /dry run/)
    assert.equal(fs.readFileSync(path.join(root, 'IMPORTANT.md'), 'utf8'), '- new trait\n', 'dry run leaves docs untouched')
    assert.equal(fs.readFileSync(path.join(root, 'user.md'), 'utf8'), '- old trait\n')
    assert.ok(fs.readdirSync(root).some((f) => f.startsWith('policy.yaml.v4-')), 'dry run writes a reviewable policy preview')

    const written = execFileSync(process.execPath, [script, root, '--write'], { encoding: 'utf8' })
    assert.match(written, /merged user\.md/)
    const important = fs.readFileSync(path.join(root, 'IMPORTANT.md'), 'utf8')
    assert.ok(important.includes('old trait'))
    assert.ok(important.includes('new trait'))
    assert.ok(fs.readdirSync(root).some((f) => f.startsWith('policy.yaml.bak-')), 'policy backed up')
    assert.ok(fs.readdirSync(root).some((f) => f.startsWith('IMPORTANT.md.bak-')), 'IMPORTANT backed up')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
