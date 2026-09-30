# 限制性内切酶图谱复原

基因治疗载体放行前的质控工具：录入同一条线性质粒构建体的总长度与
**酶A单酶切、酶B单酶切、双酶切** 三组正整数片段，网页在浏览器内联合枚举
双酶切片段的去重排列与内部切点归属（仅酶A / 仅酶B / 双切），复原切点顺序，
避免分别排列各组片段而得到彼此不能成立的图谱。

## 功能

- 三组片段长度各自校验等于总长度，否则按组提示输入错误；
- 复原成功后展示：从左端开始的双酶切片段、每个内部切点所属酶与坐标，
  以及两组单酶切如何由连续双酶切片段合并得到；
- 两种单酶切片段多重集必须完全吻合；整体反向视为同一图谱（按规范方向展示）；
- 存在多个非反向等价图谱时，给出两份见证并标明首个分歧（片段或切点及其坐标）；
- 无可行图谱时，按「酶A单酶切 → 酶B单酶切 → 双酶切联合」的顺序指出
  最先无法同时满足的消化组；
- 修改任一输入草稿立即清除旧结论；
- 枚举在浏览器内完成，片段数与枚举预算有限制，超限会明确提示。

## 运行网页

```bash
docker compose up --build web
# 打开 http://localhost:8080 （默认）
WEB_PORT=9090 docker compose up --build web   # 自定义宿主机端口
```

`web` 服务提供 HTTP 健康检查：`GET /healthz` 返回 `ok`
（Compose 与 Dockerfile 中均配置了 healthcheck）。

## 一次性验证（verify）

`verify` 服务依次完成：代码测试（node --test）→ 静态构建 →
三种业务结论（唯一图谱 / 多解见证 / 无可行图谱）→ 网页 HTTP 冒烟，
随后自行退出并以退出码报告结果：

```bash
docker compose up --build --exit-code-from verify verify
echo $?   # 0 = 全部通过
docker compose down
```

## 本地开发（无需 Docker）

```bash
node --test               # 代码测试
node scripts/build.js     # 构建到 dist/
node verify/business.js   # 三种业务结论
WEB_URL=http://localhost:8080 node verify/smoke.js  # 针对运行中的网页冒烟
```

## 目录结构

```
src/            静态前端（index.html / app.js / solver.js / styles.css / healthz）
  solver.js     纯求解逻辑：去重排列 + 切点归属联合枚举、反向等价去重、
                多解见证与首个分歧、分阶段不可行诊断（浏览器与 Node 通用）
scripts/build.js  静态构建（语法与资源引用校验，输出 dist/）
test/           node:test 单元测试
verify/         run.js（编排）/ business.js（三种业务结论）/ smoke.js（HTTP 冒烟）
Dockerfile      多阶段：build → test → web(nginx) / verify
docker-compose.yml  web（WEB_PORT 可配、HTTP 健康检查）+ verify（一次性）
```

## 示例输入

| 场景 | 总长度 | 酶A单酶切 | 酶B单酶切 | 双酶切 | 结论 |
| --- | --- | --- | --- | --- | --- |
| 唯一解 | 6 | 2, 2, 2 | 3, 3 | 1, 1, 2, 2 | 唯一图谱 `2—A@2—1—B@3—1—A@4—2` |
| 多解见证 | 8 | 1, 2, 5 | 3, 5 | 1, 2, 2, 3 | ≥2 个非反向等价图谱，给出两份见证与首个分歧 |
| 无可行图谱 | 10 | 2, 8 | 4, 6 | 1, 3, 3, 3 | 最先无法满足：酶A单酶切 |
