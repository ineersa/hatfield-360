// `node scripts/port-catppuccin-icons.mjs <catppuccin/vscode-icons checkout>`: regenerates the
// Catppuccin icon set (`src/renderer/src/assets/icons/catppuccin-icons.json`) from upstream's
// `icons/css-variables/` SVGs and its default associations. Upstream sources are read as data, never run.
import { execFileSync } from 'node:child_process'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = join(repo, 'src', 'renderer', 'src', 'assets', 'icons', 'catppuccin-icons.json')
const upstream = process.argv[2]
if (!upstream) {
  console.error('Usage: node scripts/port-catppuccin-icons.mjs <catppuccin/vscode-icons checkout>')
  process.exit(1)
}

/** Attributes kept, by their SVG name, with the React name they render under. */
const ATTRIBUTES = new Map(
  [
    'clip-path',
    'clip-rule',
    'cx',
    'cy',
    'd',
    'fill',
    'fill-rule',
    'gradientTransform',
    'gradientUnits',
    'id',
    'mask',
    'maskUnits',
    'offset',
    'r',
    'rx',
    'ry',
    'stop-color',
    'stroke',
    'stroke-dasharray',
    'stroke-linecap',
    'stroke-linejoin',
    'stroke-miterlimit',
    'stroke-width',
    'style',
    'transform',
    'x',
    'y',
    'width',
    'height'
  ].map((name) => [name, name.replace(/-(\w)/g, (_, letter) => letter.toUpperCase())])
)
const ELEMENTS = new Set([
  'circle',
  'clipPath',
  'defs',
  'ellipse',
  'g',
  'mask',
  'path',
  'radialGradient',
  'rect',
  'stop'
])

/** Upstream's palette variables become the app's icon colour roles. */
const colour = (value) =>
  value.replaceAll(/var\(--vscode-ctp-(\w+)\)/g, (_, name) => `var(--icon-${name})`)

/** An SVG file as `[viewBox, children]`, each child `[tag, attributes, children?]`. */
function parseSvg(name, text) {
  const ids = [...text.matchAll(/\sid="([^"]+)"/g)].map(([, id]) => id)
  // Inline SVGs share one document, so ids are made unique per icon.
  const scoped = (value) =>
    ids.reduce((result, id) => result.replaceAll(`url(#${id})`, `url(#ctp-${name}-${id})`), value)
  const root = { children: [] }
  const stack = [root]
  let viewBox = null
  for (const [, closing, tag, rawAttributes, selfClosing] of text.matchAll(
    /<(\/?)([a-zA-Z]+)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>/g
  )) {
    if (closing) {
      stack.pop()
      continue
    }
    const attributes = Object.fromEntries(
      [...rawAttributes.matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value])
    )
    if (tag === 'svg') {
      viewBox = attributes.viewBox
      continue
    }
    if (!ELEMENTS.has(tag)) throw new Error(`${name}: unexpected <${tag}>`)
    const props = {}
    for (const [key, value] of Object.entries(attributes)) {
      const prop = ATTRIBUTES.get(key)
      if (!prop) throw new Error(`${name}: unexpected ${key}`)
      if (key === 'style') {
        if (value !== 'mask-type:alpha') throw new Error(`${name}: unexpected style ${value}`)
        props.style = { maskType: 'alpha' }
      } else if (key === 'id') props.id = `ctp-${name}-${value}`
      else props[prop] = scoped(colour(value))
    }
    const node = [tag, props]
    stack.at(-1).children.push(node)
    if (!selfClosing) {
      node.push([])
      stack.push({ children: node[2] })
    }
  }
  if (!viewBox) throw new Error(`${name}: no viewBox`)
  return [viewBox, root.children]
}

/**
 * The object literal assigned to `const <name>` in an upstream defaults file: nested objects,
 * arrays and single-quoted strings, as those files hold.
 */
async function objectLiteral(file, name) {
  const text = await readFile(file, 'utf8')
  const start = new RegExp(`const ${name}(?::[^=]+)? = `).exec(text)
  if (!start) throw new Error(`${file}: no ${name}`)
  const tokens = text
    .slice(start.index + start[0].length)
    .matchAll(/\s+|\/\/[^\n]*|'((?:[^'\\]|\\.)*)'|([A-Za-z_$][\w$]*)|([{}[\]:,])|(.)/gs)
  const next = () => {
    for (const [, quoted, identifier, punctuation, other] of tokens) {
      if (quoted !== undefined) return { string: quoted.replaceAll(/\\(.)/g, '$1') }
      if (identifier !== undefined) return { string: identifier }
      if (punctuation !== undefined) return { punctuation }
      if (other !== undefined) throw new Error(`${file}: unexpected ${other}`)
    }
    throw new Error(`${file}: ${name} doesn't end`)
  }
  const value = (token) => {
    if (token.string !== undefined) return token.string
    const close = { '{': '}', '[': ']' }[token.punctuation]
    if (!close) throw new Error(`${file}: unexpected ${token.punctuation}`)
    const entries = []
    for (let item = next(); item.punctuation !== close; item = next()) {
      if (item.punctuation === ',') continue
      if (close === ']') {
        entries.push(value(item))
        continue
      }
      if (next().punctuation !== ':') throw new Error(`${file}: expected :`)
      entries.push([item.string, value(next())])
    }
    return close === ']' ? entries : Object.fromEntries(entries)
  }
  return value(next())
}

/** Upstream's flattening: each name maps to an icon, a later icon winning a name both claim. */
function associations(icons, field, iconName = (icon) => icon) {
  const map = {}
  for (const [icon, entry] of Object.entries(icons)) {
    for (const key of entry[field] ?? []) map[key.toLowerCase()] = iconName(icon)
  }
  return map
}

const folder = join(upstream, 'icons', 'css-variables')
const icons = {}
for (const file of (await readdir(folder)).filter((name) => name.endsWith('.svg')).toSorted()) {
  const name = basename(file, '.svg')
  icons[name] = parseSvg(name, await readFile(join(folder, file), 'utf8'))
}
const fileIcons = await objectLiteral(
  join(upstream, 'src', 'defaults', 'fileIcons.ts'),
  'fileIcons'
)
const folderIcons = await objectLiteral(
  join(upstream, 'src', 'defaults', 'folderIcons.ts'),
  'folderIcons'
)
const set = {
  fileNames: associations(fileIcons, 'fileNames'),
  fileExtensions: associations(fileIcons, 'fileExtensions'),
  folderNames: associations(folderIcons, 'folderNames', (icon) => `folder_${icon}`),
  icons
}
const missing = [
  ...Object.values(set.fileNames),
  ...Object.values(set.fileExtensions),
  ...Object.values(set.folderNames).flatMap((icon) => [icon, `${icon}_open`])
].filter((icon) => !(icon in icons))
if (missing.length > 0)
  throw new Error(`Associations without an icon: ${[...new Set(missing)].join(', ')}`)

await writeFile(output, `${JSON.stringify(set)}\n`)
const commit = execFileSync('git', ['-C', upstream, 'rev-parse', 'HEAD'], { encoding: 'utf8' })
process.stdout.write(
  `Wrote ${Object.keys(icons).length} icons from commit ${commit.trim()} to ${output}\n`
)
