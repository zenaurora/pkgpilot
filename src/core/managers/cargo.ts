import type { Command, PendingPackage } from '../types.ts'

/**
 * Build `cargo add` commands. Packages without features are grouped into one
 * command; each package with features gets its own command so the
 * `--features` flag stays unambiguous.
 */
export function cargoAddCommands(root: string, pkgs: PendingPackage[]): Command[] {
  const cmds: Command[] = []
  const group = (list: PendingPackage[], dev: boolean) => {
    const plain = list.filter((p) => !p.features?.length)
    const withFeatures = list.filter((p) => p.features?.length)
    if (plain.length) {
      cmds.push({
        bin: 'cargo',
        args: ['add', ...(dev ? ['--dev'] : []), ...plain.map((p) => p.name)],
        cwd: root,
      })
    }
    for (const p of withFeatures) {
      cmds.push({
        bin: 'cargo',
        args: ['add', ...(dev ? ['--dev'] : []), p.name, '--features', p.features!.join(',')],
        cwd: root,
      })
    }
  }
  group(
    pkgs.filter((p) => !p.dev),
    false,
  )
  group(
    pkgs.filter((p) => p.dev),
    true,
  )
  return cmds
}

export function cargoRemoveCommand(root: string, names: string[]): Command {
  return { bin: 'cargo', args: ['remove', ...names], cwd: root }
}
