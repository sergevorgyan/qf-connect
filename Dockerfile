FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build -w apps/web
ENV NODE_ENV=production NODE_NO_WARNINGS=1
EXPOSE 3000
CMD ["npm", "start", "-w", "apps/api"]
