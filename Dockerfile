# ─── Build stage ────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

# Install dependencies (layer cache)
COPY package*.json ./
RUN npm ci

# Copy source
COPY . .

# Build Next.js standalone output
RUN npm run build

# ─── Production stage ───────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Copy standalone output from builder
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Ensure data files are included (they're in public/data/)
# If you have data outside public/, copy them explicitly:
# COPY --from=builder /app/data ./data

EXPOSE 3000

CMD ["node", "server.js"]
