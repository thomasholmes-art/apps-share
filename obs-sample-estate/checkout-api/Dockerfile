# checkout-api image (obs-checkout-api). At run time docker-compose.yml
# mounts the whole checkout-api/ directory over /app, so the host copy is what
# runs and an edit plus `docker compose restart checkout-api` is enough. The
# copy baked in here only matters if the image is run without that mount.
# node_modules comes from the host (install.sh, committed lockfile), so the
# build works offline.
FROM node:22.23.1-bookworm-slim
WORKDIR /app
COPY . .
RUN [ -d node_modules ] || npm ci --no-audit --no-fund
EXPOSE 3000
CMD ["node", "src/server.js"]
