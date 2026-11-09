FROM node:22-alpine AS deps

WORKDIR /app

COPY package*.json ./

RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi


FROM node:22-alpine AS build

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm run build

# The runtime only needs production dependencies. The development-only COA
# tooling (Canvas, PDF.js and Tesseract) stays out of the deployed image.
RUN npm prune --omit=dev


FROM node:22-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4321

COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

EXPOSE 4321

CMD ["node", "./dist/server/entry.mjs"]
