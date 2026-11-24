import { expect, test } from 'vitest'
import { MAX_NOTIFICATIONS, useNotificationStore } from './notification-store'

test('the panel keeps only the newest notifications', () => {
  const { notify } = useNotificationStore.getState()
  for (let index = 1; index <= MAX_NOTIFICATIONS + 5; index += 1)
    notify({ severity: 'info', title: `Notification ${index}` }, { showToast: false })
  const titles = useNotificationStore.getState().notifications.map(({ title }) => title)
  expect(titles).toHaveLength(MAX_NOTIFICATIONS)
  expect(titles[0]).toBe(`Notification ${MAX_NOTIFICATIONS + 5}`)
  expect(titles.at(-1)).toBe('Notification 6')
})
