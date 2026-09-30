/* 静态站点构建：校验必需文件、JS 语法、HTML 资源引用，然后输出 dist/。 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const src = path.join(root, 'src');
const dist = path.join(root, 'dist');

const required = ['index.html', 'app.js', 'solver.js', 'styles.css', 'healthz'];
let ok = true;

for (const f of required) {
  if (!fs.existsSync(path.join(src, f))) {
    console.error(`✗ 缺少文件 src/${f}`);
    ok = false;
  }
}
if (!ok) process.exit(1);

for (const f of ['app.js', 'solver.js']) {
  const code = fs.readFileSync(path.join(src, f), 'utf8');
  try {
    new vm.Script(code, { filename: f });
    console.log(`✓ 语法检查 ${f}`);
  } catch (e) {
    console.error(`✗ 语法错误 ${f}: ${e.message}`);
    ok = false;
  }
}

const html = fs.readFileSync(path.join(src, 'index.html'), 'utf8');
const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
  .map((m) => m[1])
  .filter((u) => !/^https?:/.test(u) && !u.startsWith('#') && !u.startsWith('data:'));
for (const r of refs) {
  if (!fs.existsSync(path.join(src, r))) {
    console.error(`✗ index.html 引用了不存在的资源: ${r}`);
    ok = false;
  } else {
    console.log(`✓ 资源引用 ${r}`);
  }
}
if (!ok) process.exit(1);

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
for (const f of required) {
  fs.copyFileSync(path.join(src, f), path.join(dist, f));
}
console.log(`✓ 构建完成: dist/ (${required.join(', ')})`);
