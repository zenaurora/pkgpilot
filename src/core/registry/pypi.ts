import type { RegistryResult } from '../types.ts'
import { cachedFetchJson } from './cache.ts'

interface PypiResponse {
  info: { name: string; version: string; summary: string | null }
}

/**
 * PyPI has no official search API; we verify exact package names instead.
 * Broader discovery is handled by the local alias table.
 */
export async function lookupPypi(name: string): Promise<RegistryResult[]> {
  if (!name.trim()) return []
  try {
    const data = await cachedFetchJson<PypiResponse>(
      `https://pypi.org/pypi/${encodeURIComponent(name.trim().toLowerCase())}/json`,
    )
    return [{ name: data.info.name, version: data.info.version, description: data.info.summary ?? '' }]
  } catch {
    return []
  }
}
