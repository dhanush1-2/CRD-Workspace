FROM node:24-slim AS base
RUN corepack enable
WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY apps/sync/package.json apps/sync/
COPY apps/web/package.json apps/web/
# --ignore-scripts: same reason as apps/sync/Dockerfile — the root postinstall
# script runs `prisma generate` before schema.prisma is copied in, and it would
# also trigger Playwright's browser download for @crdt/web's devDependency,
# which this image never needs (it only builds and serves the Next app).
RUN pnpm install --frozen-lockfile --filter @crdt/web... --ignore-scripts

COPY packages packages
COPY apps/sync apps/sync
COPY apps/web apps/web
COPY tsconfig.base.json ./

# packages/db/prisma.config.ts resolves DATABASE_URL eagerly, even for
# `generate`, which never opens a connection. There is no .env in this image
# or in production — DATABASE_URL arrives via the host/Fly secrets at
# runtime — so a placeholder value (used only for this build step, never
# baked into the image's persistent ENV) satisfies that resolution.
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    pnpm --filter @crdt/db exec prisma generate

# packages/db/src/index.ts loads the repo-root .env via `new URL('../../../.env',
# import.meta.url)`. webpack statically rewrites that call into an asset-module
# reference at compile time — it needs a real file to point to on disk, or the
# build fails with "Module not found", regardless of whether the file has any
# content. An empty file satisfies it; the value never matters here because
# next.config.ts's own .env loading (see its comment) and the DATABASE_URL
# below are what actually reach process.env.
RUN touch .env

# next.config.ts loads the repo-root .env directly (see its own comment) but
# tolerates it being absent, which is the case here and in production. Next's
# "collecting page data" step imports /documents/[id]/page.tsx to inspect its
# route config, which transitively constructs the @crdt/db Prisma client at
# module scope — no query runs, but the module throws if DATABASE_URL is
# entirely unset, so a placeholder (build-time only, never baked into the
# image's persistent ENV) is enough to get through page collection.
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    pnpm --filter @crdt/web run build

EXPOSE 3000
CMD ["pnpm", "--filter", "@crdt/web", "start"]
