FROM node:24-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.31-alpine AS runtime
# Read from the container's resolv.conf at start, for the markets proxy.
ENV NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1
# Keys for the AI Leaderboard and Popular TV widgets, given at run time (never
# baked in). Defined empty so the template always fills them in.
ENV BENCHLM_TOKEN="" TMDB_TOKEN=""
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
