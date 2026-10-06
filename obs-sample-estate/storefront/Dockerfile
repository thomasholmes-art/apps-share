# storefront image (obs-storefront). The build stage runs `vite build`; the
# image keeps only the built files and the two Node scripts that serve them.
# node_modules is installed on the host from the committed package-lock.json
# at image bake, so the build works offline; `npm ci` runs only when it is
# missing.
FROM node:22.23.1-bookworm-slim AS build
WORKDIR /src
COPY . .
RUN [ -d node_modules ] || npm ci --no-audit --no-fund
RUN npx vite build

FROM node:22.23.1-bookworm-slim
WORKDIR /app
COPY --from=build /src/dist ./dist
COPY package.json server.mjs background.mjs ./
EXPOSE 5173
CMD ["node", "server.mjs"]
