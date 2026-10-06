# payments-sim image. Part of box-office-estate (module 07, lab 07-hackathon-two-worlds).
# Built from the repository root so shared/logger.js can be copied in. The
# npm ci layer is reused after a source edit, so a rebuild needs no registry
# access.
FROM node:22-alpine
WORKDIR /app
COPY payments-sim/package.json payments-sim/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY shared/ ./shared/
COPY payments-sim/src/ ./src/
EXPOSE 7070
CMD ["node", "src/host.js"]
