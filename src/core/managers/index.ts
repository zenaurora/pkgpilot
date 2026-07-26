import { spawn } from 'node:child_process'
import type { Command, PendingPackage, ProjectInfo } from '../types.ts'
import { cargoAddCommands, cargoRemoveCommand } from './cargo.ts'
import { jsAddCommands, jsRemoveCommand } from './js.ts'
import { uvAddCommands, uvRemoveCommand } from './uv.ts'

export function buildAddCommands(project: ProjectInfo, pkgs: PendingPackage[]): Command[] {
  const mine = pkgs.filter((p) => p.lang === project.lang)
  if (!mine.length) return []
  switch (project.lang) {
    case 'rust':
      return cargoAddCommands(project.root, mine)
    case 'python':
      return uvAddCommands(project.root, mine)
    case 'js':
      return jsAddCommands(project.root, project.jsManager ?? 'npm', mine)
  }
}

export function buildRemoveCommands(project: ProjectInfo, names: string[]): Command[] {
  if (!names.length) return []
  switch (project.lang) {
    case 'rust':
      return [cargoRemoveCommand(project.root, names)]
    case 'python':
      return [uvRemoveCommand(project.root, names)]
    case 'js':
      return [jsRemoveCommand(project.root, project.jsManager ?? 'npm', names)]
  }
}

export function formatCommand(cmd: Command): string {
  return `${cmd.bin} ${cmd.args.join(' ')}`
}

/** Run a command, streaming merged stdout+stderr lines via onLine. */
export function runCommand(cmd: Command, onLine: (line: string) => void): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(cmd.bin, cmd.args, { cwd: cmd.cwd, env: process.env })
    const feed = (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) {
        if (line.trim()) onLine(line)
      }
    }
    child.stdout.on('data', feed)
    child.stderr.on('data', feed)
    child.on('error', (err) => {
      onLine(`error: ${err.message}`)
      resolve(1)
    })
    child.on('close', (code) => resolve(code ?? 1))
  })
}

/** Run commands sequentially, stop at first failure. Returns overall exit code. */
export async function runCommands(cmds: Command[], onLine: (line: string) => void): Promise<number> {
  for (const cmd of cmds) {
    onLine(`$ ${formatCommand(cmd)}`)
    const code = await runCommand(cmd, onLine)
    if (code !== 0) {
      onLine(`exited with code ${code}`)
      return code
    }
  }
  return 0
}
