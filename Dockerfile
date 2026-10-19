# Build the page on the build machine's own architecture: the output is plain files that run anywhere
FROM --platform=$BUILDPLATFORM node:24-alpine AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts ./
COPY web ./web
RUN npm run build && mkdir /data

# No npm packages at runtime: Node runs the TypeScript directly and has SQLite built in.
# No RUN steps here either, so the ARM image builds without emulation.
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data
COPY --from=web --chown=node:node /data /data
COPY server ./server
COPY --from=web /app/web/dist ./web/dist
USER node
VOLUME /data
EXPOSE 8080
CMD ["node", "server/main.ts"]
