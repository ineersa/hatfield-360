import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { WorkspaceFolderKind } from '../../src/shared/workspace-api'
import { makeTempDir } from './launch-app'

/** A user data folder whose workspace holds `folders`. */
export async function seedWorkspace(
  folders: { path: string; kind: WorkspaceFolderKind }[]
): Promise<[string, () => Promise<void>]> {
  const [userData, cleanup] = await makeTempDir('user-data')
  await mkdir(join(userData, 'workspaces'))
  await writeFile(
    join(userData, 'workspaces', 'default.hatfield-workspace'),
    JSON.stringify({ version: 1, folders })
  )
  return [userData, cleanup]
}
