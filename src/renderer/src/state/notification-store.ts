import { create } from 'zustand'
import type { Notice } from '../../../shared/notice'

export type NotificationSeverity = 'error' | 'warning' | 'info'

export type AppNotification = {
  id: number
  severity: NotificationSeverity
  title: string
  body?: string
  action?: { label: string; run: () => void }
  /** When it was raised, in ms since the epoch. */
  time: number
}

export type NotificationInput = Omit<AppNotification, 'id' | 'time'>

type NotificationState = {
  /** Newest first; kept for the session after their toasts close. */
  notifications: AppNotification[]
  /** Notifications whose toasts are on screen, oldest first. */
  toasts: number[]
  panelOpen: boolean
  /** Adds to history and shows a toast unless suppressed; returns its id. */
  notify: (input: NotificationInput, options?: { showToast?: boolean }) => number
  closeToast: (id: number) => void
  /** Removes it from the list, closing its toast too. */
  dismiss: (id: number) => void
  clearAll: () => void
  togglePanel: () => void
}

let lastId = 0

/** More would cover the window; older ones stay in the panel. */
const MAX_TOASTS = 3
/** The panel keeps the newest ones; older ones drop off the end. */
export const MAX_NOTIFICATIONS = 100

export const useNotificationStore = create<NotificationState>((set) => ({
  notifications: [],
  toasts: [],
  panelOpen: false,
  notify: (input, options) => {
    lastId += 1
    const id = lastId
    set((state) => ({
      notifications: [{ ...input, id, time: Date.now() }, ...state.notifications].slice(
        0,
        MAX_NOTIFICATIONS
      ),
      // The open panel already shows it.
      toasts:
        state.panelOpen || options?.showToast === false
          ? state.toasts
          : [...state.toasts, id].slice(-MAX_TOASTS)
    }))
    return id
  },
  closeToast: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast !== id) })),
  dismiss: (id) =>
    set((state) => ({
      notifications: state.notifications.filter((notification) => notification.id !== id),
      toasts: state.toasts.filter((toast) => toast !== id)
    })),
  clearAll: () => set({ notifications: [], toasts: [] }),
  // Every toast is in the panel, so opening it closes them.
  togglePanel: () =>
    set((state) => (state.panelOpen ? { panelOpen: false } : { panelOpen: true, toasts: [] }))
}))

export const notify = (input: NotificationInput, options?: { showToast?: boolean }): number =>
  useNotificationStore.getState().notify(input, options)

/**
 * Follows a notice main keeps about its current state: a new notice shows a toast; once main
 * clears or replaces it, that toast closes, since it no longer holds. The list keeps it.
 */
export function followNotice(
  toNotification: (message: string) => NotificationInput
): (notice: Notice | null) => void {
  let shown: { noticeId: number; toastId: number } | null = null
  return (notice) => {
    if (notice?.id === shown?.noticeId) return
    if (shown) useNotificationStore.getState().closeToast(shown.toastId)
    shown = notice ? { noticeId: notice.id, toastId: notify(toNotification(notice.message)) } : null
  }
}
