/* 网页 HTTP 冒烟：静态资源可达且内容符合预期，健康检查端点正常。 */
'use strict';

const base = (process.env.WEB_URL || 'http://web:80').replace(/\/+$/, '');

const checks = [
  ['/', (res, body) => res.status === 200 && body.includes('限制性内切酶图谱复原')],
  ['/solver.js', (res, body) => res.status === 200 && body.includes('DigestSolver')],
  ['/app.js', (res, body) => res.status === 200 && body.includes('DigestSolver')],
  ['/styles.css', (res, body) => res.status === 200 && body.includes('.track')],
  ['/healthz', (res, body) => res.status === 200 && body.trim() === 'ok']
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(path) {
  let lastErr;
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      return await fetch(base + path);
    } catch (e) {
      lastErr = e;
      await sleep(500);
    }
  }
  throw lastErr;
}

(async () => {
  let failed = 0;
  for (const [path, ok] of checks) {
    try {
      const res = await get(path);
      const body = await res.text();
      if (ok(res, body)) {
        console.log(`✓ GET ${path} → ${res.status}`);
      } else {
        failed++;
        console.error(`✗ GET ${path} → ${res.status}，内容校验失败`);
      }
    } catch (e) {
      failed++;
      console.error(`✗ GET ${path} → ${e.message}`);
    }
  }
  if (failed) {
    console.error(`\nHTTP 冒烟失败：${failed} 项（目标 ${base}）`);
    process.exit(1);
  }
  console.log(`\nHTTP 冒烟全部通过（目标 ${base}）`);
})();
