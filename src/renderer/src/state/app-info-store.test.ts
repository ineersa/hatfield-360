import { afterEach, expect, it, vi } from 'vitest'
import { useAppInfoStore } from './app-info-store'

afterEach(() => {
  useAppInfoStore.setState({ appInfo: null, error: null })
  vi.unstubAllGlobals()
})

it('records the failure instead of staying in the loading state when the IPC call rejects', async () => {
  vi.stubGlobal('desktop', { getAppInfo: () => Promise.reject(new Error('main unavailable')) })

  await useAppInfoStore.getState().loadAppInfo()

  expect(useAppInfoStore.getState()).toMatchObject({ appInfo: null, error: 'main unavailable' })
})

it('clears a previous failure once a retry succeeds', async () => {
  useAppInfoStore.setState({ error: 'main unavailable' })
  const appInfo = { name: 'app', version: '1.2.3', platform: 'linux', electronVersion: '45.0.0' }
  vi.stubGlobal('desktop', { getAppInfo: () => Promise.resolve(appInfo) })

  await useAppInfoStore.getState().loadAppInfo()

  expect(useAppInfoStore.getState()).toMatchObject({ appInfo, error: null })
})
