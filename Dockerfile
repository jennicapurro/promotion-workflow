FROM node:20-alpine

WORKDIR /app

# Install dependencies first (cached layer)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source and build
COPY . .
RUN npm run build

# Remove dev source after build
RUN rm -rf src

EXPOSE 3000

CMD ["node", "dist/app.js"]
