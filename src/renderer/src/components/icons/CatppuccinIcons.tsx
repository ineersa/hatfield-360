import type { SVGProps } from 'react'

/*
 * Icons from Catppuccin for VSCode Icons (MIT, see THIRD_PARTY_NOTICES.md), commit b6915da,
 * `icons/css-variables/`, with their `--vscode-ctp-*` colours mapped to the theme's icon colours.
 */

/** `_root.svg`: a workspace project's root folder. */
export function CatppuccinRootFolderIcon(props: SVGProps<SVGSVGElement>): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden {...props}>
      <g className="stroke-icon-text" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M 4.5,4.5 H 12 c 0.828427,0 1.5,0.6715729 1.5,1.5 V 6.5 M 6,13.5 H 2 C 1.1715729,13.5 0.5,12.828427 0.5,12 V 3.5 c 0,-0.5522847 0.44771525,-1 1,-1 h 5 c 0.5522847,0 1,0.4477153 1,1 v 1" />
        <circle cx="11.5" cy="12" r="3" />
        <circle cx="11.5" cy="12" r=".5" />
      </g>
    </svg>
  )
}

/** `_folder.svg`: a closed folder in the file tree. */
export function CatppuccinFolderIcon(props: SVGProps<SVGSVGElement>): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden {...props}>
      <path
        className="stroke-icon-text"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4.5 4.5H12c.83 0 1.5.67 1.5 1.5v6c0 .83-.67 1.5-1.5 1.5H2A1.5 1.5 0 01.5 12V3.5a1 1 0 011-1h5a1 1 0 011 1v1"
      />
    </svg>
  )
}

/** `_folder_open.svg`: an expanded folder in the file tree. */
export function CatppuccinFolderOpenIcon(props: SVGProps<SVGSVGElement>): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden {...props}>
      <path
        className="stroke-icon-text"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m1.87 8 .7-2.74a1 1 0 01.96-.76h10.94a1 1 0 01.97 1.24l-1.75 7a1 1 0 01-.97.76H2A1.5 1.5 0 01.5 12V3.5a1 1 0 011-1h5a1 1 0 011 1v1"
      />
    </svg>
  )
}

/** `_file.svg`: a file in the file tree. */
export function CatppuccinFileIcon(props: SVGProps<SVGSVGElement>): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden {...props}>
      <path
        className="stroke-icon-text"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M13.5 6.5v6a2 2 0 01-2 2h-7a2 2 0 01-2-2v-9c0-1.1.9-2 2-2h4.01m-.01 0 5 5h-4a1 1 0 01-1-1z"
      />
    </svg>
  )
}
