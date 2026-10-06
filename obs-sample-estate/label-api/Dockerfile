# label-api image (obs-label-api), the courier's label service lab 05 adds.
# Zero dependencies, so the build needs no registry access.
FROM node:22.23.1-bookworm-slim
WORKDIR /app
COPY server.mjs ./
EXPOSE 9100
CMD ["node", "server.mjs"]
