FROM --platform=linux/amd64 node:24-bookworm-slim

USER root

WORKDIR /app

COPY worker/review-core.mjs ./review-core.mjs
COPY worker/server.mjs ./server.mjs

ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.mjs"]
