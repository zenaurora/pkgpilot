import type { RegistryResult } from '../types.ts'
import { cachedFetchJson } from './cache.ts'

interface NpmSearchResponse {
  objects: { package: { name: string; version: string; description?: string } }[]
}

export async function searchNpm(query: string, limit = 10): Promise<RegistryResult[]> {
  if (!query.trim()) return []
  const data = await cachedFetchJson<NpmSearchResponse>(
    `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=${limit}`,
  )
  return data.objects.map((o) => ({
    name: o.package.name,
    version: o.package.version,
    description: o.package.description ?? '',
  }))
}
