# syntax=docker/dockerfile:1

########## 构建：校验并装配静态资源 ##########
FROM node:22-alpine AS build
WORKDIR /app
COPY src/ ./src/
COPY scripts/ ./scripts/
RUN node scripts/build.js

########## 代码测试：构建镜像时即失败 ##########
FROM build AS test
COPY test/ ./test/
RUN node --test

########## 静态前端（nginx） ##########
FROM nginx:1.27-alpine AS web
COPY --from=build /app/dist /usr/share/nginx/html
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
  CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1

########## verify：一次性验证服务 ##########
FROM test AS verify
COPY verify/ ./verify/
ENV WEB_URL=http://web:80
CMD ["node", "verify/run.js"]
