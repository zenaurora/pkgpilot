import { createContext, useContext } from 'react'
import type { Command, PendingPackage, ProjectInfo } from './core/types.ts'

export interface AppCtx {
  project: ProjectInfo
  projects: ProjectInfo[]
  cycleProject: () => void
  refreshProject: () => void
  cart: PendingPackage[]
  addToCart: (pkg: PendingPackage) => void
  clearCart: () => void
  /** true while some TextInput owns the keyboard, disables global shortcuts */
  inputActive: boolean
  setInputActive: (v: boolean) => void
  openFeatures: (pkg: PendingPackage) => void
  /** 打开包资料浮层（摘要 + README 快速上手） */
  openDoc: (pkg: PendingPackage) => void
  openExec: (commands: Command[], kind: 'add' | 'remove' | 'upgrade') => void
  status: string
  setStatus: (s: string) => void
}

export const AppContext = createContext<AppCtx>(null as unknown as AppCtx)

export function useAppCtx(): AppCtx {
  return useContext(AppContext)
}
