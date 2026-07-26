import type { Lang, RegistryResult } from '../types.ts'
import { searchCrates } from './crates.ts'
import { searchNpm } from './npm.ts'
import { lookupPypi } from './pypi.ts'

export { fetchCrateFeatures, type CrateFeature } from './crates.ts'

export async function searchRegistry(lang: Lang, query: string): Promise<RegistryResult[]> {
  switch (lang) {
    case 'rust':
      return searchCrates(query)
    case 'js':
      return searchNpm(query)
    case 'python':
      return lookupPypi(query)
  }
}
