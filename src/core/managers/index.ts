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

export interface UpgradeTarget {
  name: string
  /** 注册表最新版本号 */
  latest: string
  dev?: boolean
  /** 重新 add 时必须带上原有 features，否则 cargo add 会把它们丢掉 */
  features?: string[]
}

/**
 * 升级 = 重新 add 到指定版本：cargo/js 用 name@ver，uv 用 name>=ver。
 * 复用 add 的分组逻辑（dev / features 拆命令）。
 */
export function buildUpgradeCommands(project: ProjectInfo, targets: UpgradeTarget[]): Command[] {
  if (!targets.length) return []
  const pkgs: PendingPackage[] = targets.map((t) => ({
    name: project.lang === 'python' ? `${t.name}>=${t.latest}` : `${t.name}@${t.latest}`,
    lang: project.lang,
    dev: t.dev,
    features: t.features,
  }))
  return buildAddCommands(project, pkgs)
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
