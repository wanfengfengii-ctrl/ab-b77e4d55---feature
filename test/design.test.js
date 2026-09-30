'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const solver = require('../src/solver.js');

// 多解标准输入：total=8, A=[1,2,5], B=[3,5], D=[1,2,2,3]（3 个非反向等价类，6 种定向假设）
const RAW = { total: 8, A: [1, 2, 5], B: [3, 5], D: [1, 2, 2, 3] };

function pairSeparated(res, i, j, exp) {
  const key = 'C' + exp.partner;
  return JSON.stringify(res.predictions[i][exp.enzymeIdx][key]) !==
    JSON.stringify(res.predictions[j][exp.enzymeIdx][key]);
}

// 所给实验组是否确实区分任意两种定向假设
function separatesAllPairs(res, experiments) {
  const H = res.hypotheses.length;
  for (let i = 0; i < H; i++) {
    for (let j = i + 1; j < H; j++) {
      const ok = experiments.some((exp) => pairSeparated(res, i, j, exp));
      if (!ok) return false;
    }
  }
  return true;
}

// 暴力复核：从全部候选实验中，给定数量 k 是否存在任一可行组合
function existsFeasibleCombo(res, k) {
  const E = res.allExperiments.length;
  const combo = [];
  let found = false;
  (function choose(start) {
    if (found) return;
    if (combo.length === k) {
      if (separatesAllPairs(res, combo.map((idx) => res.allExperiments[idx]))) found = true;
      return;
    }
    for (let q = start; q < E; q++) {
      combo.push(q);
      choose(q + 1);
      combo.pop();
    }
  })(0);
  return found;
}

test('完整枚举：多解输入共 3 个非反向等价类，展开为 6 种定向假设', () => {
  const res = solver.designExperiments(RAW, [
    { name: 'E1', cuts: [2] },
    { name: 'E2', cuts: [4] }
  ]);
  assert.equal(res.classes.length, 3);
  assert.equal(res.hypotheses.length, 6);
  res.hypotheses.forEach((h, i) => {
    assert.equal(h.orientation, i % 2 === 0 ? 'forward' : 'reverse');
    assert.equal(h.classIndex, Math.floor(i / 2));
    assert.equal(h.total, 8);
  });
});

test('反向假设：切点坐标按标记左端映射为 total - 原坐标（顺序反转）', () => {
  const res = solver.designExperiments(RAW, [
    { name: 'E1', cuts: [2] },
    { name: 'E2', cuts: [4] }
  ]);
  const fwd = res.hypotheses[0];
  const rev = res.hypotheses[1];
  assert.deepEqual(rev.cuts, fwd.cuts.map((c) => 8 - c).reverse());
  assert.deepEqual(rev.fragments, fwd.fragments.slice().reverse());
  assert.deepEqual(rev.sites, fwd.sites.slice().reverse());
});

test('回文（自反向）等价类只展开为一种假设', () => {
  // 唯一解输入 6: 2-A-1-B-1-A-2 整体反向与自身相同
  const raw = { total: 6, A: [2, 2, 2], B: [3, 3], D: [1, 1, 2, 2] };
  const res = solver.designExperiments(raw, [
    { name: 'E1', cuts: [1] },
    { name: 'E2', cuts: [5] }
  ]);
  assert.equal(res.classes.length, 1);
  assert.equal(res.hypotheses.length, 1);
  assert.equal(res.hypotheses[0].palindromic, true);
  assert.equal(res.status, 'distinguishable');
  assert.deepEqual(res.discriminating, []); // 仅一个假设，无需实验
});

test('可鉴别：返回数量最少的实验组（2 项），单项实验均不足', () => {
  const res = solver.designExperiments(RAW, [
    { name: 'E1', cuts: [1, 6] },
    { name: 'E2', cuts: [1] }
  ]);
  assert.equal(res.status, 'distinguishable');
  assert.equal(res.discriminating.length, 2);
  assert.ok(separatesAllPairs(res, res.discriminating), '所选实验必须区分全部假设对');
  // 不存在单项可行实验 → 2 项确为最少
  assert.equal(existsFeasibleCombo(res, 1), false);
  assert.equal(existsFeasibleCombo(res, 2), true);
});

test('并列裁决：同数量时按候选酶录入顺序、酶A优先', () => {
  const res = solver.designExperiments(RAW, [
    { name: 'E1', cuts: [1, 6] },
    { name: 'E2', cuts: [1] }
  ]);
  // 并列的可行二元组至少有 [E1+A,E1+B]、[E1+A,E2+A]、[E1+A,E2+B]；
  // 字典序（酶顺序 → A 先于 B）最小者为 [E1+A, E1+B]
  assert.deepEqual(res.discriminating.map((e) => [e.enzymeName, e.partner]),
    [['E1', 'A'], ['E1', 'B']]);
});

test('酶A优先：交换录入顺序不会让酶B组合越序', () => {
  // 改名调换录入顺序：第一位录入的酶仍应胜出
  const res = solver.designExperiments(RAW, [
    { name: 'First', cuts: [1, 6] },
    { name: 'Second', cuts: [1] }
  ]);
  assert.deepEqual(res.discriminating.map((e) => e.enzymeName), ['First', 'First']);
  assert.equal(res.discriminating[0].partner, 'A');
});

test('separatedPairs 计数与实际区分一致', () => {
  const res = solver.designExperiments(RAW, [
    { name: 'E1', cuts: [1, 6] },
    { name: 'E2', cuts: [1] }
  ]);
  res.discriminating.forEach((exp) => {
    let count = 0;
    for (let i = 0; i < res.hypotheses.length; i++) {
      for (let j = i + 1; j < res.hypotheses.length; j++) {
        if (pairSeparated(res, i, j, exp)) count++;
      }
    }
    assert.ok(count > 0);
    assert.equal(exp.separatedPairs, count);
  });
});

test('不可鉴别：全部实验预测相同，返回一对假设与逐项相等证据', () => {
  const res = solver.designExperiments(RAW, [
    { name: 'C1', cuts: [2] },
    { name: 'C2', cuts: [4] }
  ]);
  assert.equal(res.status, 'indistinguishable');
  const pair = res.indistinguishablePair;
  assert.ok(pair.first.includes('假设'));
  assert.ok(pair.second.includes('假设'));
  assert.notEqual(pair.firstIndex, pair.secondIndex);
  assert.ok(pair.evidence.length >= 4); // 每酶至少两管双酶切
  pair.evidence.forEach((ev) => {
    assert.equal(ev.equal, true);
    assert.deepEqual(ev.first, ev.second);
    // 片段为正整数且总和为总长度
    const sum = ev.first.reduce((a, b) => a + b, 0);
    assert.equal(sum, 8);
  });
  // 证据含每酶的单酶切与 +A / +B 三种组合
  const kinds = pair.evidence.map((e) => e.enzymeName + ':' + e.kind).sort();
  assert.ok(kinds.includes('C1:C'));
  assert.ok(kinds.includes('C1:CA'));
  assert.ok(kinds.includes('C2:CB'));
});

test('不可鉴别证据中的假设对，在全部候选实验上确实预测相同', () => {
  const res = solver.designExperiments(RAW, [
    { name: 'C1', cuts: [2] },
    { name: 'C2', cuts: [4] }
  ]);
  const p = res.indistinguishablePair;
  res.allExperiments.forEach((exp) => {
    assert.equal(pairSeparated(res, p.firstIndex, p.secondIndex, exp), false);
  });
});

test('预测片段：双酶切为候选酶切点与已知酶切点的联合切分', () => {
  // 手工核对第一种正向假设
  const res = solver.designExperiments(RAW, [
    { name: 'E1', cuts: [1, 6] },
    { name: 'E2', cuts: [1] }
  ]);
  const h = res.hypotheses[0];
  const aCuts = h.cuts.filter((_, i) => h.sites[i] === 'A' || h.sites[i] === 'AB').sort((x, y) => x - y);
  const expected = solver.digestFragments(8, [1, 6].concat(aCuts));
  assert.deepEqual(res.predictions[0][0].CA, expected.sort((x, y) => x - y));
});

test('digestFragments：重合切点只计一次，不产生 0 长度片段', () => {
  assert.deepEqual(solver.digestFragments(8, [3, 3, 5]), [3, 2, 3]);
  assert.deepEqual(solver.digestFragments(5, []), [5]);
});

test('候选酶校验：数量必须为 2~5 种', () => {
  let r = solver.validateEnzymes(8, [{ name: 'X', cuts: [1] }]);
  assert.ok(r.issues.length && r.enzymes === null);
  r = solver.validateEnzymes(8, [
    { name: 'A', cuts: [1] }, { name: 'B', cuts: [2] }, { name: 'C', cuts: [3] },
    { name: 'D', cuts: [4] }, { name: 'E', cuts: [5] }, { name: 'F', cuts: [6] }
  ]);
  assert.ok(r.issues.length && r.enzymes === null);
});

test('候选酶校验：名称非空且不重复', () => {
  let r = solver.validateEnzymes(8, [{ name: '  ', cuts: [1] }, { name: 'Y', cuts: [2] }]);
  assert.ok(r.issues.some((i) => i.message.includes('名称为空')));
  r = solver.validateEnzymes(8, [{ name: 'X', cuts: [1] }, { name: 'X', cuts: [2] }]);
  assert.ok(r.issues.some((i) => i.message.includes('重复')));
});

test('候选酶校验：切点越界与重复', () => {
  let r = solver.validateEnzymes(8, [{ name: 'X', cuts: [0] }, { name: 'Y', cuts: [2] }]);
  assert.ok(r.issues.length);
  r = solver.validateEnzymes(8, [{ name: 'X', cuts: [8] }, { name: 'Y', cuts: [2] }]);
  assert.ok(r.issues.length);
  r = solver.validateEnzymes(8, [{ name: 'X', cuts: [3, 3] }, { name: 'Y', cuts: [2] }]);
  assert.ok(r.issues.length);
});

test('候选酶支持 cutsText 字符串录入并排序', () => {
  const r = solver.validateEnzymes(8, [
    { name: 'X', cutsText: '5, 1' },
    { name: 'Y', cutsText: '2 3' }
  ]);
  assert.equal(r.issues.length, 0);
  assert.deepEqual(r.enzymes[0].cuts, [1, 5]);
  assert.deepEqual(r.enzymes[1].cuts, [2, 3]);
});

test('designExperiments 直接透传候选酶录入错误', () => {
  const res = solver.designExperiments(RAW, [{ name: 'X', cuts: [99] }, { name: 'Y', cuts: [2] }]);
  assert.equal(res.status, 'invalid');
  assert.ok(res.issues.some((i) => i.group === 'enzymes'));
});

test('designExperiments 对原消化输入同样做合法性校验', () => {
  const bad = { total: 8, A: [1, 2, 5], B: [3, 5], D: [1, 2, 2, 4] };
  const res = solver.designExperiments(bad, [{ name: 'X', cuts: [1] }, { name: 'Y', cuts: [2] }]);
  assert.equal(res.status, 'invalid');
});

test('5 种候选酶上限内可正常设计', () => {
  const res = solver.designExperiments(RAW, [
    { name: 'E1', cuts: [1] },
    { name: 'E2', cuts: [2] },
    { name: 'E3', cuts: [3] },
    { name: 'E4', cuts: [6] },
    { name: 'E5', cuts: [7] }
  ]);
  assert.ok(['distinguishable', 'indistinguishable'].includes(res.status));
  assert.equal(res.enzymes.length, 5);
  assert.equal(res.allExperiments.length, 10);
  if (res.status === 'distinguishable') {
    assert.ok(separatesAllPairs(res, res.discriminating));
  }
});

test('完整枚举超出预算时返回 aborted', () => {
  const res = solver.designExperiments(RAW, [
    { name: 'E1', cuts: [1] },
    { name: 'E2', cuts: [2] }
  ], { budget: 1 });
  assert.equal(res.status, 'aborted');
  assert.ok(res.message.includes('预算'));
});

test('等价类数量超过上限时返回 aborted（防止解空间爆炸）', () => {
  const res = solver.designExperiments(RAW, [
    { name: 'E1', cuts: [1] },
    { name: 'E2', cuts: [2] }
  ], { maxClasses: 2 }); // 该输入实际有 3 个等价类
  assert.equal(res.status, 'aborted');
  assert.ok(res.overflow === true || res.message.includes('上限'));
});

test('候选酶无内部切点（只在末端切）合法：预测等于全长单一片段', () => {
  const res = solver.designExperiments(RAW, [
    { name: 'E1', cuts: [] },
    { name: 'E2', cuts: [3] }
  ]);
  assert.ok(['distinguishable', 'indistinguishable'].includes(res.status));
  res.hypotheses.forEach((_, hi) => {
    assert.deepEqual(res.predictions[hi][0].C, [8]); // 无切点 → 整条
  });
});
