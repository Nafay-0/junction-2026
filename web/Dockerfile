# AimoPilot web app for Aiven Runtime (also runs anywhere with Docker).
# Aiven Runtime builds this from the Git repository: build context web/, this file web/Dockerfile.
# Runtime terminates TLS on 443 and forwards plain HTTP to the port below.
#
#   docker build -t dock web && docker run --rm -p 8080:8080 dock

FROM node:24-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm install -g pnpm@12.18.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
# The hosted build has 4 GB of memory, and `next build`'s own type check was killed at that limit on 14 Nov. Types
# are checked before every merge (pnpm typecheck in the check chain and in CI), so the image build skips that step.
ENV DOCK_BUILD_SKIP_TYPES=1
RUN pnpm build && pnpm prune --prod

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=8080
ENV HOSTNAME=0.0.0.0
# Built app plus production dependencies only (pnpm prune --prod above).
COPY --from=build --chown=node:node /app ./
USER node
EXPOSE 8080
CMD ["node", "node_modules/next/dist/bin/next", "start", "-p", "8080", "-H", "0.0.0.0"]
