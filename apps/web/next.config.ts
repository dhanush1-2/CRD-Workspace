import type { NextConfig } from 'next'

const config: NextConfig = {
  transpilePackages: ['@crdt/shared', '@crdt/db'],
}

export default config
