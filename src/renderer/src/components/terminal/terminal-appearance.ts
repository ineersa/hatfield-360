import type { ITerminalOptions } from '@xterm/xterm'
import { type RefObject, useEffect } from 'react'
import type { PaneManager } from '@/lib/pane-manager/pane-manager'
import { terminalTheme } from '@/lib/terminal-theme'
import { useSettingsStore } from '@/state/settings-store'

/** The terminal font and colours from Settings, for a pane's new terminal. */
export function currentTerminalOptions(): ITerminalOptions {
  const { values } = useSettingsStore.getState()
  return {
    fontFamily: values['terminal.fontFamily'],
    fontSize: values['terminal.fontSize'],
    lineHeight: values['terminal.lineHeight'],
    theme: terminalTheme(values['terminal.colorTheme'])
  }
}

export const currentGpuAcceleration = (): boolean =>
  useSettingsStore.getState().values['terminal.gpuAcceleration']

/** Open terminals follow the terminal settings as they change. */
export function useTerminalAppearance(manager: RefObject<PaneManager | null>): void {
  const fontFamily = useSettingsStore((state) => state.values['terminal.fontFamily'])
  const fontSize = useSettingsStore((state) => state.values['terminal.fontSize'])
  const lineHeight = useSettingsStore((state) => state.values['terminal.lineHeight'])
  const gpuAcceleration = useSettingsStore((state) => state.values['terminal.gpuAcceleration'])
  const colorTheme = useSettingsStore((state) => state.values['terminal.colorTheme'])

  useEffect(() => {
    manager.current?.setTerminalOptions({ fontFamily, fontSize, lineHeight })
  }, [manager, fontFamily, fontSize, lineHeight])

  useEffect(() => {
    manager.current?.setTerminalOptions({ theme: terminalTheme(colorTheme) })
  }, [manager, colorTheme])

  useEffect(() => {
    manager.current?.setGpuAcceleration(gpuAcceleration)
  }, [manager, gpuAcceleration])
}
