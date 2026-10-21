# Build context is the repository root (see docker-compose.yml).
FROM node:22-alpine AS build
WORKDIR /app

# Build the client
COPY client/package.json client/package-lock.json ./client/
RUN cd client && npm install
COPY client ./client
RUN cd client && npm run build

# Build the server
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm install
COPY server ./server
RUN cd server && npm run build

FROM node:22-alpine
WORKDIR /app/server
ENV NODE_ENV=production
COPY server/package.json server/package-lock.json ./
RUN npm install --omit=dev
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/server/migrations ./migrations
COPY --from=build /app/client/dist /app/client/dist
EXPOSE 4000
CMD ["sh", "-c", "node dist/scripts/migrate.js && node dist/index.js"]
