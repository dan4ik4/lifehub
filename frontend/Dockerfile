FROM node:24-alpine AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN npm install --global pnpm@11.19.0 && pnpm install --frozen-lockfile
COPY . .
ARG VITE_GOOGLE_CLIENT_ID=""
ARG VITE_APPLE_CLIENT_ID=""
ARG VITE_APPLE_REDIRECT_URI=""
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID VITE_APPLE_CLIENT_ID=$VITE_APPLE_CLIENT_ID VITE_APPLE_REDIRECT_URI=$VITE_APPLE_REDIRECT_URI
RUN pnpm build

FROM nginxinc/nginx-unprivileged:stable-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
