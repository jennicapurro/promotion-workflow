FROM node:20-slim

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY src/ ./src/
COPY templates/ ./templates/
COPY tsconfig.json ./

EXPOSE 3000

CMD ["node_modules/.bin/ts-node", "--transpile-only", "src/app.ts"]
