/*
 * verify 一次性服务编排器：依次执行
 *   1. 代码测试（node --test）
 *   2. 静态构建（scripts/build.js）
 *   3. 五种业务结论（verify/business.js：唯一/多解/不可行/可鉴别/不可鉴别）
 *   4. 页面交互冒烟（verify/dom-smoke.js：DOM 事件链路）
 *   5. 网页 HTTP 冒烟（verify/smoke.js）
 * 全部完成后自行退出，退出码 0 表示全部通过，非 0 表示存在失败步骤。
 */
'use strict';
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const appRoot = path.join(__dirname, '..');

const steps = [
  ['代码测试', ['--test']],
  ['静态构建', ['scripts/build.js']],
  ['五种业务结论', ['verify/business.js']],
  ['页面交互冒烟', ['verify/dom-smoke.js']],
  ['网页 HTTP 冒烟', ['verify/smoke.js']]
];

let failed = 0;
for (const [name, args] of steps) {
  console.log(`\n========== ${name} ==========`);
  const r = spawnSync(process.execPath, args, { stdio: 'inherit', cwd: appRoot });
  if (r.status === 0) {
    console.log(`✓ ${name} 通过`);
  } else {
    failed++;
    console.error(`✗ ${name} 失败（退出码 ${r.status}）`);
  }
}

console.log('\n========================================');
if (failed) {
  console.error(`VERIFY FAILED：${failed} 个步骤未通过`);
  process.exit(1);
}
console.log('VERIFY OK：代码测试、构建、五种业务结论、页面交互冒烟、HTTP 冒烟全部通过');
process.exit(0);
