/*
 * 业务结论验证：
 *   1. 唯一图谱：复原出唯一的切点顺序（整体反向视为同一图谱）；
 *   2. 多解见证：存在多个非反向等价图谱时，给出两份首个分歧明确的见证；
 *   3. 无可行图谱：指出最先无法同时满足的消化组；
 *   4. 可鉴别：多解后候选验证酶能选出数量最少的鉴别实验集；
 *   5. 不可鉴别：全部实验仍无法区分时，给出同预测假设对与逐项片段证据。
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

/* 多解示例（total=8）完整枚举后有 3 个非反向等价类、6 种定向假设 */
const MULTI_RAW = { total: 8, A: [1, 2, 5], B: [3, 5], D: [1, 2, 2, 3] };

/* 独立按切点集合计算双酶切片段多重集，复核页面预测不依赖求解器内部实现 */
function digestFragments(total, cuts1, cuts2) {
  const points = [...new Set([0, total, ...cuts1, ...cuts2])].sort((a, b) => a - b);
  return points.slice(1).map((p, i) => p - points[i]).sort((a, b) => a - b);
}
function knownCuts(map, enzyme) {
  return map.cuts.filter((_, i) => enzyme === 'A' ? map.sites[i] !== 'B' : map.sites[i] !== 'A');
}

check('业务4 可鉴别（验证酶1 切点@1、验证酶2 切点@6）：最少实验集 + 预测逐项可核', () => {
  const d = solver.designExperiment(MULTI_RAW, [
    { name: '验证酶1', cuts: [1] },
    { name: '验证酶2', cuts: [6] }
  ]);
  assert.equal(d.status, 'distinguishable');
  assert.equal(d.hypotheses.length, 6);
  const classCount = new Set(d.hypotheses.map((h) => h.classIndex)).size;
  assert.equal(classCount, 3);
  assert.deepEqual(d.selected.map((x) => x.key), ['P1A', 'P2A']);
  console.log(`  枚举: ${classCount} 个非反向等价类 → ${d.hypotheses.length} 种定向假设`);
  console.log(`  最少实验集: ${d.selected.map((x) => x.label).join('；')}（共 ${d.selected.length} 项，覆盖 ${d.pairCount} 对假设）`);
  d.selected.forEach((sel) => {
    d.hypotheses.forEach((h) => {
      const got = d.predictions[sel.key].byHypothesis[d.hypotheses.indexOf(h)];
      const want = digestFragments(8, d.probes[sel.probeIndex].cuts, knownCuts(h.map, sel.enzyme));
      assert.deepEqual(got, want);
      assert.equal(got.reduce((a, b) => a + b, 0), 8);
    });
    console.log(`  ${sel.label} 预测: ${d.hypotheses.map((h) =>
      h.id + '=[' + d.predictions[sel.key].byHypothesis[d.hypotheses.indexOf(h)].join(',') + ']').join(' ')}`);
  });
});

check('业务4 补充：交换候选酶录入顺序后，最优选集按新顺序稳定裁决', () => {
  const d1 = solver.designExperiment(MULTI_RAW, [
    { name: '验证酶1', cuts: [1] },
    { name: '验证酶2', cuts: [6] }
  ]);
  const d2 = solver.designExperiment(MULTI_RAW, [
    { name: '验证酶2', cuts: [6] },
    { name: '验证酶1', cuts: [1] }
  ]);
  assert.deepEqual(d1.selected.map((x) => x.label), ['验证酶1 × 酶A', '验证酶2 × 酶A']);
  assert.deepEqual(d2.selected.map((x) => x.label), ['验证酶2 × 酶A', '验证酶1 × 酶A']);
  console.log('  顺序一 → 验证酶1×酶A、验证酶2×酶A；顺序二 → 验证酶2×酶A、验证酶1×酶A');
});

check('业务5 不可鉴别（验证酶1 切点@3、验证酶2 切点@4）：同预测假设对 + 逐项证据', () => {
  const d = solver.designExperiment(MULTI_RAW, [
    { name: '验证酶1', cuts: [3] },
    { name: '验证酶2', cuts: [4] }
  ]);
  assert.equal(d.status, 'indistinguishable');
  const pair = d.indistinguishablePair;
  assert.ok(pair && pair.first !== pair.second);
  assert.equal(pair.evidence.length, 4);
  pair.evidence.forEach((ev) => assert.equal(ev.equal, true));
  const h1 = d.hypotheses.find((h) => h.id === pair.first);
  const h2 = d.hypotheses.find((h) => h.id === pair.second);
  console.log(`  无法区分的假设对: ${pair.first} 与 ${pair.second}`);
  pair.evidence.forEach((ev, i) => {
    const e = d.experiments[i];
    assert.deepEqual(ev.first, digestFragments(8, d.probes[e.probeIndex].cuts, knownCuts(h1.map, e.enzyme)));
    assert.deepEqual(ev.second, digestFragments(8, d.probes[e.probeIndex].cuts, knownCuts(h2.map, e.enzyme)));
    console.log(`  ${ev.label}: 两假设预测均为 [${ev.first.join(', ')}]`);
  });
});

check('业务5 补充：候选酶录入非法（数量/切点越界/重复/重名）时明确报错且不产出方案', () => {
  const bad = [
    [{ cuts: [1] }],
    [{ cuts: [8] }, { cuts: [1] }],
    [{ name: 'X', cuts: [2, 2] }, { cuts: [1] }],
    [{ name: 'X', cuts: [1] }, { name: 'X', cuts: [2] }]
  ];
  bad.forEach((probes) => {
    const r = solver.designExperiment(MULTI_RAW, probes);
    assert.equal(r.status, 'invalid');
    assert.ok(r.issues.some((i) => i.group === 'probe'));
  });
  console.log('  4 组非法录入均返回 invalid 且问题归属于「候选验证酶」');
});

if (failures) {
  console.error(`\n业务结论验证失败：${failures} 项`);
  process.exit(1);
}
console.log('\n全部业务结论验证通过（唯一图谱 / 多解见证 / 无可行图谱 / 可鉴别 / 不可鉴别）');
