FROM node:22-alpine
WORKDIR /app
COPY . .
ENV PORT=3001
EXPOSE 3001
USER node
# --watch restarts the server when files in the mounted folder change
CMD ["node", "--watch", "server.js"]
