FROM node:22-alpine

WORKDIR /app

COPY package.json ./
COPY . .

RUN npm install --omit=dev

ENTRYPOINT ["node", "mcp-server.js"]
