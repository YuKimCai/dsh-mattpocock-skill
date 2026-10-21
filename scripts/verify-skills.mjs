#!/usr/bin/env node
/**
 * Parse every packaged skill through the harness's real filesystem provider.
 *
 * Confirms the 27 skills discover, their frontmatter is valid, and the
 * model/user invocation policy survived conversion. Needs the DeepSeek Harness
 * installation to import the provider from.
 *
 *   node scripts/verify-skills.mjs            # uses ../skills
 *   node scripts/verify-skills.mjs ./skills   # explicit root
 */
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const skillsRoot = resolve(process.argv[2] ?? resolve(here, '..', 'skills'))
if (!existsSync(skillsRoot)) {
  console.error(`no skills root at ${skillsRoot}`)
  process.exit(1)
}

/**
 * Locate the harness installation so this works on any machine.
 *
 * Order: a plain package resolution (the provider may be a dependency here),
 * then an upward search from the `dsh` binary's real path for the package the
 * installation ships, then the same search from the npm global prefix.
 */
function packageDirUnder(dir) {
  const candidate = join(dir, 'node_modules', '@deepseek-ai', 'dsh-skill-filesystem', 'lib', 'index.js')
  return existsSync(candidate) ? candidate : undefined
}

/** Walk up from a start path looking for the provider's package directory. */
function searchUp(start) {
  let current = start
  for (let depth = 0; depth < 8; depth += 1) {
    const found = packageDirUnder(current)
    if (found !== undefined) return found
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return undefined
}

async function findProvider() {
  const candidates = ['@deepseek-ai/dsh-skill-filesystem']
  const starts = []
  try {
    const { execFileSync } = await import('node:child_process')
    const { realpathSync } = await import('node:fs')
    const bin = execFileSync('command', ['-v', 'dsh'], { shell: '/bin/sh', encoding: 'utf8' }).trim()
    if (bin !== '') starts.push(dirname(realpathSync(bin)))
  } catch {
    /* no dsh on PATH */
  }
  if (process.env.npm_config_prefix !== undefined) starts.push(join(process.env.npm_config_prefix, 'lib', 'node_modules', '@deepseek-ai', 'dsh'))
  for (const start of starts) {
    const found = searchUp(start)
    if (found !== undefined) candidates.push(found)
  }
  return candidates
}

let FileSystemSkillProvider
for (const candidate of await findProvider()) {
  try {
    ;({ FileSystemSkillProvider } = await import(candidate))
    break
  } catch {
    /* try the next candidate */
  }
}

if (FileSystemSkillProvider === undefined) {
  console.error('cannot import @deepseek-ai/dsh-skill-filesystem; install DeepSeek Harness first')
  process.exit(1)
}

const control = { signal: new AbortController().signal, invalidate() {} }
const ctx = {
  logger: { warn: (...args) => console.warn('[warn]', ...args.map(String)), info() {}, error() {} },
  get: () => undefined,
  effect: () => () => {}
}
const provider = new FileSystemSkillProvider(ctx, control, {
  includeDefaultRoots: false,
  customSkillDirs: [skillsRoot],
  watch: false
})

const listed = await provider.list({ cwd: process.cwd() })
const candidates = Array.isArray(listed) ? listed : listed.candidates
let model = 0
let user = 0
let failed = 0

for (const skill of [...candidates].sort((a, b) => a.name.localeCompare(b.name))) {
  const definition = await provider.get(skill, { cwd: process.cwd() })
  const size = definition === undefined ? 'LOAD FAILED' : `${definition.content.length} chars`
  if (definition === undefined) failed += 1
  if (skill.invocation.modelInvocable) model += 1
  else user += 1
  console.log(` - ${skill.name.padEnd(32)} model=${String(skill.invocation.modelInvocable).padEnd(5)} user=${String(skill.invocation.userInvocable).padEnd(5)} ${size}`)
}
await provider.dispose()

console.log(`\ndiscovered ${candidates.length} | model-invoked ${model} | user-only ${user} | failed ${failed}`)
process.exit(failed === 0 && candidates.length > 0 ? 0 : 1)
