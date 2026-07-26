import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CACHE_DIR = path.join(os.homedir(), '.cache', 'pkgpilot')
const TTL_MS = 24 * 60 * 60 * 1000 // 1 day

const memory = new Map<string, unknown>()

function fileFor(key: string): string {
  return path.join(CACHE_DIR, crypto.createHash('sha1').update(key).digest('hex') + '.json')
}

export function cacheGet<T>(key: string, allowStale = false): T | undefined {
  if (memory.has(key)) return memory.get(key) as T
  try {
    const file = fileFor(key)
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { at: number; data: T }
    if (!allowStale && Date.now() - raw.at > TTL_MS) return undefined
    memory.set(key, raw.data)
    return raw.data
  } catch {
    return undefined
  }
}

export function cacheSet(key: string, data: unknown): void {
  memory.set(key, data)
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true })
    fs.writeFileSync(fileFor(key), JSON.stringify({ at: Date.now(), data }))
  } catch {
    // disk cache is best-effort
  }
}

/** fetch JSON with cache; falls back to stale cache when the network fails */
export async function cachedFetchJson<T>(url: string, headers?: Record<string, string>): Promise<T> {
  const hit = cacheGet<T>(url)
  if (hit !== undefined) return hit
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'pkgpilot/0.1 (TUI package helper)', ...headers } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as T
    cacheSet(url, data)
    return data
  } catch (err) {
    const stale = cacheGet<T>(url, true)
    if (stale !== undefined) return stale
    throw err
  }
}
