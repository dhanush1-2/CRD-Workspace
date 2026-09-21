FROM node:24-slim AS base
RUN corepack enable
WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY apps/sync/package.json apps/sync/
# --ignore-scripts: the root postinstall script runs `prisma generate` for
# @crdt/db, but at this point only package.json files have been copied in
# (for layer caching) — schema.prisma doesn't exist yet, so that script
# would fail. Generate explicitly below, once the real source is present.
RUN pnpm install --frozen-lockfile --filter @crdt/sync... --ignore-scripts

COPY packages packages
COPY apps/sync apps/sync
COPY tsconfig.base.json ./
# packages/db/prisma.config.ts unconditionally calls process.loadEnvFile on the
# repo-root .env (unlike src/index.ts, which wraps the same call in a try/catch)
# and then resolves DATABASE_URL through it eagerly, even for `generate`, which
# never opens a connection. There is no .env in this image or in production —
# DATABASE_URL arrives via the host/Fly secrets at runtime — so an empty file
# satisfies the read, and a placeholder value (used only for this build step,
# not baked into the image's persistent ENV) satisfies the resolution.
RUN touch .env
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    pnpm --filter @crdt/db exec prisma generate

EXPOSE 1234
CMD ["pnpm", "--filter", "@crdt/sync", "start"]
