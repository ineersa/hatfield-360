import { AgentSoundPreviews } from './AgentSoundPreviews'
import { AgentLaunchSettings } from './AgentLaunchSettings'
import { FileJson, FolderRoot, RotateCcw, X } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { CatppuccinRootFolderIcon } from '@/components/icons/CatppuccinIcons'
import { cn } from '@/lib/class-names'
import { cssFontFamily } from '@/lib/css-font-family'
import { useKeymapStore } from '@/state/keymap-store'
import { useSettingsStore } from '@/state/settings-store'
import { useShellLayoutStore } from '@/state/shell-layout-store'
import {
  DEFAULT_SETTINGS,
  FONT_SIZE_RANGE,
  LINE_HEIGHT_RANGE,
  type IconTheme
} from '../../../../shared/settings-api'
import { ColorThemeSettings } from './ColorThemeSettings'
import { FONT_PICKER_ATTRIBUTE, FontPicker } from './FontPicker'
import { NumberStepper } from './NumberStepper'
import { ResetButton } from './ResetButton'

const PREVIEW_TEXT = 'The quick brown fox jumps over the lazy dog · 0O 1lI {}'

const ICON_THEME_CHOICES: {
  theme: IconTheme
  name: string
  Icon: React.ComponentType<{ className?: string }>
}[] = [
  { theme: 'catppuccin', name: 'Catppuccin', Icon: CatppuccinRootFolderIcon },
  {
    theme: 'lucide',
    name: 'Lucide',
    Icon: ({ className }) => (
      <FolderRoot
        className={cn('text-muted-foreground', className)}
        strokeWidth={1.75}
        aria-hidden
      />
    )
  }
]

function IconThemeSetting(): React.JSX.Element {
  const current = useSettingsStore((state) => state.values['workbench.iconTheme'])
  const editable = useSettingsStore((state) => state.editable)
  const update = useSettingsStore((state) => state.update)
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2 py-4">
      <div>
        <h3 id={headingId} className="type-section-title">
          File icons
        </h3>
        <p className="type-description">
          Icons for folders and files. For now the project folders in the Projects panel use them;
          the Files view will use them for every file.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <div role="radiogroup" aria-labelledby={headingId} className="flex flex-wrap gap-2">
          {ICON_THEME_CHOICES.map(({ theme, name, Icon }) => (
            <label
              key={theme}
              className="relative flex h-control cursor-pointer items-center gap-2.5 rounded-component border border-input-border px-3 has-checked:border-primary has-checked:bg-selection has-focus-visible:ring-2 has-focus-visible:ring-ring has-disabled:cursor-default has-disabled:opacity-50"
            >
              <input
                type="radio"
                name="workbench.iconTheme"
                value={theme}
                checked={current === theme}
                disabled={!editable}
                onChange={() => void update('workbench.iconTheme', theme)}
                className="sr-only"
              />
              <Icon className="size-4.5 shrink-0" />
              {name}
            </label>
          ))}
        </div>
        <ResetButton settingKey="workbench.iconTheme" label="File icons" />
      </div>
    </section>
  )
}

function FontSetting({
  name,
  description,
  familyKey,
  sizeKey,
  lineHeightKey
}: {
  name: string
  description: string
  familyKey: 'app.fontFamily' | 'terminal.fontFamily' | 'editor.fontFamily'
  sizeKey: 'app.fontSize' | 'terminal.fontSize' | 'editor.fontSize'
  /** The app's line spacing comes from the theme's text styles and row heights, so it has none. */
  lineHeightKey?: 'terminal.lineHeight' | 'editor.lineHeight'
}): React.JSX.Element {
  const family = useSettingsStore((state) => state.values[familyKey])
  const size = useSettingsStore((state) => state.values[sizeKey])
  const lineHeight = useSettingsStore((state) =>
    lineHeightKey ? state.values[lineHeightKey] : undefined
  )
  const familyCustomized = useSettingsStore((state) => state.customized.includes(familyKey))
  const editable = useSettingsStore((state) => state.editable)
  const update = useSettingsStore((state) => state.update)
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2 py-4">
      <div>
        <h3 id={headingId} className="type-section-title">
          {name} font
        </h3>
        <p className="type-description">{description}</p>
      </div>
      <div className="flex items-center gap-2">
        <FontPicker
          label={`${name} font family`}
          value={family}
          defaultValue={DEFAULT_SETTINGS[familyKey]}
          customized={familyCustomized}
          monospaceFirst={familyKey !== 'app.fontFamily'}
          disabled={!editable}
          onChange={(next) => void update(familyKey, next)}
        />
        <ResetButton settingKey={familyKey} label={`${name} font family`} />
        <NumberStepper
          label={`${name} font size`}
          value={size}
          range={FONT_SIZE_RANGE}
          disabled={!editable}
          onChange={(next) => void update(sizeKey, next)}
        />
        <ResetButton settingKey={sizeKey} label={`${name} font size`} />
      </div>
      {lineHeightKey && lineHeight !== undefined ? (
        <div className="flex items-center gap-2">
          <span className="type-description">Line height</span>
          <NumberStepper
            label={`${name} line height`}
            value={lineHeight}
            range={LINE_HEIGHT_RANGE}
            disabled={!editable}
            onChange={(next) => void update(lineHeightKey, next)}
          />
          <ResetButton settingKey={lineHeightKey} label={`${name} line height`} />
        </div>
      ) : null}
      <p
        aria-label={`${name} font preview`}
        className="truncate rounded-component bg-frame px-2.5 py-2"
        style={{ fontFamily: cssFontFamily(family), fontSize: size, lineHeight }}
      >
        {PREVIEW_TEXT}
      </p>
    </section>
  )
}

const FONT_SETTINGS: {
  name: string
  description: string
  familyKey: 'app.fontFamily' | 'terminal.fontFamily' | 'editor.fontFamily'
  sizeKey: 'app.fontSize' | 'terminal.fontSize' | 'editor.fontSize'
  lineHeightKey?: 'terminal.lineHeight' | 'editor.lineHeight'
}[] = [
  {
    name: 'App',
    description: 'Panels, lists, menus inside the window and the status bar.',
    familyKey: 'app.fontFamily',
    sizeKey: 'app.fontSize'
  },
  {
    name: 'Terminal',
    description: 'Terminal tabs and agent sessions.',
    familyKey: 'terminal.fontFamily',
    sizeKey: 'terminal.fontSize',
    lineHeightKey: 'terminal.lineHeight'
  },
  {
    name: 'Editor',
    description: 'Files opened in the editor.',
    familyKey: 'editor.fontFamily',
    sizeKey: 'editor.fontSize',
    lineHeightKey: 'editor.lineHeight'
  }
]

/** Resets every setting after the user confirms, since it can't be undone from the page. */
function ResetAllButton(): React.JSX.Element | null {
  const anyCustomized = useSettingsStore((state) => state.customized.length > 0)
  const editable = useSettingsStore((state) => state.editable)
  const resetAll = useSettingsStore((state) => state.resetAll)
  const [confirming, setConfirming] = useState(false)
  if (!anyCustomized) return null
  if (!confirming) {
    return (
      <button
        type="button"
        disabled={!editable}
        onClick={() => setConfirming(true)}
        className={HEADER_BUTTON_CLASS}
      >
        <RotateCcw className="size-4" aria-hidden />
        Reset all to defaults
      </button>
    )
  }
  return (
    <div role="group" aria-label="Reset all settings" className="flex items-center gap-1">
      <span className="type-description px-1 whitespace-nowrap">Reset every setting?</span>
      <button
        type="button"
        onClick={() => {
          setConfirming(false)
          void resetAll()
        }}
        className={cn(HEADER_BUTTON_CLASS, 'text-error')}
      >
        Reset
      </button>
      <button type="button" onClick={() => setConfirming(false)} className={HEADER_BUTTON_CLASS}>
        Cancel
      </button>
    </div>
  )
}

const HEADER_BUTTON_CLASS =
  'type-button flex h-control shrink-0 items-center gap-2 rounded-button px-2.5 whitespace-nowrap text-muted-foreground hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50'

function FlagSetting({
  settingKey,
  label,
  description
}: {
  settingKey:
    | 'terminal.gpuAcceleration'
    | 'terminal.trimLeadingWhitespaceOnCopy'
    | 'notifications.agentSounds'
  label: string
  description: string
}): React.JSX.Element {
  const enabled = useSettingsStore((state) => state.values[settingKey])
  const editable = useSettingsStore((state) => state.editable)
  const update = useSettingsStore((state) => state.update)
  const descriptionId = useId()
  return (
    <section className="flex items-center gap-2 py-4">
      <label className="flex flex-1 cursor-pointer items-start gap-3 has-disabled:cursor-default has-disabled:opacity-50">
        <input
          type="checkbox"
          checked={enabled}
          disabled={!editable}
          aria-describedby={descriptionId}
          onChange={(event) => void update(settingKey, event.target.checked)}
          className="mt-1 size-4 shrink-0 accent-primary"
        />
        <span>
          <span className="type-section-title block">{label}</span>
          <span id={descriptionId} className="type-description block">
            {description}
          </span>
        </span>
      </label>
      <ResetButton settingKey={settingKey} label={label} />
    </section>
  )
}

export function SettingsPage(): React.JSX.Element {
  const editable = useSettingsStore((state) => state.editable)
  const openFile = useSettingsStore((state) => state.openFile)
  const openKeybindings = useKeymapStore((state) => state.openFile)
  const close = useShellLayoutStore((state) => state.closeSettings)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // Escape inside a font picker closes only the picker.
      const inPicker =
        event.target instanceof Element && event.target.closest(`[${FONT_PICKER_ATTRIBUTE}]`)
      if (event.key === 'Escape' && !inPicker) close()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [close])

  return (
    <div className="flex min-h-0 w-full flex-1 justify-center overflow-y-auto px-8 py-8">
      <div className="flex w-full max-w-2xl flex-col">
        <header className="flex flex-wrap items-center gap-2 pb-2">
          <h1 className="type-page-title flex-1">Settings</h1>
          <ResetAllButton />
          <button
            type="button"
            onClick={() => void openFile()}
            className="type-button flex h-control shrink-0 items-center gap-2 rounded-button px-2.5 whitespace-nowrap text-link hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <FileJson className="size-4" aria-hidden />
            Open settings.json
          </button>
          <button
            type="button"
            onClick={() => void openKeybindings()}
            className="type-button flex h-control shrink-0 items-center gap-2 rounded-button px-2.5 whitespace-nowrap text-link hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <FileJson className="size-4" aria-hidden />
            Open keybindings.json
          </button>
          <button
            type="button"
            aria-label="Close Settings"
            onClick={close}
            className="flex size-icon-button items-center justify-center rounded-button text-muted-foreground hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <X className="size-4" aria-hidden />
          </button>
        </header>
        {editable ? null : (
          <p
            role="status"
            aria-label="Settings file errors"
            className="rounded-banner border border-error-border bg-error-background px-3 py-2"
          >
            settings.json has errors, so settings can't be changed here. Fix the file with Open
            settings.json.
          </p>
        )}
        <div className="flex flex-col divide-y divide-separator">
          <ColorThemeSettings />
          <IconThemeSetting />
          {FONT_SETTINGS.map((setting) => (
            <FontSetting key={setting.familyKey} {...setting} />
          ))}
          <FlagSetting
            settingKey="terminal.gpuAcceleration"
            label="Terminal GPU rendering"
            description="Draws terminals with WebGL. Turn it off if terminal text looks garbled or flickers."
          />
          <FlagSetting
            settingKey="terminal.trimLeadingWhitespaceOnCopy"
            label="Trim leading whitespace on copy"
            description="Remove spaces and tabs at the start of each copied line. Terminal output stays unchanged."
          />
          <div>
            <FlagSetting
              settingKey="notifications.agentSounds"
              label="Agent notification sounds"
              description="Play a cue for agent completion, input requests, and failures when you’re not viewing the agent’s terminal in the focused app."
            />
            <AgentSoundPreviews />
          </div>
          <AgentLaunchSettings />
        </div>
      </div>
    </div>
  )
}
