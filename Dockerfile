# GitFill: web app + worker in one image (Cloud Run or any container host).
# Headless Chromium (via playwright-core) renders deck pages to PNG and PDF; fonts are embedded in the pages.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates ffmpeg fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production PORT=8080 ARTIFACT_STORAGE_PATH=/data
COPY --from=build /app ./
# Chromium and its system libraries, at the revision pinned by playwright-core.
RUN npx playwright-core install --with-deps chromium && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /data && chown -R node:node /data /app
USER node
EXPOSE 8080
# Liveness probe for Docker/Compose (Cloud Run uses its own probes and ignores this). The start
# period covers migrations and Next.js start-up.
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8080) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
# Runs migrations, then the web server and the job worker side by side.
CMD ["sh", "-c", "npm run db:migrate && npx concurrently -k -n web,worker \"npx next start -p $PORT\" \"npm run worker\""]
