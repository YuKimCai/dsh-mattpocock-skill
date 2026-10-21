/**
 * dsh-mattpocock-skills — Matt Pocock's agent skills as a DeepSeek Harness agent.
 *
 * What this plugin owns:
 *
 * 1. **The skill tree.** The 27 promoted skills from `mattpocock/skills`
 *    (23 model-invoked, 4 user-invoked), converted from Claude Code's tool
 *    vocabulary to this harness's. They ship in the package and are copied to
 *    `$DSH_HOME/mattpocock-skills/skills` once per version, so a profile install
 *    keeps readable skill files outside `node_modules`.
 *
 * 2. **The agent preset.** `presets/mattpocock/agent.cordis.yml` is a real
 *    agent-plane composition: persona, instructions, bash/fs/search/jobs, the
 *    skill registry plus the `skill` loader, goals, plan mode, compaction,
 *    subagents, ask-user, todo, web and present. It is declared to
 *    `ctx.agentPresets.register()` once that registry exists, because the
 *    harness does NOT scan a directory for presets: a preset exists only after
 *    a plugin declares it.
 *
 * 3. **Runtime status.** `GET/POST /mattpocock-skills/status` on the loopback
 *    Web server reports the install, the preset, the skill root and the skill
 *    roster, and can re-sync the tree. It deliberately avoids the `/api`
 *    namespace, which the Web client's connection owns and gates.
 *
 * Both services are acquired with `ctx.inject([...])`: on a host plane the
 * registry and the web server come up after ordinary rows, so reading them
 * eagerly during `apply` would see nothing.
 *
 * @module dsh-mattpocock-skills
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readPresetDefinition } from './composition.js'
import { inspectSkills, syncSkills } from './sync.js'

export const name = 'mattpocock-skills'
export const inject = []
export const reusable = false

/** Preset identity saved by sessions. */
export const PRESET_ID = 'mattpocock'
/** Status route on the loopback Web server. */
export const API_PREFIX = '/mattpocock-skills/status'

/** Absolute package root, independent of how the module was loaded. */
const PACKAGE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Package version, recorded in the sync stamp. */
function packageVersion() {
  try {
    return JSON.parse(readFileSync(join(PACKAGE_DIR, 'package.json'), 'utf8')).version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

/** Resolve the DSH home without requiring the host's own helper. */
function resolveHome(ctx) {
  try {
    if (typeof ctx.dshHomePath === 'function') return ctx.dshHomePath()
  } catch {
    /* fall through */
  }
  return process.env.DSH_HOME || join(process.env.HOME ?? '.', '.dsh')
}

/** Read the current roster row for this preset, including its failure reason. */
async function describePreset(registry) {
  if (registry === undefined) return { available: false, reason: 'this composition has no agentPresets registry' }
  try {
    const row = (await registry.list()).find((candidate) => candidate.id === PRESET_ID)
    if (row === undefined) return { available: false, reason: 'not in the roster' }
    return {
      available: row.broken === undefined || row.broken === null,
      name: row.name,
      description: row.description,
      broken: row.broken ?? null
    }
  } catch (error) {
    return { available: false, reason: error instanceof Error ? error.message : String(error) }
  }
}

/** Read the catalog this agent would see, so the report proves the skills load. */
async function describeSkills(ctx, skillDir) {
  const skills = (() => {
    try {
      return typeof ctx.get === 'function' ? ctx.get('skills') : ctx.skills
    } catch {
      return undefined
    }
  })()
  if (skills === undefined) return { catalogued: false, error: 'this composition has no skills registry' }
  try {
    const snapshot = await skills.snapshot({ cwd: process.cwd() })
    const mine = snapshot.skills.filter((skill) => skill.resourceBase?.kind === 'directory' && skill.resourceBase.path.startsWith(skillDir))
    return {
      catalogued: snapshot.complete,
      total: snapshot.skills.length,
      packaged: mine.map((skill) => ({
        name: skill.name,
        modelInvocable: skill.invocation.modelInvocable,
        userInvocable: skill.invocation.userInvocable
      }))
    }
  } catch (error) {
    return { catalogued: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export function apply(ctx, config = {}) {
  const version = packageVersion()
  const home = resolveHome(ctx)
  const skillRoot = config.skillRoot ?? join(home, 'mattpocock-skills', 'skills')
  const packedSkills = join(PACKAGE_DIR, 'skills')
  const presetDir = join(PACKAGE_DIR, 'presets', PRESET_ID)

  const status = {
    package: { version, dir: PACKAGE_DIR },
    skills: { source: packedSkills, root: skillRoot, sync: null },
    preset: { id: PRESET_ID, dir: presetDir, registered: false, reason: null }
  }

  /* 1. Materialize the skill tree outside node_modules. */
  try {
    status.skills.sync = syncSkills({
      source: packedSkills,
      target: skillRoot,
      version,
      force: config.resyncSkills === true
    })
  } catch (error) {
    status.skills.sync = { action: 'failed', error: error instanceof Error ? error.message : String(error) }
    ctx.logger?.warn?.('mattpocock-skills: skill sync failed: %s', status.skills.sync.error)
  }

  /* 2. Declare the agent preset once the registry is on this context. The
   *    registry mounts the definition eagerly; a mount failure stays visible in
   *    the roster and in this plugin's status instead of taking the profile
   *    down. */
  ctx.inject(['agentPresets'], (scoped) => {
    scoped.effect(() => {
      let cancelled = false
      let disposePreset
      const declare = async () => {
        let definition
        try {
          definition = readPresetDefinition(PRESET_ID, presetDir, skillRoot)
        } catch (error) {
          status.preset.reason = `composition refused: ${error instanceof Error ? error.message : String(error)}`
          scoped.logger?.warn?.('mattpocock-skills: %s', status.preset.reason)
          return
        }
        try {
          const dispose = await scoped.agentPresets.register(definition)
          if (cancelled) {
            await dispose()
            return
          }
          disposePreset = dispose
          status.preset.registered = true
          status.preset.reason = null
          scoped.logger?.info?.('mattpocock-skills: preset "%s" declared (%s rows)', PRESET_ID, definition.plugins.length)
        } catch (error) {
          status.preset.reason = `register refused: ${error instanceof Error ? error.message : String(error)}`
          scoped.logger?.warn?.('mattpocock-skills: %s', status.preset.reason)
        }
      }
      declare().catch((error) => {
        status.preset.reason = error instanceof Error ? error.message : String(error)
      })
      return () => {
        cancelled = true
        const dispose = disposePreset
        disposePreset = undefined
        status.preset.registered = false
        if (dispose !== undefined) Promise.resolve(dispose()).catch(() => {})
      }
    }, 'mattpocock-skills.preset')
  })

  /* 3. Report over HTTP when this composition has a web server. */
  ctx.inject(['webServer'], (scoped) => {
    scoped.effect(() => {
      const send = (res, code, body) => {
        res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify(body, null, 2))
      }

      const report = async () => {
        const registry = (() => {
          try {
            return scoped.get('agentPresets')
          } catch {
            return undefined
          }
        })()
        return {
          ok: status.preset.registered,
          ...status,
          preset: { ...status.preset, ...(await describePreset(registry)) },
          skills: {
            ...status.skills,
            info: inspectSkills(skillRoot, version),
            catalog: await describeSkills(scoped, skillRoot)
          }
        }
      }

      return scoped.webServer.register({
        kind: 'exact',
        path: API_PREFIX,
        handler: async (req, res) => {
          if (req.method === 'GET') return send(res, 200, await report())
          if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method-not-allowed' })
          let body = ''
          for await (const chunk of req) {
            body += chunk
            if (body.length > 4096) return send(res, 413, { ok: false, error: 'payload-too-large' })
          }
          let parsed = {}
          try {
            parsed = body.trim() === '' ? {} : JSON.parse(body)
          } catch {
            return send(res, 400, { ok: false, error: 'invalid-json' })
          }
          if (parsed.action !== 'resync') return send(res, 400, { ok: false, error: 'unknown-action' })
          try {
            status.skills.sync = syncSkills({ source: packedSkills, target: skillRoot, version, force: true })
          } catch (error) {
            return send(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
          }
          return send(res, 200, await report())
        }
      })
    }, 'mattpocock-skills.http')
  })

  ctx.logger?.info?.(
    'mattpocock-skills %s: skills synced to %s (%s)',
    version,
    skillRoot,
    status.skills.sync?.action ?? 'unknown'
  )
}

export { readPresetDefinition, readCordisYaml, readPresetMetadata, CompositionError } from './composition.js'
export { syncSkills, inspectSkills } from './sync.js'
