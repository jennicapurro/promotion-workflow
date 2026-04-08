FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build 2>&1 || (echo "=== BUILD FAILED ===" && npm run build 2>&1 && exit 1)

# ── Production image ──────────────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/templates ./templates

EXPOSE 3000

CMD ["node", "dist/app.js"]
