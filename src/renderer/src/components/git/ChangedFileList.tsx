import { cn } from '@/lib/class-names'
import type { ChangedFile } from '../../../../shared/source-control-api'
import type { GitGroup } from './change-tree-rows'
import { CHANGE_KINDS } from './ChangesTree'

/** The files an action will touch, each with its change letter and, across repositories, its repository. */
export function ChangedFileList({
  label,
  targets
}: {
  label: string
  targets: { group: GitGroup; files: ChangedFile[] }[]
}): React.JSX.Element {
  const several = targets.length > 1
  return (
    <ul aria-label={label} className="flex max-h-48 flex-col overflow-y-auto">
      {targets.flatMap(({ group, files }) =>
        files.map((file) => {
          const kind = CHANGE_KINDS[file.kind]
          return (
            <li
              key={`${group.root}\0${file.path}`}
              className="type-body flex h-tree-row shrink-0 items-center gap-2"
            >
              <span
                className={cn('w-4 shrink-0 text-center font-mono', kind.text)}
                title={kind.label}
              >
                {kind.letter}
              </span>
              <span className="min-w-0 truncate">{file.path}</span>
              <span className="sr-only">{kind.label}</span>
              {several ? (
                <span className="type-hint ml-auto shrink-0 pl-2">{group.name}</span>
              ) : null}
            </li>
          )
        })
      )}
    </ul>
  )
}
