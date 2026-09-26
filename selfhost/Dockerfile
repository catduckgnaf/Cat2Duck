FROM node:22-alpine
WORKDIR /app
COPY server.mjs .
ENV PORT=8787
ENV DATA_PATH=/data/state.json
VOLUME /data
EXPOSE 8787
CMD ["node", "server.mjs"]
