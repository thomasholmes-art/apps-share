# dispatch-worker image (obs-dispatch-worker). The directory is the
# container's /app. node_modules is installed on the host from the committed
# package-lock.json by install.sh and copied in, so the build works offline;
# `npm ci` runs only when node_modules is missing. Lab 05 mounts
# src/worker.mjs and the telemetry bootstrap over this image's copies.
FROM node:22.23.1-bookworm-slim
WORKDIR /app
COPY . .
RUN [ -d node_modules ] || npm ci --omit=dev --no-audit --no-fund
CMD ["node", "src/worker-main.js"]
