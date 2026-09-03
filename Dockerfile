FROM node:20-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public
COPY tests ./tests
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080
CMD ["node","src/server.js"]
