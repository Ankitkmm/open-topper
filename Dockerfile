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

# Public static assets are copied above. App runtime JSON that is safe to ship
# is bundled/traced by Next during the standalone build. Do not copy private
# ignored roots such as local-pdfs/, extracted_data/, vault_merged_docs/, or
# private data/app/* sources into this image.

EXPOSE 3000

CMD ["node", "server.js"]
