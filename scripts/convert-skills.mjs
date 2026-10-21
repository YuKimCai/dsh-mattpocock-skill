#!/usr/bin/env node
/**
 * Re-port upstream mattpocock/skills into this package.
 *
 *   git clone --depth 1 https://github.com/mattpocock/skills.git ../mp-skills-src
 *   node scripts/convert-skills.mjs ../mp-skills-src
 *
 * Two passes, in this order:
 *
 *   1. COPY the 27 promoted skills (skills/engineering/*, skills/productivity/*)
 *      into ./skills/, minus the Codex-only agents/openai.yaml.
 *   2. REWRITE only the places where Claude Code's vocabulary does not exist in
 *      DeepSeek Harness. Every rule is an exact whole-line or whole-phrase
 *      substitution taken from upstream text, so skill prose stays byte for
 *      byte everywhere else. A rule that no longer matches is REPORTED, not
 *      silently skipped: upstream drift is something a human should see.
 *
 * Run scripts/verify-skills.mjs afterwards; it must still report 27 skills.
 */
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(here, '..')
const upstream = resolve(process.argv[2] ?? join(packageRoot, '..', 'mp-skills-src'))
const target = join(packageRoot, 'skills')

if (!existsSync(join(upstream, 'skills'))) {
  console.error(`no upstream skills/ under ${upstream}`)
  console.error('clone it first: git clone --depth 1 https://github.com/mattpocock/skills.git ' + upstream)
  process.exit(1)
}

/** The two promoted buckets. misc/, in-progress/ and deprecated/ are excluded. */
const BUCKETS = ['engineering', 'productivity']

/**
 * Platform adaptation table.
 *
 * Each entry is [file, exact upstream text, exact replacement, why]. Rules run
 * in array order, so a longer phrase must precede the shorter one it contains.
 * The shipped files differ from upstream ONLY by these substitutions.
 */
const RULES = [
  // ---- ask-matt/PHASE-BOUNDARIES.md ----
  ['ask-matt/PHASE-BOUNDARIES.md',
    '| **`/clear`** | Empty the context window and start from nothing.                  |',
    '| **New session** | Start a fresh session in the same workspace and let this one end. The old session stays resumable. |',
    'DSH has no /clear command'],
  ['ask-matt/PHASE-BOUNDARIES.md',
    '| **Subagent** | Send the task to its own context window and get a report back.     |',
    '| **Subagent** (`subagent` tool) | Send the task to its own context window and get a report back. |',
    'name the DSH tool'],
  ['ask-matt/PHASE-BOUNDARIES.md',
    'If so, **`/clear`**. It is the cheapest move on the board: it takes no time and hands back the whole window. `/clear` also isn\'t terminal: the old session stays resumable.',
    'If so, start a **new session**. It is the cheapest move on the board: it takes no time and hands back the whole window. It also isn\'t terminal: the old session stays resumable.',
    'DSH has no /clear command'],
  ['ask-matt/PHASE-BOUNDARIES.md',
    '- swapping to a **new harness** (Claude → Codex),',
    '- swapping to a **new harness** (Claude Code → DeepSeek Harness, or back),',
    'this port makes DSH the counterpart'],
  ['ask-matt/PHASE-BOUNDARIES.md',
    'Then send it to a **subagent** and leave this session untouched.',
    'Then send it to a **subagent** with the `subagent` tool (background mode) and leave this session untouched.',
    'name the DSH tool and its background mode'],
  ['ask-matt/PHASE-BOUNDARIES.md',
    '| Secondary (`/compact`, `/handoff`) | Lossy       | Less  | Lots         |',
    '| Secondary (`/compact`, `/handoff`, new session) | Lossy | Less | Lots   |',
    'add the /clear replacement to the source table'],

  // ---- ask-matt/SKILL.md ----
  ['ask-matt/SKILL.md',
    '**`/clear`ing context between each one**',
    '**starting a new session between each one**',
    'DSH has no /clear command'],
  ['ask-matt/SKILL.md',
    "Keep steps 1–3 in **one unbroken context window** (don't compact or clear until after `/to-tickets`)",
    "Keep steps 1–3 in **one unbroken context window** (don't compact and don't start a new session until after `/to-tickets`)"],
  ['ask-matt/SKILL.md',
    "Run `/retro` in the session it's looking back on, before you clear; after clearing, point it at that session's log instead.",
    "Run `/retro` in the session it's looking back on, before you leave it; from a new session, point it at that session's log instead."],
  ['ask-matt/SKILL.md',
    "- **`/clear`**: empty the window, when nothing here matters to what's next.",
    "- **New session**: open a fresh one when nothing here matters to what's next. The old session stays resumable."],
  ['ask-matt/SKILL.md',
    '- **Subagent**: send a tightly-scoped task to its own window and get a report back.',
    '- **Subagent**: send a tightly-scoped task to its own window with the `subagent` tool and get a report back.'],

  // ---- every other skill: the two generic vocabulary swaps ----
  ['*', 'Skill tool', '`skill` tool', 'DSH exposes skills through the native skill tool']
]

let copied = 0
for (const bucket of BUCKETS) {
  const bucketDir = join(upstream, 'skills', bucket)
  if (!existsSync(bucketDir)) continue
  for (const entry of readdirSync(bucketDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const source = join(bucketDir, entry.name)
    if (!existsSync(join(source, 'SKILL.md'))) continue
    const destination = join(target, entry.name)
    rmSync(destination, { recursive: true, force: true })
    cpSync(source, destination, {
      recursive: true,
      filter: (path) => !path.endsWith('/agents') && !path.endsWith('/agents/openai.yaml')
    })
    copied += 1
  }
}

/** Every markdown file under skills/, as paths relative to skills/. */
function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(path))
    else if (entry.name.endsWith('.md')) out.push(path)
  }
  return out
}

const files = walk(target)
let changed = 0
const drifted = []

for (const rule of RULES) {
  const [scope, from, to, why] = rule
  const targets = scope === '*' ? files : files.filter((file) => relative(target, file) === scope)
  if (targets.length === 0) {
    drifted.push(`${scope}: file not found`)
    continue
  }
  let hits = 0
  for (const file of targets) {
    const before = readFileSync(file, 'utf8')
    if (!before.includes(from)) continue
    writeFileSync(file, before.split(from).join(to), 'utf8')
    hits += 1
    changed += 1
    console.log(`rewrote ${relative(packageRoot, file)}${why === undefined ? '' : '  (' + why + ')'}`)
  }
  if (hits === 0) drifted.push(`${scope}: pattern no longer present -> ${JSON.stringify(from.slice(0, 60))}`)
}

console.log(`\ncopied ${copied} skills | applied ${changed} rewrites`)
if (drifted.length > 0) {
  console.log('\nUPSTREAM DRIFT — upstream changed under these rules, review by hand:')
  for (const line of drifted) console.log('  ! ' + line)
  process.exitCode = 2
} else {
  console.log('no drift: every rule still matched upstream')
}
console.log('now run: node scripts/verify-skills.mjs')
