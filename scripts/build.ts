/// <reference types="bun-types" />
// Build script: bundles for Node, stubs out ink's optional react-devtools-core dependency.
import { chmodSync } from 'node:fs'

const result = await Bun.build({
  entrypoints: ['src/index.tsx'],
  outdir: 'dist',
  target: 'node',
  format: 'esm',
  banner: '#!/usr/bin/env node',
  define: { 'process.env.DEV': '"false"' },
  plugins: [
    {
      name: 'stub-react-devtools',
      setup(build) {
        build.onResolve({ filter: /^react-devtools-core$/ }, () => ({
          path: 'react-devtools-core-stub',
          namespace: 'stub',
        }))
        build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
          contents: 'export default { connectToDevTools() {} }',
          loader: 'js',
        }))
      },
    },
  ],
})

if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

chmodSync('dist/index.js', 0o755)
console.log('built dist/index.js')
