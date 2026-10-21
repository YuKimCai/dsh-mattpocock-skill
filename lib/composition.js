/**
 * Agent-preset composition reader.
 *
 * A DeepSeek Harness agent preset is an ordinary Cordis entry list declared to
 * `ctx.agentPresets.register()`. This module reads the composition this package
 * ships (`presets/<id>/agent.cordis.yml`) plus the flat display map beside it
 * (`preset.yml`) and turns both into that declaration.
 *
 * The supported YAML subset is exactly what the shipped composition uses: block
 * maps, block sequences, plain and quoted scalars, single-line flow sequences,
 * literal block scalars (`|`), comments, and `!!js` expressions preserved as
 * data in the shape the Loader itself hands a plugin (`{ __jsExpr }`).
 *
 * Fail-closed: anchors, aliases, tags other than `!!js`, nested flow
 * collections, tabs in indentation and multiple documents raise
 * {@link CompositionError} instead of being guessed at, so an unreadable
 * composition is refused rather than half-declared.
 *
 * Relative module names (`name: ./some-plugin.mjs`) resolve against the preset
 * directory and are emitted as file URLs: the registry mounts a declaration
 * under the DECLARING plugin's base URL, so a bare relative name would resolve
 * outside this package.
 *
 * @module dsh-mattpocock-skills/composition
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** A construct outside the supported subset, or malformed YAML. */
export class CompositionError extends Error {
  constructor(message) {
    super(message)
    this.name = 'CompositionError'
  }
}

const BLANK_OR_COMMENT_RE = /^[ \t]*(?:#.*)?$/
const INTEGER_RE = /^[+-]?\d+$/
const FLOAT_RE = /^[+-]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?$/

/** The indentation width of one line. */
function indentOf(line) {
  const match = /^ */.exec(line)
  return match === null ? 0 : match[0].length
}

/** The indentation of one structurally significant line; tabs are refused. */
function significantIndent(line, lineNumber) {
  const leading = /^[ \t]*/.exec(line)?.[0] ?? ''
  if (leading.includes('\t')) throw new CompositionError(`line ${String(lineNumber)}: tabs must not be used for indentation`)
  return leading.length
}

function skipInsignificant(cursor) {
  while (cursor.index < cursor.lines.length && BLANK_OR_COMMENT_RE.test(cursor.lines[cursor.index] ?? '')) cursor.index += 1
}

/** Whether a line at `indent` opens a block sequence entry. */
function isSequenceEntry(line, indent) {
  if (line[indent] !== '-') return false
  return line.length === indent + 1 || line[indent + 1] === ' '
}

/** The index of the quote that closes a quoted scalar starting at index 0. */
function closingQuote(text) {
  const quote = text[0]
  for (let index = 1; index < text.length; index += 1) {
    const char = text[index]
    if (quote === '"' && char === '\\') {
      index += 1
      continue
    }
    if (quote === "'" && char === "'" && text[index + 1] === "'") {
      index += 1
      continue
    }
    if (char === quote) return index
  }
  return -1
}

/** Resolve one quoted scalar, or return the text unchanged when unquoted. */
function unquote(text) {
  const trimmed = text.trim()
  if (trimmed.startsWith('"')) {
    const end = closingQuote(trimmed)
    if (end !== trimmed.length - 1) throw new CompositionError(`unterminated double-quoted scalar: ${trimmed}`)
    return trimmed.slice(1, end).replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (_, escape) => {
      switch (escape[0]) {
        case 'n': return '\n'
        case 't': return '\t'
        case 'r': return '\r'
        case '0': return '\0'
        case 'u':
        case 'x': return String.fromCharCode(Number.parseInt(escape.slice(1), 16))
        default: return escape
      }
    })
  }
  if (trimmed.startsWith("'")) {
    const end = closingQuote(trimmed)
    if (end !== trimmed.length - 1) throw new CompositionError(`unterminated single-quoted scalar: ${trimmed}`)
    return trimmed.slice(1, end).replaceAll("''", "'")
  }
  return trimmed
}

/** Split one block-map line into its key and the raw text after the colon. */
function matchKeyEntry(text) {
  if (text.startsWith("'") || text.startsWith('"')) {
    const end = closingQuote(text)
    if (end === -1) return undefined
    const after = text.slice(end + 1).trimStart()
    if (!after.startsWith(':')) return undefined
    return {
      key: unquote(text.slice(0, end + 1)),
      rest: after.slice(1).trim()
    }
  }
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char === '#' && index > 0 && text[index - 1] === ' ') break
    if (char === ':' && (index + 1 === text.length || text[index + 1] === ' ')) return {
      key: text.slice(0, index),
      rest: text.slice(index + 1).trim()
    }
  }
  return undefined
}

/** Resolve a plain scalar to the value YAML's JSON schema would produce. */
function plainScalar(text) {
  const comment = text.indexOf(' #')
  const value = (comment === -1 ? text : text.slice(0, comment)).trim()
  if (value === '' || value === '~' || value === 'null' || value === 'Null' || value === 'NULL') return null
  if (value === 'true' || value === 'True' || value === 'TRUE') return true
  if (value === 'false' || value === 'False' || value === 'FALSE') return false
  if (INTEGER_RE.test(value)) return Number(value)
  if (FLOAT_RE.test(value)) return Number(value)
  return value
}

/** Read one single-line flow sequence into its scalar items. */
function readFlowSequence(text, lineNumber) {
  const inner = text.slice(1, -1)
  const items = []
  let index = 0
  while (index < inner.length) {
    const char = inner[index]
    if (char === ' ' || char === ',') {
      index += 1
      continue
    }
    if (char === '[' || char === '{' || char === ']' || char === '}') {
      throw new CompositionError(`line ${String(lineNumber)}: nested flow collections are outside the supported subset`)
    }
    if (char === "'" || char === '"') {
      const end = closingQuote(inner.slice(index))
      if (end === -1) throw new CompositionError(`line ${String(lineNumber)}: unterminated quoted scalar inside a flow sequence`)
      items.push(unquote(inner.slice(index, index + end + 1)))
      index += end + 1
      continue
    }
    const stop = inner.slice(index).search(/[,\]]/)
    const piece = stop === -1 ? inner.slice(index) : inner.slice(index, index + stop)
    items.push(plainScalar(piece))
    index += piece.length
  }
  return items
}

/** Read one literal block scalar (`|`) starting after the indicator line. */
function readBlockScalar(cursor, parentIndent, chomp) {
  const collected = []
  let contentIndent
  while (cursor.index < cursor.lines.length) {
    const line = cursor.lines[cursor.index] ?? ''
    if (line.trim() === '') {
      collected.push('')
      cursor.index += 1
      continue
    }
    const indent = significantIndent(line, cursor.index + 1)
    if (indent <= parentIndent) break
    if (contentIndent === undefined) contentIndent = indent
    collected.push(line.slice(contentIndent))
    cursor.index += 1
  }
  while (collected.length > 0 && collected[collected.length - 1] === '') collected.pop()
  const body = collected.join('\n')
  if (chomp === '-') return body
  return body === '' ? '' : `${body}\n`
}

/** Read one `!!js` expression node into the shape the Loader hands a plugin. */
function readJsExpression(text, lineNumber) {
  let body = text.slice(4).trim()
  if (body === '') throw new CompositionError(`line ${String(lineNumber)}: !!js requires an expression on the same line`)
  if (body.startsWith('"') || body.startsWith("'")) body = unquote(body)
  return { __jsExpr: body }
}

/** Read the scalar after `key:`, dispatching on tags, flows and block scalars. */
function readScalarOrBlock(cursor, raw, parentIndent, lineNumber) {
  const text = raw.trim()
  if (text.startsWith('!!js')) return readJsExpression(text, lineNumber)
  if (text.startsWith('[')) {
    if (!text.endsWith(']')) throw new CompositionError(`line ${String(lineNumber)}: a flow sequence must close on its own line`)
    return readFlowSequence(text, lineNumber)
  }
  if (text.startsWith('{')) throw new CompositionError(`line ${String(lineNumber)}: flow mappings are outside the supported subset`)
  if (text === '|' || text === '|-' || text === '|+') {
    if (text === '|+') throw new CompositionError(`line ${String(lineNumber)}: keep-chomp block scalars are outside the supported subset`)
    return readBlockScalar(cursor, parentIndent, text === '|-' ? '-' : '')
  }
  if (text.startsWith('&') || text.startsWith('*')) throw new CompositionError(`line ${String(lineNumber)}: anchors and aliases are outside the supported subset`)
  if (text.startsWith('!')) throw new CompositionError(`line ${String(lineNumber)}: only the !!js tag is supported`)
  if (text.startsWith('"') || text.startsWith("'")) return unquote(text)
  return plainScalar(text)
}

/** Parse a block node (map or sequence) at one indentation. */
function parseNode(cursor, indent) {
  skipInsignificant(cursor)
  if (cursor.index >= cursor.lines.length) return null
  const line = cursor.lines[cursor.index] ?? ''
  const actual = significantIndent(line, cursor.index + 1)
  if (actual < indent) return null
  if (isSequenceEntry(line, actual)) return parseSequence(cursor, actual)
  return parseMap(cursor, actual)
}

function parseSequence(cursor, indent) {
  const items = []
  while (cursor.index < cursor.lines.length) {
    skipInsignificant(cursor)
    if (cursor.index >= cursor.lines.length) break
    const line = cursor.lines[cursor.index] ?? ''
    const actual = significantIndent(line, cursor.index + 1)
    if (actual !== indent || !isSequenceEntry(line, actual)) break
    const lineNumber = cursor.index + 1
    const after = line.slice(indent + 1)
    const rest = after.trim()
    cursor.index += 1
    if (rest === '') {
      items.push(parseNode(cursor, indent + 1))
      continue
    }
    if (rest.startsWith('- ')) throw new CompositionError(`line ${String(lineNumber)}: nested inline sequences are outside the supported subset`)
    const key = matchKeyEntry(rest)
    if (key === undefined) {
      items.push(readScalarOrBlock(cursor, rest, indent, lineNumber))
      continue
    }
    // A mapping that begins on the sequence-entry line: re-enter the map reader
    // one column in, with the first pair already consumed.
    const inlineIndent = indent + 1 + (after.length - after.trimStart().length)
    const entry = {}
    const inlineValue = key.rest
    if (inlineValue === '') {
      const child = parseNode(cursor, inlineIndent + 1)
      entry[key.key] = child
    } else {
      entry[key.key] = readScalarOrBlock(cursor, inlineValue, inlineIndent, lineNumber)
    }
    const more = parseMap(cursor, inlineIndent, entry)
    items.push(more)
  }
  return items
}

function parseMap(cursor, indent, seed) {
  const map = seed ?? {}
  while (cursor.index < cursor.lines.length) {
    skipInsignificant(cursor)
    if (cursor.index >= cursor.lines.length) break
    const line = cursor.lines[cursor.index] ?? ''
    const actual = significantIndent(line, cursor.index + 1)
    const lineNumber = cursor.index + 1
    if (actual < indent) break
    if (actual > indent) throw new CompositionError(`line ${String(lineNumber)}: unexpected indentation`)
    if (isSequenceEntry(line, actual)) break
    const key = matchKeyEntry(line.slice(indent))
    if (key === undefined) throw new CompositionError(`line ${String(lineNumber)}: expected a "key: value" mapping entry`)
    cursor.index += 1
    if (key.rest === '') {
      const child = parseNode(cursor, indent + 1)
      map[key.key] = child
      continue
    }
    map[key.key] = readScalarOrBlock(cursor, key.rest, indent, lineNumber)
  }
  return map
}

/** Read one Cordis YAML document (or the flat map of `preset.yml`). */
export function readCordisYaml(text) {
  const cursor = {
    lines: (text.startsWith('\uFEFF') ? text.slice(1) : text).split('\n'),
    index: 0
  }
  const value = parseNode(cursor, 0)
  skipInsignificant(cursor)
  const extra = cursor.lines[cursor.index]
  if (extra !== undefined) throw new CompositionError(`line ${String(cursor.index + 1)}: unexpected content "${extra.trim()}"`)
  return value
}

function asRecord(value, what) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new CompositionError(`${what} must be a mapping`)
  return value
}

/** Read the single-line display scalars of one `preset.yml`. */
export function readPresetMetadata(text) {
  const record = asRecord(readCordisYaml(text), 'preset.yml')
  const metadata = {}
  for (const field of ['name', 'description', 'icon']) {
    const value = record[field]
    if (value === undefined || value === null) continue
    if (typeof value !== 'string' || value.includes('\n')) throw new CompositionError(`preset.yml: ${field} must be a single-line string`)
    metadata[field] = value
  }
  if (record.order !== undefined && record.order !== null) {
    if (typeof record.order !== 'number' || !Number.isFinite(record.order)) throw new CompositionError('preset.yml: order must be a number')
    metadata.order = record.order
  }
  return metadata
}

/** Rewrite one row list's relative module names into absolute file URLs. */
function absolutizeRows(rows, baseDir, at = 'row') {
  return rows.map((row, index) => {
    const label = `${at} ${String(index + 1)}`
    const checked = asRecord(row, label)
    if (typeof checked.name !== 'string' || checked.name === '') throw new CompositionError(`${label} names no plugin (a "name" string is required)`)
    const out = { ...checked }
    if (checked.name.startsWith('./') || checked.name.startsWith('../')) out.name = pathToFileURL(resolve(baseDir, checked.name)).href
    if (checked.group === true) {
      if (!Array.isArray(checked.config)) throw new CompositionError(`group ${label} must hold a list of plugin rows`)
      out.config = absolutizeRows(checked.config, baseDir, `${label} group`)
    }
    return out
  })
}

/** Substitute the installer's absolute skill directory into one row list. */
function substituteSkillDir(rows, skillDir) {
  return rows.map((row) => {
    const out = { ...row }
    if (row.group === true && Array.isArray(row.config)) out.config = substituteSkillDir(row.config, skillDir)
    else if (row.config !== undefined && row.config !== null && typeof row.config === 'object' && !Array.isArray(row.config)) {
      out.config = substituteConfig(row.config, skillDir)
    }
    return out
  })
}

function substituteConfig(config, skillDir) {
  const out = {}
  for (const [key, value] of Object.entries(config)) {
    if (typeof value === 'string') out[key] = value.split('@SKILLS_DIR@').join(skillDir)
    else if (Array.isArray(value)) out[key] = value.map((item) => typeof item === 'string' ? item.split('@SKILLS_DIR@').join(skillDir) : item)
    else if (value !== null && typeof value === 'object' && !Array.isArray(value) && !('__jsExpr' in value)) out[key] = substituteConfig(value, skillDir)
    else out[key] = value
  }
  return out
}

/**
 * Read one preset directory into the declaration the registry takes.
 * @param id - preset identity.
 * @param dir - directory holding `agent.cordis.yml` and optionally `preset.yml`.
 * @param skillDir - absolute skills directory substituted for `@SKILLS_DIR@`.
 * @returns the definition for `ctx.agentPresets.register()`.
 */
export function readPresetDefinition(id, dir, skillDir) {
  let text
  try {
    text = readFileSync(join(dir, 'agent.cordis.yml'), 'utf8')
  } catch (error) {
    throw new CompositionError(`cannot read ${join(dir, 'agent.cordis.yml')}: ${error instanceof Error ? error.message : String(error)}`)
  }
  const rows = readCordisYaml(text)
  if (!Array.isArray(rows)) throw new CompositionError('agent.cordis.yml must be a top-level list of plugin rows')
  let metadata = {}
  try {
    metadata = readPresetMetadata(readFileSync(join(dir, 'preset.yml'), 'utf8'))
  } catch {
    metadata = {}
  }
  return {
    id,
    ...metadata,
    plugins: substituteSkillDir(absolutizeRows(rows, dir), skillDir)
  }
}
