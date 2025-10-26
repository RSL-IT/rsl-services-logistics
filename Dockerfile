# syntax=docker/dockerfile:1

FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache openssl

# ---------- deps for build (dev deps included) ----------
FROM base AS build-deps
COPY package*.json ./
# Prisma must exist before npm ci because postinstall runs prisma generate
COPY prisma ./prisma
RUN npm ci

# ---------- build ----------
FROM base AS build
ENV NODE_ENV=development
COPY --from=build-deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---------- production runner ----------
FROM base AS runner
ENV NODE_ENV=production
# IMPORTANT: only set these at runtime; not during build
ENV HOST=0.0.0.0
ENV PORT=3000

COPY package*.json ./
COPY prisma ./prisma
# Production deps (postinstall will run prisma generate again — OK)
RUN npm ci --omit=dev && npm cache clean --force

# Bring built assets
COPY --from=build /app/build  ./build
COPY --from=build /app/public ./public

EXPOSE 3000
CMD ["npm", "run", "docker-start"]
