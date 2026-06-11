FROM node:20-bookworm AS builder
WORKDIR /app

# Copy workspace root + all workspace package files (needed for npm ci resolution)
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY cli/package.json cli/package.json

# Install server workspace deps (deterministic via root lockfile)
RUN npm ci --workspace=talos-portal

# Install web dashboard deps (not a workspace member)
COPY server/web/package.json server/web/package.json
RUN cd server/web && npm install

# Build server TypeScript
COPY server/tsconfig.json server/tsconfig.json
COPY server/src/ server/src/
RUN npm run build --workspace=talos-portal

# Build web dashboard
COPY server/web/ server/web/
RUN cd server/web && npx vite build --outDir /app/server/dist/web

FROM node:20-bookworm-slim
WORKDIR /app/server
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/server/dist ./dist
RUN mkdir -p /app/data
ENV DB_PATH=/app/data/talos.db
EXPOSE 8080
CMD ["node", "dist/index.js"]
