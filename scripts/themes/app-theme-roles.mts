/**
 * The one table from JetBrains UI theme keys to app theme roles. Each role takes the first key the
 * theme sets (`*.suffix` wildcards count), or else another role's value; a role with neither fails
 * the import. Roles become CSS custom properties of the same name.
 */
type Role = {
  keys: string[]
  /** Role to copy when the theme sets none of the keys. */
  fallback?: string
  /**
   * colour: `#rrggbb[aa]`. arc: a Swing arc (a corner's diameter) becoming a CSS radius. px: a length.
   * row: a row height at the IDE's 13px font, scaled with `--app-font-size`.
   */
  unit: 'colour' | 'arc' | 'px' | 'row'
}

const colour = (keys: string[], fallback?: string): Role =>
  fallback === undefined ? { keys, unit: 'colour' } : { keys, fallback, unit: 'colour' }

export const APP_THEME_ROLES: Record<string, Role> = {
  // Surfaces: the frame behind the islands (activity bar, status bar, gaps) and the islands on it.
  frame: colour(['MainWindow.background']),
  island: colour(['ToolWindow.background', 'Panel.background']),
  foreground: colour(['Label.foreground']),
  'muted-foreground': colour(['Label.infoForeground', 'Component.infoForeground']),
  'disabled-foreground': colour(['Label.disabledForeground'], 'muted-foreground'),
  'status-foreground': colour(['StatusBar.Widget.foreground'], 'muted-foreground'),
  link: colour(['Link.activeForeground']),
  'icon-text': colour(['Label.foreground']),
  // Interaction.
  hover: colour(['ActionButton.hoverBackground']),
  pressed: colour(['ActionButton.pressedBackground'], 'hover'),
  'row-hover': colour(['Tree.hoverBackground', 'List.hoverBackground'], 'hover'),
  selection: colour(['Tree.selectionBackground']),
  'selection-foreground': colour(['Tree.selectionForeground'], 'foreground'),
  'selection-inactive': colour(['Tree.selectionInactiveBackground'], 'selection'),
  ring: colour(['*.focusColor', 'Component.focusColor']),
  border: colour(['Component.borderColor']),
  separator: colour(['Separator.separatorColor'], 'border'),
  input: colour(['TextField.background'], 'island'),
  'input-foreground': colour(['TextField.foreground'], 'foreground'),
  'input-border': colour(['Component.borderColor']),
  primary: colour(['Button.default.startBackground']),
  'primary-foreground': colour(['Button.default.foreground']),
  button: colour(['Button.startBackground']),
  'button-foreground': colour(['Button.foreground'], 'foreground'),
  'button-border': colour(['Button.startBorderColor'], 'border'),
  'tab-selected': colour(['EditorTabs.underlinedTabBackground'], 'selection'),
  'tab-underline': colour(['EditorTabs.underlinedBorderColor'], 'primary'),
  'tab-hover': colour(['EditorTabs.hoverBackground'], 'hover'),
  // Overlays: each its own surface, visible over both the frame and the islands.
  tooltip: colour(['ToolTip.background']),
  'tooltip-foreground': colour(['ToolTip.foreground']),
  'tooltip-muted-foreground': colour(['ToolTip.infoForeground'], 'muted-foreground'),
  'tooltip-border': colour(['ToolTip.borderColor'], 'tooltip'),
  popover: colour(['Popup.background', 'PopupMenu.background']),
  'popover-foreground': colour(['PopupMenu.foreground'], 'foreground'),
  'popover-border': colour(['Popup.borderColor']),
  'popover-selection': colour(['PopupMenu.selectionBackground'], 'selection'),
  'popover-selection-foreground': colour(['PopupMenu.selectionForeground'], 'foreground'),
  'popover-shortcut': colour(['MenuItem.acceleratorForeground'], 'muted-foreground'),
  dialog: colour(['AlertDialog.background'], 'popover'),
  'dialog-border': colour(['Popup.borderColor']),
  toast: colour(['Notification.background'], 'popover'),
  'toast-foreground': colour(['Notification.foreground'], 'foreground'),
  'toast-border': colour(['Notification.borderColor'], 'popover-border'),
  counter: colour(['Counter.background'], 'muted-foreground'),
  'counter-foreground': colour(['Counter.foreground'], 'frame'),
  // Severities: text colour, and a subtle background with its border for banners and toasts.
  error: colour(['Label.errorForeground', 'ValidationTooltip.errorBorderColor']),
  'error-background': colour(['Banner.errorBackground', 'ValidationTooltip.errorBackground']),
  'error-border': colour(['Banner.errorBorderColor', 'ValidationTooltip.errorBorderColor']),
  warning: colour(['Label.warningForeground', 'ValidationTooltip.warningBorderColor']),
  'warning-background': colour(['Banner.warningBackground', 'ValidationTooltip.warningBackground']),
  'warning-border': colour(['Banner.warningBorderColor', 'ValidationTooltip.warningBorderColor']),
  success: colour(['Label.successForeground', 'Badge.greenOutlineForeground']),
  'success-background': colour(['Banner.successBackground', 'Editor.ToolTip.successBackground']),
  'success-border': colour(['Banner.successBorderColor', 'Badge.greenOutlineBorderColor']),
  info: colour(['Link.activeForeground']),
  'info-background': colour([
    'Banner.infoBackground',
    'Notification.ToolWindow.informativeBackground'
  ]),
  'info-border': colour([
    'Banner.infoBorderColor',
    'Notification.ToolWindow.informativeBorderColor'
  ]),
  'scrollbar-thumb': colour(['ScrollBar.Mac.thumbColor', 'ScrollBar.thumbColor']),
  'scrollbar-thumb-hover': colour(
    ['ScrollBar.Mac.hoverThumbColor', 'ScrollBar.hoverThumbColor'],
    'scrollbar-thumb'
  ),
  // Shape and density.
  'island-radius': { keys: ['Island.arc'], unit: 'arc' },
  'island-gap': { keys: ['Island.borderWidth'], unit: 'px' },
  'component-radius': { keys: ['Component.arc'], unit: 'arc' },
  'button-radius': { keys: ['Button.arc'], fallback: 'component-radius', unit: 'arc' },
  'popup-radius': {
    keys: ['PopupMenu.borderCornerRadius'],
    fallback: 'component-radius',
    unit: 'px'
  },
  'banner-radius': { keys: ['Banner.arc'], fallback: 'component-radius', unit: 'arc' },
  'tree-row-height': { keys: ['Tree.rowHeight'], unit: 'row' },
  'list-row-height': { keys: ['List.rowHeight'], fallback: 'tree-row-height', unit: 'row' }
}

/** The IDE lays rows out for its default 13px UI font; ours follow `app.fontSize`. */
const IDE_FONT_SIZE = 13

/** A role's CSS value from a theme value, or undefined when the value doesn't fit the unit. */
export function cssValue(role: Role, value: string | number | boolean): string | undefined {
  if (role.unit === 'colour') {
    return typeof value === 'string' && value.startsWith('#') ? value : undefined
  }
  const number = typeof value === 'number' ? value : Number(value)
  if (typeof value === 'boolean' || !Number.isFinite(number)) return undefined
  if (role.unit === 'arc') return `${number / 2}px`
  if (role.unit === 'px') return `${number}px`
  return `calc(var(--app-font-size) * ${number} / ${IDE_FONT_SIZE})`
}
