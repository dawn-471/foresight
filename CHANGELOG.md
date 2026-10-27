# Changelog

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
