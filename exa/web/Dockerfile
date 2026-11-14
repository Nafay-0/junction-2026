# The Beryl server as a container: the Next.js app, built with its standalone output so the image
# holds only what the server needs to run. One process, listening on $PORT.
#
#   docker build -t beryl-web exa/web
#   docker run --rm -p 8080:8080 --env-file exa/.env.local beryl-web
#
# The desktop app is not in here (it is packaged on its own, see desktop/pack.mjs), and neither are
# its installers: the site sends visitors to wherever BERYL_DOWNLOADS_URL says they are.

FROM node:24-slim AS base
RUN npm install -g pnpm@11.17.0

# ── What the app depends on ──
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Electron is only for the desktop app: its 100 MB binary is not fetched here.
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN pnpm install --frozen-lockfile

# ── The build ──
FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# ── What runs ──
FROM node:24-slim AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=8080 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
# The server brings its database up to date when it starts: these are the changes it applies.
COPY --from=build --chown=node:node /app/drizzle ./drizzle
USER node
EXPOSE 8080
CMD ["node", "server.js"]
