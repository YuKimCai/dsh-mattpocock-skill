/**
 * Skill tree synchronization.
 *
 * The package ships the 27 converted skills under `skills/`. A profile install
 * lives inside `node_modules`, which is a bad place for files a person may want
 * to read or adapt (Matt Pocock's whole point is that these are small enough to
 * hack on). So the plugin copies the tree into the DSH home once per package
 * version, and the preset composition points `skill-filesystem` at that copy.
 *
 * The copy is one-way and versioned: the shipped bytes always win when the
 * version changes, and an identical version is a no-op so the copy survives a
 * restart untouched. Anyone who edits a skill and wants it kept should copy the
 * skill into a user root (`$DSH_HOME/skills`, `$DSH_AGENTS_HOME/skills`, or a
 * project `.dsh/skills`), which outranks this root.
 *
 * @module dsh-mattpocock-skills/sync
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Marker recording which package version produced the current copy. */
const STAMP_FILE = '.dsh-mattpocock-skills.json'

/** Every skill directory name under one root, sorted. */
function listSkillDirs(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort()
}

function readStamp(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, STAMP_FILE), 'utf8'))
  } catch {
    return null
  }
}

/**
 * Copy the packaged skill tree to `targetDir` when the recorded version differs.
 * @param options.source - absolute `skills/` directory inside this package.
 * @param options.target - absolute destination root.
 * @param options.version - package version string.
 * @param options.force - copy even when the stamp matches.
 * @returns what happened, plus the skill names now present.
 */
export function syncSkills({ source, target, version, force = false }) {
  if (!existsSync(source)) return { action: 'missing-source', source, target, skills: [] }
  const stamp = readStamp(target)
  const current = stamp?.version === version && stamp?.source === source
  if (current && !force) return { action: 'up-to-date', source, target, skills: listSkillDirs(target), version }
  mkdirSync(target, { recursive: true })
  for (const name of listSkillDirs(target)) rmSync(join(target, name), { recursive: true, force: true })
  for (const name of listSkillDirs(source)) cpSync(join(source, name), join(target, name), { recursive: true })
  writeFileSync(join(target, STAMP_FILE), JSON.stringify({
    version,
    source,
    syncedAt: new Date().toISOString(),
    skills: listSkillDirs(target)
  }, null, 2), 'utf8')
  return { action: stamp === null ? 'installed' : 'updated', source, target, skills: listSkillDirs(target), version }
}

/**
 * Report a skill root without touching it: which names it holds and whether the
 * copy is the one this package version made.
 * @param target - absolute skill root.
 * @param version - current package version.
 */
export function inspectSkills(target, version) {
  const stamp = readStamp(target)
  return {
    target,
    exists: existsSync(target),
    synced: stamp?.version === version,
    version: stamp?.version ?? null,
    skills: listSkillDirs(target)
  }
}
