# Third-party notices

Hatfield 360 includes code and assets from the projects below.

## Catppuccin for VSCode Icons

Source: https://github.com/catppuccin/vscode-icons (commit b6915da9f6889b683a110aa747de96c2820a537d)
Used in: `src/renderer/src/components/icons/CatppuccinIcons.tsx` (SVG icons, ported to React components)

```
MIT License

Copyright (c) 2023 Catppuccin
Copyright (c) 2023 thang-nm

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Catppuccin for JetBrains

Source: https://github.com/catppuccin/jetbrains (plugin version 3.6.1)
Used in: the Catppuccin app, editor and terminal themes (`src/renderer/src/assets/themes/app/islands-catppuccin-*.css`, `src/renderer/src/assets/themes/editor/catppuccin-*.json`, `src/shared/themes/*-theme-catalog.ts`), ported from its UI themes and editor schemes

```
MIT License

Copyright (c) 2022 Catppuccin

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## IntelliJ Platform themes

Source: https://github.com/JetBrains/intellij-community (theme files as shipped in PhpStorm 2026.3's platform jars)
Used in: the app, editor and terminal themes under `src/renderer/src/assets/themes/` and `src/shared/themes/` (Islands, Darcula, Light and High Contrast, and the platform themes the Catppuccin themes extend), ported from its UI themes and editor schemes

```
Copyright 2000-2026 JetBrains s.r.o.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

## Orca

Source: https://github.com/stablyai/orca (commit ccebbedaee8d7f6c26646ed6bf89302fd7b1c62a)
Used in: terminal panes and shells and the git worktree list, ported and trimmed:

- `src/renderer/src/lib/pane-manager/` (split tree, draggable dividers, xterm pane lifecycle, fitting, WebGL renderer) from `src/renderer/src/lib/pane-manager/`
- `src/renderer/src/assets/terminal.css` from `src/renderer/src/assets/terminal.css`
- `src/main/terminal/terminal-environment.ts` (shell environment and its scrubbers) from `src/main/providers/local-pty/local-pty-spawn-environment.ts` and the shell-startup environment modules
- `src/main/terminal/default-shell.ts` (Unix shell fallbacks, PowerShell lookup) from `src/main/providers/local-pty/local-pty-executable-spawn.ts` and `src/main/providers/shell-launch/windows/powershell-executable.ts`
- `src/main/terminal/terminal-sessions.ts` (the macOS spawn-helper check) from `src/main/providers/local-pty/local-pty-executable-spawn.ts`
- `src/main/git/worktree-list.ts` (`git worktree list --porcelain -z` parsing) from `src/shared/git/worktrees/git-worktree-porcelain-parser.ts`

```
MIT License

Copyright (c) 2026 Lovecast Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
