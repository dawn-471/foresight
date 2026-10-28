# Changelog

## 0.2.2 — 2026-10-28

### Fixed

- **dsh v4 session compatibility for nudge messages**: maintenance reminders
  now carry a stable message id and a producer-owned source kind
  (`plugin:foresight-nudge`) instead of the retired shared `plugin` kind.
  Current dsh durable session encoders reject the old shape, which could stall
  checkpoints and prevent the session from being restored.
- **Correct session lifecycle hook**: current dsh treats `session/flush` as a
  durability checkpoint rather than session end. ForeSight now uses
  `session/disposed` for the session-end derive hook, returns the checkpoint
  promise from `session/flush`, and no longer triggers derive on every flush.
- **`derive.trigger: session_end`**: turn-based derive is now suppressed for
  both `session` and `session_end` trigger spellings.
- **Plugin reload cleanup**: nudge and inject listeners now retain and dispose
  their cordis registrations, preventing duplicate listeners after HMR/plugin
  reload.
- **Literal memory text in system prompts**: ForeSight sections opt out of dsh
  prompt-variable interpolation, so memory/SOUL text containing `{{...}}`
  cannot break prompt assembly.

### Verification

- 177 unit/integration tests pass; the packed-tarball check passes.
- Verified against dsh 0.2.1-rc.3 on Node 24 and the desktop Electron runtime
  (Node 24.21).

## 0.2.1 — 2026-10-27

### Fixed

- Tool registration now emits raw object-rooted JSON Schema for `parameters`
  instead of the `defineTool` authoring DSL. Newer dsh releases validate the
  model-facing schema strictly, which rejected `memory_delete` (and the other
  memory tools) with `schema must be a JSON Schema of type: "object"`.
- Added a regression test asserting every memory tool exposes object-rooted
  parameters with matching `required` entries.

## 0.2.0 — 2026-10-25

### Packaging / install

- `templates/` and `scripts/migrate-policy.mjs` are included in the published
  tarball; `prepare` builds `lib/` before packing/git install.
- First run seeds a missing `policy.yaml` (always) and `SOUL.md`/`IMPORTANT.md`
  (new data directory only) from the packaged templates; existing files are
  never overwritten.
- `memoryRoot` no longer defaults to a cwd-relative `./memory`: explicit config
  → `FORESIGHT_MEMORY_DIR` → platform default. The bundle patch no longer pins
  `memoryRoot`; profile overrides remain supported.
- Added npm metadata and the `./policy` export; version bumped for the v4 policy
  change.
- README: install from a release tarball, full uninstall steps, compatibility
  matrix, data-directory change note.

### Upgrade / compatibility

- `policy_version: 3` files load with an in-memory v4 mapping (v4-only keys are
  filled from the shipped template) and a warning; `scripts/migrate-policy.mjs`
  rewrites the file with a backup and merges a legacy `user.md`.
- `IMPORTANT.md` and legacy `user.md` are merged (deduplicated) instead of the
  new file shadowing the old profile.
- Runtime guard fails fast with an actionable message below Node 22.13.
- `sqlite-vec` load failure degrades to FTS + stored-embedding cosine
  (`vecEnabled=false`) instead of disabling the whole plugin.

### Verification

- 172 unit tests pass.
- Ollama embedding calls use a circuit breaker; Windows defaults to
  `%LOCALAPPDATA%/foresight` while preserving an existing Roaming data dir.
- vec-disabled fallback now uses exact cosine over stored embeddings for
  candidate retrieval and conflict resolution, and backfills the vec table on
  reopen.
- `scripts/check-pack.mjs` asserts `lib/`, `templates/`, the migration script,
  and the bundle patch are present in the tarball; wired into CI.
- Tarball install (npm and pnpm) mounts against an empty data directory with
  `vecEnabled=true`.
