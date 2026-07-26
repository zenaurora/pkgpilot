import type { Command, PendingPackage } from '../types.ts'

export function uvAddCommands(root: string, pkgs: PendingPackage[]): Command[] {
  const cmds: Command[] = []
  const normal = pkgs.filter((p) => !p.dev)
  const dev = pkgs.filter((p) => p.dev)
  if (normal.length) {
    cmds.push({ bin: 'uv', args: ['add', ...normal.map((p) => p.name)], cwd: root })
  }
  if (dev.length) {
    cmds.push({ bin: 'uv', args: ['add', '--dev', ...dev.map((p) => p.name)], cwd: root })
  }
  return cmds
}

export function uvRemoveCommand(root: string, names: string[]): Command {
  return { bin: 'uv', args: ['remove', ...names], cwd: root }
}
