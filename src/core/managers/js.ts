import type { Command, JsManager, PendingPackage } from '../types.ts'

const ADD_VERB: Record<JsManager, string[]> = {
  bun: ['add'],
  pnpm: ['add'],
  yarn: ['add'],
  npm: ['install'],
}

const REMOVE_VERB: Record<JsManager, string[]> = {
  bun: ['remove'],
  pnpm: ['remove'],
  yarn: ['remove'],
  npm: ['uninstall'],
}

const DEV_FLAG: Record<JsManager, string> = {
  bun: '-d',
  pnpm: '-D',
  yarn: '-D',
  npm: '-D',
}

export function jsAddCommands(root: string, manager: JsManager, pkgs: PendingPackage[]): Command[] {
  const cmds: Command[] = []
  const normal = pkgs.filter((p) => !p.dev)
  const dev = pkgs.filter((p) => p.dev)
  if (normal.length) {
    cmds.push({ bin: manager, args: [...ADD_VERB[manager], ...normal.map((p) => p.name)], cwd: root })
  }
  if (dev.length) {
    cmds.push({
      bin: manager,
      args: [...ADD_VERB[manager], DEV_FLAG[manager], ...dev.map((p) => p.name)],
      cwd: root,
    })
  }
  return cmds
}

export function jsRemoveCommand(root: string, manager: JsManager, names: string[]): Command {
  return { bin: manager, args: [...REMOVE_VERB[manager], ...names], cwd: root }
}
