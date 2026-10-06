# box-office image. Part of box-office-estate (module 07, lab 07-hackathon-two-worlds).
# The React app is built once into static files and served by nginx.
FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY index.html vite.config.js ./
COPY src ./src
RUN npm run build

FROM nginx:1.27-alpine
# Makes the nginx entry point write the container's DNS resolver into
# NGINX_LOCAL_RESOLVERS for the template below.
ENV NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /src/dist /usr/share/nginx/html
