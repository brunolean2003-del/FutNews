# Imagem mínima: o Apito não tem dependências além do Node.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY package.json server.js ./
COPY src ./src
COPY public ./public
COPY materias ./materias
RUN mkdir -p data && chown -R node:node /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:${PORT}/healthz || exit 1
CMD ["node", "server.js"]
