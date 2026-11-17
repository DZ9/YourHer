FROM node:24-alpine
WORKDIR /app
COPY --chown=node:node . .
RUN mkdir -p /data && chown node:node /data
USER node
ENV HOST=0.0.0.0 PORT=4317 DATA_DIR=/data
EXPOSE 4317
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:4317/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
