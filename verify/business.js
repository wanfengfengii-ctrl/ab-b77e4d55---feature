/*
 * 业务结论验证：
 *   1. 唯一图谱：复原出唯一的切点顺序（整体反向视为同一图谱）；
 *   2. 多解见证：存在多个非反向等价图谱时，给出两份首个分歧明确的见证；
 *   3. 无可行图谱：指出最先无法同时满足的消化组；
 *   4. 可鉴别：多解后录入候选验证酶，选出数量最少的一组双酶切实验区分全部定向假设；
 *   5. 不可鉴别：全部实验仍无法区分某对定向假设时，给出该对假设与逐项相同证据。
 */
'use strict';
const assert = require('node:assert/strict');
const solver = require('../src/solver.js');

const SITE_LABEL = { A: '酶A', B: '酶B', AB: '酶A+酶B' };
const GROUP_LABEL = { A: '酶A单酶切', B: '酶B单酶切', double: '双酶切（联合）' };

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failures++;
    console.error(`✗ ${name}\n  ${e.message}`);
  }
}

function describeMap(m) {
  const parts = [];
  m.fragments.forEach((f, i) => {
    if (i > 0) parts.push(`—[${SITE_LABEL[m.sites[i - 1]]}@${m.cuts[i - 1]}]—`);
    parts.push(String(f));
  });
  return parts.join('');
}

/* 业务结论 1：唯一图谱 */
check('业务1 唯一图谱复原（total=6, A=[2,2,2], B=[3,3], D=[1,1,2,2]）', () => {
  const res = solver.solve({ total: 6, A: [2, 2, 2], B: [3, 3], D: [1, 1, 2, 2] });
  assert.equal(res.status, 'unique');
  const m = res.solutions[0];
  assert.deepEqual(m.fragments, [2, 1, 1, 2]);
  assert.deepEqual(m.sites, ['A', 'B', 'A']);
  assert.deepEqual(m.cuts, [2, 3, 4]);
  assert.deepEqual(m.aRuns.map((r) => r.length), [2, 2, 2]);
  assert.deepEqual(m.bRuns.map((r) => r.length), [3, 3]);
  console.log(`  图谱: ${describeMap(m)}`);
  console.log('  酶A合并: [2]=D1, [2]=D2+D3, [2]=D4；酶B合并: [3]=D1+D2, [3]=D3+D4');
});

/* 业务结论 2：多解见证 */
check('业务2 多解见证（total=8, A=[1,2,5], B=[3,5], D=[1,2,2,3]）', () => {
  const res = solver.solve({ total: 8, A: [1, 2, 5], B: [3, 5], D: [1, 2, 2, 3] });
  assert.equal(res.status, 'multiple');
  assert.equal(res.solutions.length, 2);
  const [w1, w2] = res.solutions;
  for (const w of [w1, w2]) {
    assert.deepEqual(w.aRuns.map((r) => r.length).sort((x, y) => x - y), [1, 2, 5]);
    assert.deepEqual(w.bRuns.map((r) => r.length).sort((x, y) => x - y), [3, 5]);
  }
  const div = res.divergence;
  assert.ok(div, '应给出首个分歧');
  assert.equal(w1.tokens[div.tokenIndex], div.first);
  assert.equal(w2.tokens[div.tokenIndex], div.second);
  console.log(`  见证1: ${describeMap(w1)}`);
  console.log(`  见证2: ${describeMap(w2)}`);
  const what = div.kind === 'fragment'
    ? `第 ${div.fragmentIndex + 1} 个双酶切片段（起点坐标 ${div.coordinate}）：${div.first} ↔ ${div.second}`
    : `坐标 ${div.coordinate} 处切点：${SITE_LABEL[div.first]} ↔ ${SITE_LABEL[div.second]}`;
  console.log(`  首个分歧: ${what}`);
});

/* 业务结论 3：无可行图谱，指出最先无法同时满足的消化组 */
check('业务3 无可行图谱（total=10, A=[2,8], B=[4,6], D=[1,3,3,3]）→ 酶A单酶切', () => {
  const res = solver.solve({ total: 10, A: [2, 8], B: [4, 6], D: [1, 3, 3, 3] });
  assert.equal(res.status, 'infeasible');
  assert.equal(res.failure.group, 'A');
  console.log(`  最先无法同时满足的消化组: ${GROUP_LABEL[res.failure.group]}`);
  console.log(`  原因: ${res.failure.message}`);
});

check('业务3 补充：各自可行但联合不可行 → 双酶切（联合）', () => {
  const res = solver.solve({ total: 6, A: [1, 5], B: [1, 5], D: [1, 2, 3] });
  assert.equal(res.status, 'infeasible');
  assert.equal(res.failure.group, 'double');
  assert.deepEqual(res.failure.passed, ['A', 'B']);
  console.log(`  最先无法同时满足的消化组: ${GROUP_LABEL[res.failure.group]}`);
});

/* ---------- 多解输入：total=8, A=[1,2,5], B=[3,5], D=[1,2,2,3] ---------- */
const MULTI_RAW = { total: 8, A: [1, 2, 5], B: [3, 5], D: [1, 2, 2, 3] };

function pairSeparated(res, i, j, exp) {
  const key = 'C' + exp.partner;
  return JSON.stringify(res.predictions[i][exp.enzymeIdx][key]) !==
    JSON.stringify(res.predictions[j][exp.enzymeIdx][key]);
}

function separatesAllPairs(res, experiments) {
  const H = res.hypotheses.length;
  for (let i = 0; i < H; i++) {
    for (let j = i + 1; j < H; j++) {
      if (!experiments.some((exp) => pairSeparated(res, i, j, exp))) return false;
    }
  }
  return true;
}

/* 业务结论 4：可鉴别 —— 最少实验组、完整枚举、定向展开、并列稳定裁决 */
check('业务4 可鉴别（候选酶 E1@1,6 / E2@1 → 最少 2 项，取 [E1＋酶A, E1＋酶B]）', () => {
  const res = solver.designExperiments(MULTI_RAW, [
    { name: 'E1', cuts: [1, 6] },
    { name: 'E2', cuts: [1] }
  ]);
  assert.equal(res.status, 'distinguishable');
  assert.equal(res.classes.length, 3, '必须完整枚举全部 3 个非反向等价类');
  assert.equal(res.hypotheses.length, 6, '每个等价类按左端标记展开为正/反两种定向假设');
  assert.equal(res.discriminating.length, 2, '应选择数量最少的一组（2 项）');
  assert.ok(separatesAllPairs(res, res.discriminating), '所选实验必须真正区分全部假设对');
  assert.deepEqual(res.discriminating.map((e) => [e.enzymeName, e.partner]),
    [['E1', 'A'], ['E1', 'B']], '并列时按酶录入顺序、酶A优先裁决');
  console.log(`  等价类/定向假设: ${res.classes.length} 类 / ${res.hypotheses.length} 种假设`);
  console.log(`  最少实验组: ${res.discriminating.map((e) => e.label).join('；')}`);
});

check('业务4 补充：候选酶录入非法（切点越界、名称重复、数量越界）→ invalid', () => {
  assert.equal(solver.designExperiments(MULTI_RAW, [
    { name: 'X', cuts: [8] }, { name: 'Y', cuts: [2] }
  ]).status, 'invalid');
  assert.equal(solver.designExperiments(MULTI_RAW, [
    { name: 'X', cuts: [1] }, { name: 'X', cuts: [2] }
  ]).status, 'invalid');
  assert.equal(solver.designExperiments(MULTI_RAW, [{ name: 'X', cuts: [1] }]).status, 'invalid');
});

/* 业务结论 5：不可鉴别 —— 给出一对预测始终相同的假设及逐项片段证据 */
check('业务5 不可鉴别（候选酶 C1@2 / C2@4 → 存在预测始终相同的一对假设）', () => {
  const res = solver.designExperiments(MULTI_RAW, [
    { name: 'C1', cuts: [2] },
    { name: 'C2', cuts: [4] }
  ]);
  assert.equal(res.status, 'indistinguishable');
  assert.equal(res.classes.length, 3);
  assert.equal(res.hypotheses.length, 6);
  const p = res.indistinguishablePair;
  assert.ok(p && p.first !== p.second);
  assert.ok(p.evidence.length >= 4);
  p.evidence.forEach((ev) => {
    assert.equal(ev.equal, true, '证据项必须逐项相同：' + ev.enzymeName + ' ' + ev.kind);
    assert.deepEqual(ev.first, ev.second);
    assert.equal(ev.first.reduce((a, b) => a + b, 0), 8, '预测片段之和必须等于总长度');
  });
  // 该对假设在全部候选实验上确实都不被区分
  res.allExperiments.forEach((exp) => {
    assert.equal(pairSeparated(res, p.firstIndex, p.secondIndex, exp), false);
  });
  console.log(`  无法区分: ${p.first}  ↔  ${p.second}`);
  p.evidence.forEach((ev) => {
    const what = ev.kind === 'C' ? `${ev.enzymeName}单酶切` : `${ev.enzymeName}＋酶${ev.partner}`;
    console.log(`  证据 ${what}: [${ev.first.join(', ')}] == [${ev.second.join(', ')}]`);
  });
});

if (failures) {
  console.error(`\n业务结论验证失败：${failures} 项`);
  process.exit(1);
}
console.log('\n五种业务结论全部验证通过');
