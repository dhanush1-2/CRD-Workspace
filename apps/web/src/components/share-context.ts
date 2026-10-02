'use client'

import { createContext, useContext } from 'react'

/**
 * Opens the share sheet. Provided by AppShell, which owns the open/closed state.
 * The default is a no-op so a component rendered outside the shell (a test, a
 * story) does not throw; inside the app it always resolves to the real opener.
 */
export const ShareContext = createContext<() => void>(() => {})

export function useShare(): () => void {
  return useContext(ShareContext)
}
