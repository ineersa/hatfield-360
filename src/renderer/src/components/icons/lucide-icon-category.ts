/** Lucide has no per-language icons, so files and folders are drawn by category. */
export type FileCategory =
  | 'archive'
  | 'audio'
  | 'code'
  | 'config'
  | 'data'
  | 'database'
  | 'diff'
  | 'file'
  | 'font'
  | 'image'
  | 'json'
  | 'key'
  | 'lock'
  | 'shell'
  | 'spreadsheet'
  | 'text'
  | 'video'

export type FolderCategory =
  | 'build'
  | 'code'
  | 'config'
  | 'dependencies'
  | 'docs'
  | 'folder'
  | 'git'
  | 'key'
  | 'tests'

/** Each category with its space-separated names, as a lookup by name. */
const byWord = <T extends string>(groups: [T, string][]): Map<string, T> =>
  new Map(groups.flatMap(([category, words]) => words.split(' ').map((word) => [word, category])))

const FILE_NAMES = byWord<FileCategory>([
  [
    'config',
    '.editorconfig .gitignore .gitattributes .gitmodules .dockerignore .npmrc .nvmrc .yarnrc ' +
      '.prettierrc .eslintrc .oxlintrc.json .oxfmtrc.json .browserslistrc dockerfile containerfile ' +
      'makefile justfile procfile tsconfig.json jsconfig.json'
  ],
  ['lock', 'pnpm-lock.yaml package-lock.json yarn.lock bun.lockb composer.lock gemfile.lock'],
  ['key', '.env id_rsa id_ed25519'],
  ['text', 'readme license licence changelog authors contributing notice copying']
])

const FILE_EXTENSIONS = byWord<FileCategory>([
  ['archive', 'zip tar gz tgz bz2 xz zst 7z rar jar war deb rpm dmg iso'],
  ['audio', 'mp3 wav ogg flac m4a aac opus'],
  [
    'code',
    'ts tsx mts cts js jsx mjs cjs py rb go rs java kt kts scala swift c h cc cpp hpp cs fs ' +
      'php lua dart ex exs erl hs ml clj zig nim r jl pl vue svelte astro html htm css scss ' +
      'sass less styl wasm'
  ],
  ['config', 'yml yaml toml ini cfg conf properties xml plist env'],
  ['data', 'parquet avro arrow ndjson jsonl'],
  ['database', 'sql db sqlite sqlite3 prisma'],
  ['diff', 'diff patch'],
  ['font', 'ttf otf woff woff2 eot'],
  ['image', 'png jpg jpeg gif webp avif svg ico bmp tif tiff heic psd'],
  ['json', 'json jsonc json5'],
  ['key', 'pem key crt cer csr p12 pfx pub gpg asc'],
  ['lock', 'lock lockb'],
  ['shell', 'sh bash zsh fish ps1 psm1 bat cmd nu'],
  ['spreadsheet', 'csv tsv xls xlsx ods numbers'],
  ['text', 'md mdx markdown txt rst adoc org tex pdf log'],
  ['video', 'mp4 mov webm mkv avi m4v']
])

const FOLDER_NAMES = byWord<FolderCategory>([
  ['build', 'dist build out target release releases bin obj coverage .next .nuxt .output'],
  ['code', 'src source lib libs app apps packages pkg internal cmd'],
  ['config', 'config configs .config .vscode .idea .devcontainer .husky settings scripts'],
  ['dependencies', 'node_modules vendor .venv venv .pnpm-store bower_components'],
  ['docs', 'docs doc documentation wiki'],
  ['git', '.git .github .gitlab .forgejo'],
  ['key', '.ssh .gnupg secrets certs keys'],
  ['tests', 'test tests __tests__ spec specs e2e __mocks__ fixtures']
])

/** As the Catppuccin set matches: the whole name, then the longest extension, then plain. */
export function fileCategory(fileName: string): FileCategory {
  const name = fileName.toLowerCase()
  const exact = FILE_NAMES.get(name)
  if (exact) return exact
  if (name.startsWith('.env.')) return 'key'
  for (let dot = name.indexOf('.'); dot !== -1; dot = name.indexOf('.', dot + 1)) {
    const category = FILE_EXTENSIONS.get(name.slice(dot + 1))
    if (category) return category
  }
  return 'file'
}

export const folderCategory = (folderName: string): FolderCategory =>
  FOLDER_NAMES.get(folderName.toLowerCase()) ?? 'folder'
