import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FolderFiles, listFiles, matchFiles } from './file-index'

let root: string

const write = async (path: string, text = ''): Promise<void> => {
  await mkdir(dirname(join(root, path)), { recursive: true })
  await writeFile(join(root, path), text)
}

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'file-index-')))
  execFileSync('git', ['init', '--quiet'], { cwd: root })
  await write('.gitignore', 'build/\n*.log\n')
  await write('src/AgentCore/Application/Pipeline/RunMessageProcessor.php')
  await write('src/AgentCore/Domain/Run/RunMessage.php')
  await write('.github/workflows/release.yml')
  await write('build/RunMessageProcessor.php')
  await write('debug.log')
  await write('node_modules/left-pad/index.js')
  await write('vendor/acme/RunMessageProcessor.php')
})
afterEach(() => rm(root, { recursive: true, force: true }))

const indexed = async (): Promise<FolderFiles> => {
  const folder = new FolderFiles(root)
  for (const file of await listFiles(root)) folder.files.add(file)
  return folder
}

describe('the Search Everywhere file index', () => {
  it("lists a folder's files without what git ignores or dependency folders", async () => {
    expect([...(await indexed()).files].toSorted()).toEqual([
      '.github/workflows/release.yml',
      '.gitignore',
      'src/AgentCore/Application/Pipeline/RunMessageProcessor.php',
      'src/AgentCore/Domain/Run/RunMessage.php'
    ])
  })

  it('follows files added and removed, and a removed folder with its files', async () => {
    const folder = await indexed()
    folder.apply([
      { path: join(root, 'src/New.php'), kind: 'add', folder: false },
      { path: join(root, 'src/AgentCore/Domain'), kind: 'unlink', folder: true },
      { path: join(root, '.gitignore'), kind: 'unlink', folder: false },
      { path: join(dirname(root), 'outside.php'), kind: 'add', folder: false }
    ])
    expect([...folder.files].toSorted()).toEqual([
      '.github/workflows/release.yml',
      'src/AgentCore/Application/Pipeline/RunMessageProcessor.php',
      'src/New.php'
    ])
  })

  it('finds a file from a path fragment, with its full path and matched ranges', async () => {
    const [hit] = await matchFiles('Pipeline/RunMessProc', [await indexed()])
    expect(hit).toMatchObject({
      path: join(root, 'src/AgentCore/Application/Pipeline/RunMessageProcessor.php'),
      relative: 'src/AgentCore/Application/Pipeline/RunMessageProcessor.php'
    })
    expect(await matchFiles('RunMessage', [await indexed()], () => false)).toHaveLength(2)
  })

  it('keeps the best 50 of many hits, in listing order', async () => {
    const folder = new FolderFiles(root)
    for (let index = 0; index < 120; index++)
      folder.files.add(`src/deep/${'x'.repeat(index)}/a${index}.ts`)
    const hits = await matchFiles('a', [folder])
    expect(hits.map((hit) => hit.relative)).toEqual(
      [...folder.files].toSorted((a, b) => a.length - b.length || a.localeCompare(b)).slice(0, 50)
    )
  })
})
