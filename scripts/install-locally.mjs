// `pnpm package:local`: builds the app unpacked and installs it for the current user (Linux and macOS).
import { spawnSync } from 'node:child_process'
import { chmod, cp, mkdir, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const NAME = 'hatfield-360'
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function say(line) {
  process.stdout.write(`${line}\n`)
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: repo, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

if (process.platform !== 'linux' && process.platform !== 'darwin') {
  console.error('pnpm package:local installs on Linux and macOS only.')
  process.exit(1)
}

const home = homedir()

if (process.platform === 'darwin') {
  const app = 'Hatfield 360.app'
  run('pnpm', ['exec', 'electron-vite', 'build'])
  run('pnpm', ['exec', 'electron-builder', '--mac', 'dir', '--publish', 'never'])
  // release/mac-arm64 on Apple silicon, release/mac on Intel.
  const built = (await readdir(join(repo, 'release'))).find((dir) => dir.startsWith('mac'))
  if (built === undefined) throw new Error('electron-builder left no mac* folder in release/')
  const applications = join(home, 'Applications')
  const installed = join(applications, app)
  await mkdir(applications, { recursive: true })
  await rm(installed, { recursive: true, force: true })
  // ditto keeps the bundle's framework symlinks, modes and attributes intact.
  run('ditto', [join(repo, 'release', built, app), installed])
  // Apple silicon won't start an unsigned app; an ad-hoc signature is enough for one built here.
  run('codesign', ['--force', '--deep', '--sign', '-', installed])
  say(`\nInstalled Hatfield 360 to ${installed}`)
  say('Open it from Launchpad, Spotlight or ~/Applications.')
  process.exit(0)
}

const dataHome = process.env.XDG_DATA_HOME || join(home, '.local', 'share')
const installDir = join(home, '.local', 'opt', NAME)
const binDir = join(home, '.local', 'bin')
const executable = join(installDir, NAME)
const desktopFile = join(dataHome, 'applications', `${NAME}.desktop`)

run('pnpm', ['exec', 'electron-vite', 'build'])
run('pnpm', ['exec', 'electron-builder', '--linux', 'dir', '--publish', 'never'])

await rm(installDir, { recursive: true, force: true })
await mkdir(dirname(installDir), { recursive: true })
await cp(join(repo, 'release', 'linux-unpacked'), installDir, {
  recursive: true,
  verbatimSymlinks: true
})
await cp(join(repo, 'resources', 'icon.png'), join(installDir, 'icon.png'))

await mkdir(binDir, { recursive: true })
await rm(join(binDir, NAME), { force: true })
await symlink(executable, join(binDir, NAME))

await mkdir(dirname(desktopFile), { recursive: true })
await writeFile(
  desktopFile,
  [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Hatfield 360',
    'Comment=Coding agents in terminals, with an editor and git',
    `Exec="${executable}" %U`,
    `Icon=${join(installDir, 'icon.png')}`,
    // Docks match the running window to this entry by it.
    `StartupWMClass=${NAME}`,
    'Categories=Development;',
    'Terminal=false',
    ''
  ].join('\n')
)
await chmod(desktopFile, 0o755)
spawnSync('update-desktop-database', [dirname(desktopFile)], { stdio: 'ignore' })

say(`\nInstalled Hatfield 360 to ${installDir}`)
say(`Command: ${join(binDir, NAME)}`)
say(`App menu entry: ${desktopFile}`)
if (!(process.env.PATH ?? '').split(delimiter).includes(binDir)) {
  say(`Note: ${binDir} is not on PATH; add it to start the app as \`${NAME}\`.`)
}
const restricted = spawnSync('sysctl', ['-n', 'kernel.apparmor_restrict_unprivileged_userns'], {
  encoding: 'utf8'
})
if (restricted.stdout?.trim() === '1') {
  say('This system restricts user namespaces; if the app fails to start, run once:')
  say(`  sudo chown root:root ${join(installDir, 'chrome-sandbox')}`)
  say(`  sudo chmod 4755 ${join(installDir, 'chrome-sandbox')}`)
}
