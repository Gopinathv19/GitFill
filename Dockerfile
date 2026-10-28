# GitFill: web app + worker in one image (Cloud Run or any container host).
# LibreOffice renders slides; Carlito/Liberation fonts are metric-compatible with Calibri/Courier New.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends libreoffice-impress poppler-utils fonts-crosextra-carlito fonts-liberation fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production PORT=8080 ARTIFACT_STORAGE_PATH=/data
COPY --from=build /app ./
RUN mkdir -p /data && chown -R node:node /data /app
USER node
EXPOSE 8080
# Runs migrations, then the web server and the job worker side by side.
CMD ["sh", "-c", "npm run db:migrate && npx concurrently -k -n web,worker \"npx next start -p $PORT\" \"npm run worker\""]
