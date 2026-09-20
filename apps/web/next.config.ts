import type { NextConfig } from 'next'

const config: NextConfig = {
  transpilePackages: ['@crdt/shared', '@crdt/db'],
  // Turbopack cannot resolve @crdt/shared's NodeNext-style '.js' relative
  // imports, and does not support extensionAlias. The Node-side packages
  // genuinely need those extensions, so the workaround lives here rather
  // than in the shared package. Reconsider when Turbopack supports aliasing.
  experimental: {
    extensionAlias: { '.js': ['.ts', '.tsx', '.js'] },
  },
}

export default config
