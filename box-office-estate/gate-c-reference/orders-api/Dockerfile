# orders-api image. Part of box-office-estate (module 07, lab 07-hackathon-two-worlds).
# Built from the repository root so shared/logger.js can be copied in. The
# npm ci layer depends only on package.json and package-lock.json, so after a
# source edit `docker compose up -d --build orders-api` reuses it and needs no
# registry access.
FROM node:22-alpine
WORKDIR /app
COPY orders-api/package.json orders-api/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY shared/ ./shared/
COPY orders-api/tsconfig.json orders-api/instrumentation.mjs ./
COPY orders-api/seed/ ./seed/
COPY orders-api/src/ ./src/
RUN npx tsc -p tsconfig.json
EXPOSE 4000
CMD ["node", "dist/server.js"]
