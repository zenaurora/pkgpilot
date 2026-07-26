import { render } from 'ink'
import { App } from './app.tsx'
import { detectProjects } from './core/project.ts'

const args = process.argv.slice(2)

if (args.includes('--help') || args.includes('-h')) {
  console.log(`pkgpilot - Rust/Python/JS 包管理 TUI 助手

用法: pkgpilot [目录]

在项目目录里运行（会向上查找 Cargo.toml / pyproject.toml / package.json）。

界面: 1 依赖  2 搜索  3 Bundles  4 扫描
全局: Tab/1-4 切换屏幕 · i 安装清单 · x 清空清单 · p 切换项目 · q 退出`)
  process.exit(0)
}

const cwd = args.find((a) => !a.startsWith('-')) ?? process.cwd()
const projects = detectProjects(cwd)

if (projects.length === 0) {
  console.error(`在 ${cwd} 及其上级目录中没有找到 Cargo.toml / pyproject.toml / package.json`)
  process.exit(1)
}

render(<App initialProjects={projects} />, { exitOnCtrlC: true })
