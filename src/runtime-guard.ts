/**
 * Fail fast with an actionable message before `node:sqlite` is imported.
 * Import this module first in every public entry point that reaches schema.ts.
 */
const [major, minor] = process.versions.node.split('.').map(Number)
if (major < 22 || (major === 22 && minor < 13)) {
  throw new Error(
    `ForeSight requires Node.js >= 22.13 (node:sqlite is unflagged from 22.13); current runtime is ${process.versions.node}. Upgrade dsh/Electron or run on a newer Node.`,
  )
}

export {}
