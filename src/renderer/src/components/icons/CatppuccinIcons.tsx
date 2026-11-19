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
