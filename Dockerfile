# syntax=docker/dockerfile:1.7

# =============================================================================
# Potluck API
# =============================================================================
# Multi-stage so the runtime image carries no toolchain, no source and no dev
# dependencies. It lands at ~447 MB, most of which is the production dependency
# tree rather than the base image. That matters here: the node this runs on has
# 1 GB of RAM, so the image is worth trimming further if the node gets tight.
# =============================================================================

FROM node:22-alpine AS base
# corepack is not available on the machine this was developed on, so pnpm is
# installed explicitly and pinned to the version package.json declares.
RUN npm install -g pnpm@11.20.0
# pnpm 11 runs a dependency-status check before `run` and offers to purge
# node_modules; with no TTY it aborts with ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_
# NO_TTY and the build dies. CI=true makes it non-interactive.
ENV CI=true
WORKDIR /app


# --- build ------------------------------------------------------------------
# Installs and builds in one stage. An earlier version installed in a separate
# stage and copied node_modules across, which is what triggered the purge check
# above — pnpm rightly considered the copied tree unverifiable. Manifests are
# copied before source so a code-only change still reuses the install layer.
FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile

COPY . .
# Typechecks as part of the build: an image that compiles is the minimum bar for
# one that ships, and catching it here beats catching it in a CrashLoopBackOff.
RUN pnpm --filter @potluck/core build && pnpm --filter @potluck/api build


# --- production dependencies ------------------------------------------------
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/core/package.json packages/core/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile --prod --filter @potluck/api... --filter @potluck/core...


# --- runtime ----------------------------------------------------------------
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
# Cap the heap below the container limit. Without this Node sizes its heap from
# the HOST's memory rather than the cgroup's, grows past the pod limit, and gets
# killed by the kernel — which shows up as a mysterious restart, not an OOM.
ENV NODE_OPTIONS=--max-old-space-size=192

# A real PID 1, so SIGTERM reaches Node and the graceful drain in server.ts
# actually runs during a rolling deploy.
RUN apk add --no-cache dumb-init

WORKDIR /app

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=prod-deps /app/packages/core/node_modules ./packages/core/node_modules

COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/apps/api/package.json ./apps/api/
COPY --from=build /app/packages/core/package.json ./packages/core/
COPY --from=build /app/package.json ./

# Migrations and the SQL the security model depends on ship inside the image, so
# a deploy and its schema can never disagree about which version they are.
COPY --from=build /app/apps/api/drizzle ./apps/api/drizzle
COPY apps/api/src/db/rls.sql apps/api/src/db/search.sql ./apps/api/dist/db/

# @potluck/core points at its TypeScript source so dev tooling can read it
# directly with no build step. Node cannot, so the entry points are rewritten to
# the compiled output for the runtime image only. Doing it here rather than in
# the committed package.json keeps the dev experience intact.
RUN node -e "const p='./packages/core/package.json',j=require(p),fs=require('fs'); \
  j.main='./dist/index.js'; j.types='./dist/index.d.ts'; \
  j.exports={'.':{types:'./dist/index.d.ts',default:'./dist/index.js'}}; \
  fs.writeFileSync(p, JSON.stringify(j,null,2));"

USER node

EXPOSE 8787
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "apps/api/dist/server.js"]
