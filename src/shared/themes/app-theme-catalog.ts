/** App themes: one CSS file each in src/renderer/src/assets/themes/app/. */
export const APP_THEMES = [
  { id: 'high-contrast', label: 'High Contrast', dark: true, frame: '#000000' },
  {
    id: 'islands-catppuccin-frappe',
    label: 'Islands Catppuccin Frappé',
    dark: true,
    frame: '#232634'
  },
  {
    id: 'islands-catppuccin-latte',
    label: 'Islands Catppuccin Latte',
    dark: false,
    frame: '#dce0e8'
  },
  {
    id: 'islands-catppuccin-macchiato',
    label: 'Islands Catppuccin Macchiato',
    dark: true,
    frame: '#181926'
  },
  {
    id: 'islands-catppuccin-mocha',
    label: 'Islands Catppuccin Mocha',
    dark: true,
    frame: '#11111b'
  },
  { id: 'islands-darcula', label: 'Islands Darcula', dark: true, frame: '#3c3f41' },
  { id: 'islands-dark', label: 'Islands Dark', dark: true, frame: '#26282c' },
  { id: 'islands-light', label: 'Islands Light', dark: false, frame: '#e9eaee' }
] as const
