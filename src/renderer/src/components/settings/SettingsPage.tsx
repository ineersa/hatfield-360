import { FileJson, FolderRoot, RotateCcw, X } from 'lucide-react'
import { useEffect, useId } from 'react'
import { CatppuccinRootFolderIcon } from '@/components/icons/CatppuccinIcons'
import { cn } from '@/lib/class-names'
import { cssFontFamily } from '@/lib/css-font-family'
import { useSettingsStore } from '@/state/settings-store'
import { useShellLayoutStore } from '@/state/shell-layout-store'
import { DEFAULT_SETTINGS, type IconTheme, type SettingKey } from '../../../../shared/settings-api'
import { FONT_PICKER_ATTRIBUTE, FontPicker } from './FontPicker'
import { FontSizeInput } from './FontSizeInput'

const PREVIEW_TEXT = 'The quick brown fox jumps over the lazy dog · 0O 1lI {}'

function ResetButton({ settingKey, label }: { settingKey: SettingKey; label: string }) {
  const customized = useSettingsStore((state) => state.customized.includes(settingKey))
  const editable = useSettingsStore((state) => state.editable)
  const update = useSettingsStore((state) => state.update)
  // Keeps its place when hidden, so the fields line up across sections.
  if (!customized) return <span className="size-9 shrink-0" aria-hidden />
  return (
    <button
      type="button"
      aria-label={`Reset ${label}`}
      title="Reset to default"
      disabled={!editable}
      onClick={() => void update(settingKey, null)}
      className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <RotateCcw className="size-4" aria-hidden />
    </button>
  )
}

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
        <h3 id={headingId} className="font-semibold">
          File icons
        </h3>
        <p className="text-muted-foreground">Icons for folders and files in the panels.</p>
      </div>
      <div role="radiogroup" aria-labelledby={headingId} className="flex gap-2">
        {ICON_THEME_CHOICES.map(({ theme, name, Icon }) => (
          <label
            key={theme}
            className="flex h-11 cursor-pointer items-center gap-2.5 rounded-lg border border-border px-3 has-checked:border-primary has-checked:bg-selection has-focus-visible:ring-2 has-focus-visible:ring-ring has-disabled:cursor-default has-disabled:opacity-50"
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
            <Icon className="size-[18px] shrink-0" />
            {name}
          </label>
        ))}
      </div>
    </section>
  )
}

function FontSetting({
  name,
  description,
  familyKey,
  sizeKey
}: {
  name: string
  description: string
  familyKey: 'app.fontFamily' | 'terminal.fontFamily' | 'editor.fontFamily'
  sizeKey: 'app.fontSize' | 'terminal.fontSize' | 'editor.fontSize'
}): React.JSX.Element {
  const family = useSettingsStore((state) => state.values[familyKey])
  const size = useSettingsStore((state) => state.values[sizeKey])
  const familyCustomized = useSettingsStore((state) => state.customized.includes(familyKey))
  const editable = useSettingsStore((state) => state.editable)
  const update = useSettingsStore((state) => state.update)
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2 py-4">
      <div>
        <h3 id={headingId} className="font-semibold">
          {name} font
        </h3>
        <p className="text-muted-foreground">{description}</p>
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
        <FontSizeInput
          label={`${name} font size`}
          value={size}
          disabled={!editable}
          onChange={(next) => void update(sizeKey, next)}
        />
        <ResetButton settingKey={sizeKey} label={`${name} font size`} />
      </div>
      <p
        aria-label={`${name} font preview`}
        className="truncate rounded-lg bg-background px-2.5 py-2"
        style={{ fontFamily: cssFontFamily(family), fontSize: size }}
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
    sizeKey: 'terminal.fontSize'
  },
  {
    name: 'Editor',
    description: 'Files opened in the editor.',
    familyKey: 'editor.fontFamily',
    sizeKey: 'editor.fontSize'
  }
]

/** The settings in settings.json as a form; every change is written to the file right away. */
export function SettingsPage(): React.JSX.Element {
  const editable = useSettingsStore((state) => state.editable)
  const openFile = useSettingsStore((state) => state.openFile)
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
        <header className="flex items-center gap-2 pb-2">
          <h1 className="flex-1 text-ui-lg font-semibold">Settings</h1>
          <button
            type="button"
            onClick={() => void openFile()}
            className="flex h-9 items-center gap-2 rounded-lg px-2.5 font-medium text-primary hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <FileJson className="size-4" aria-hidden />
            Open settings.json
          </button>
          <button
            type="button"
            aria-label="Close Settings"
            onClick={close}
            className="flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <X className="size-4" aria-hidden />
          </button>
        </header>
        {editable ? null : (
          <p role="status" className="rounded-lg bg-background px-3 py-2 text-destructive">
            settings.json has errors, so settings can't be changed here. Fix the file with Open
            settings.json.
          </p>
        )}
        <div className="flex flex-col divide-y divide-border">
          <IconThemeSetting />
          {FONT_SETTINGS.map((setting) => (
            <FontSetting key={setting.familyKey} {...setting} />
          ))}
        </div>
      </div>
    </div>
  )
}
