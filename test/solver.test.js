'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const solver = require('../src/solver.js');

function runLengths(runs) {
  return runs.map((r) => r.length);
}

function reversedTokensJson(map) {
  const frags = map.fragments.slice().reverse();
  const sites = map.sites.slice().reverse();
  const t = [frags[0]];
  for (let i = 0; i < sites.length; i++) {
    t.push(sites[i]);
    t.push(frags[i + 1]);
  }
  return JSON.stringify(t);
}

test('输入校验：某组片段之和不等于总长度', () => {
  const res = solver.solve({ total: 10, A: [6, 4], B: [5, 5], D: [1, 2, 3, 3] });
  assert.equal(res.status, 'invalid');
  assert.ok(res.issues.some((i) => i.group === 'D'));
});

test('输入校验：非正整数片段与空列表', () => {
  const r1 = solver.solve({ total: 4, A: [4], B: [4], D: [0, 4] });
  assert.equal(r1.status, 'invalid');
  assert.ok(r1.issues.some((i) => i.group === 'D'));
  const r2 = solver.solve({ total: 4, A: [], B: [4], D: [4] });
  assert.equal(r2.status, 'invalid');
  assert.ok(r2.issues.some((i) => i.group === 'A'));
});

test('唯一图谱（自反向，含合并展示数据）', () => {
  const res = solver.solve({ total: 6, A: [2, 2, 2], B: [3, 3], D: [1, 1, 2, 2] });
  assert.equal(res.status, 'unique');
  const m = res.solutions[0];
  assert.deepEqual(m.fragments, [2, 1, 1, 2]);
  assert.deepEqual(m.sites, ['A', 'B', 'A']);
  assert.deepEqual(m.cuts, [2, 3, 4]);
  assert.deepEqual(runLengths(m.aRuns), [2, 2, 2]);
  assert.deepEqual(runLengths(m.bRuns), [3, 3]);
  assert.deepEqual(m.aRuns[1], { start: 1, end: 3, length: 2 });
});

test('唯一图谱（整体反向去重，规范方向展示）', () => {
  const res = solver.solve({ total: 4, A: [1, 3], B: [2, 2], D: [1, 1, 2] });
  assert.equal(res.status, 'unique');
  const m = res.solutions[0];
  assert.deepEqual(m.fragments, [1, 1, 2]);
  assert.deepEqual(m.sites, ['A', 'B']);
  assert.deepEqual(m.cuts, [1, 2]);
});

test('双切点（两种酶共切同一位点）', () => {
  const res = solver.solve({ total: 4, A: [1, 1, 2], B: [2, 2], D: [1, 1, 2] });
  assert.equal(res.status, 'unique');
  const m = res.solutions[0];
  assert.deepEqual(m.fragments, [1, 1, 2]);
  assert.deepEqual(m.sites, ['A', 'AB']);
  assert.deepEqual(m.cuts, [1, 2]);
  assert.deepEqual(runLengths(m.aRuns), [1, 1, 2]);
  assert.deepEqual(runLengths(m.bRuns), [2, 2]);
});

test('多解：两份见证、非反向等价、首个分歧明确', () => {
  const res = solver.solve({ total: 8, A: [1, 2, 5], B: [3, 5], D: [1, 2, 2, 3] });
  assert.equal(res.status, 'multiple');
  assert.equal(res.solutions.length, 2);
  const [w1, w2] = res.solutions;
  for (const w of [w1, w2]) {
    assert.deepEqual(runLengths(w.aRuns).sort((x, y) => x - y), [1, 2, 5]);
    assert.deepEqual(runLengths(w.bRuns).sort((x, y) => x - y), [3, 5]);
    assert.deepEqual(w.fragments.slice().sort((x, y) => x - y), [1, 2, 2, 3]);
    assert.equal(w.total, 8);
  }
  // 两份见证互不相同，且并非互为整体反向
  assert.notEqual(JSON.stringify(w1.tokens), JSON.stringify(w2.tokens));
  assert.notEqual(reversedTokensJson(w1), JSON.stringify(w2.tokens));
  // 首个分歧存在，坐标与双方取值一致
  const div = res.divergence;
  assert.ok(div);
  assert.ok(Number.isInteger(div.coordinate) && div.coordinate >= 0);
  assert.equal(w1.tokens[div.tokenIndex], div.first);
  assert.equal(w2.tokens[div.tokenIndex], div.second);
  assert.ok(div.tokenIndex >= 0);
});

test('无可行图谱：酶A单酶切最先无法同时满足', () => {
  const res = solver.solve({ total: 10, A: [2, 8], B: [4, 6], D: [1, 3, 3, 3] });
  assert.equal(res.status, 'infeasible');
  assert.equal(res.failure.group, 'A');
  assert.deepEqual(res.failure.passed, []);
});

test('无可行图谱：酶B单酶切最先无法同时满足', () => {
  const res = solver.solve({ total: 10, A: [4, 6], B: [2, 8], D: [1, 3, 3, 3] });
  assert.equal(res.status, 'infeasible');
  assert.equal(res.failure.group, 'B');
  assert.deepEqual(res.failure.passed, ['A']);
});

test('无可行图谱：双酶切联合（切点总数不足）', () => {
  const res = solver.solve({ total: 10, A: [6, 4], B: [5, 5], D: [1, 2, 3, 4] });
  assert.equal(res.status, 'infeasible');
  assert.equal(res.failure.group, 'double');
  assert.deepEqual(res.failure.passed, ['A', 'B']);
});

test('无可行图谱：双酶切联合（各自可行但不可兼得）', () => {
  const res = solver.solve({ total: 6, A: [1, 5], B: [1, 5], D: [1, 2, 3] });
  assert.equal(res.status, 'infeasible');
  assert.equal(res.failure.group, 'double');
  assert.deepEqual(res.failure.passed, ['A', 'B']);
});

test('单片段边界（无内部切点）', () => {
  const res = solver.solve({ total: 5, A: [5], B: [5], D: [5] });
  assert.equal(res.status, 'unique');
  assert.deepEqual(res.solutions[0].fragments, [5]);
  assert.deepEqual(res.solutions[0].sites, []);
  assert.deepEqual(res.solutions[0].cuts, []);
});

test('枚举预算超限时中止', () => {
  const res = solver.solve({ total: 6, A: [2, 2, 2], B: [3, 3], D: [1, 1, 2, 2], budget: 1 });
  assert.equal(res.status, 'aborted');
});

test('parseFragments 解析多种分隔符与非法输入', () => {
  assert.deepEqual(solver.parseFragments('1, 2  3，4、5;6').values, [1, 2, 3, 4, 5, 6]);
  assert.ok(solver.parseFragments('1, 0').error);
  assert.ok(solver.parseFragments('x').error);
  assert.ok(solver.parseFragments('').error);
  assert.ok(solver.parseFragments('2.5').error);
});

/* ---------- 鉴别实验设计 ---------- */

const MULTI_RAW = { total: 8, A: [1, 2, 5], B: [3, 5], D: [1, 2, 2, 3] };

// 由切点集合（含端点）计算双酶切片段多重集，独立复核求解器预测
function digestFragments(total, cuts1, cuts2) {
  const points = [...new Set([0, total, ...cuts1, ...cuts2])].sort((a, b) => a - b);
  return points.slice(1).map((p, i) => p - points[i]).sort((a, b) => a - b);
}
function knownCuts(map, enzyme) {
  return map.cuts.filter((_, i) => enzyme === 'A' ? map.sites[i] !== 'B' : map.sites[i] !== 'A');
}
// 覆盖全部假设对所需要的实验索引子集（按预测多重集签名判断）
function coveringSubsets(design) {
  const H = design.hypotheses;
  const exps = design.experiments;
  const sig = exps.map((e) => H.map((h) => design.predictions[e.key].byHypothesis[H.indexOf(h)].join('|')));
  const covers = (subset) => {
    for (let i = 0; i < H.length; i++) {
      for (let j = i + 1; j < H.length; j++) {
        if (!subset.some((ei) => sig[ei][i] !== sig[ei][j])) return false;
      }
    }
    return true;
  };
  const all = [];
  const n = exps.length;
  for (let mask = 1; mask < (1 << n); mask++) {
    const subset = [];
    for (let k = 0; k < n; k++) if (mask & (1 << k)) subset.push(k);
    if (covers(subset)) all.push(subset);
  }
  return all;
}

test('完整枚举：多解场景预算内得到全部 3 个非反向等价类', () => {
  const res = solver.solve(Object.assign({ collectAll: true }, MULTI_RAW));
  assert.equal(res.status, 'multiple');
  assert.equal(res.solutions.length, 3);
});

test('每个等价类展开为正向/反向两种定向假设（自反重重合）', () => {
  const d = solver.designExperiment(MULTI_RAW, [
    { name: 'E1', cuts: [1] },
    { name: 'E2', cuts: [6] }
  ]);
  assert.equal(d.status, 'distinguishable');
  assert.equal(d.hypotheses.length, 6);
  const byClass = {};
  d.hypotheses.forEach((h) => {
    (byClass[h.classIndex] = byClass[h.classIndex] || []).push(h);
    assert.ok(['+', '-'].includes(h.orientation));
  });
  Object.keys(byClass).forEach((k) => assert.equal(byClass[k].length, 2));
  // 反向假设的片段序列是正向的倒序、切点坐标为镜像
  const plus = d.hypotheses.find((h) => h.id === 'H1+');
  const minus = d.hypotheses.find((h) => h.id === 'H1-');
  assert.deepEqual(minus.map.fragments, plus.map.fragments.slice().reverse());
  assert.deepEqual(minus.map.sites, plus.map.sites.slice().reverse());
  minus.map.cuts.forEach((c, i) => assert.equal(c, 8 - plus.map.cuts[plus.map.cuts.length - 1 - i]));
});

test('自反向等价类：两种定向展开重合时只保留一个假设', () => {
  const raw = { total: 5, A: [1, 1, 3], B: [1, 1, 3], D: [1, 1, 3] };
  const res = solver.solve(Object.assign({ collectAll: true }, raw));
  assert.equal(res.status, 'multiple');
  assert.equal(res.solutions.length, 2);
  const d = solver.designExperiment(raw, [{ name: 'E1', cuts: [1] }, { name: 'E2', cuts: [4] }]);
  assert.equal(d.hypotheses.length, 3); // 2 个等价类，其中一个自反向：2 + 1
  const self = d.hypotheses.filter((h) => h.selfReverse);
  assert.equal(self.length, 1);
  // 自反向类只出现一个 id，不存在同 classIndex 的反向假设
  assert.equal(self[0].orientation, '+');
  assert.ok(!d.hypotheses.some((o) => o.classIndex === self[0].classIndex && o.orientation === '-'));
});

test('预测片段多重集：与独立按切点集合计算一致且长度之和为总长度', () => {
  const d = solver.designExperiment(MULTI_RAW, [
    { name: 'E1', cuts: [1] },
    { name: 'E2', cuts: [6] }
  ]);
  d.hypotheses.forEach((h, hi) => {
    d.experiments.forEach((e) => {
      const probeCuts = d.probes[e.probeIndex].cuts;
      const got = d.predictions[e.key].byHypothesis[hi];
      const want = digestFragments(8, probeCuts, knownCuts(h.map, e.enzyme));
      assert.deepEqual(got, want, `${h.id} ${e.label}`);
      assert.equal(got.reduce((a, b) => a + b, 0), 8);
    });
  });
});

test('可鉴别：选出最少实验集，且为所有最优解中裁决顺序最前者', () => {
  const d = solver.designExperiment(MULTI_RAW, [
    { name: 'E1', cuts: [1] },
    { name: 'E2', cuts: [6] }
  ]);
  assert.deepEqual(d.selected.map((x) => x.key), ['P1A', 'P2A']);
  const all = coveringSubsets(d);
  // 不存在更小的覆盖集
  assert.ok(all.every((s) => s.length >= d.selected.length));
  // 同尺寸最优解中，所选索引序列字典序最小（候选酶顺序 → 酶A优先）
  const selectedIdx = d.selected.map((s) => d.experiments.findIndex((e) => e.key === s.key));
  const lex = (a, b) => {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      if (a[i] !== b[i]) return a[i] - b[i];
    }
    return a.length - b.length;
  };
  all.filter((s) => s.length === selectedIdx.length).forEach((s) => {
    assert.ok(lex(selectedIdx, s) <= 0, `应早于 ${s.join(',')}`);
  });
});

test('并列裁决：候选酶按录入顺序；交换录入顺序后选择随之变化', () => {
  const d1 = solver.designExperiment(MULTI_RAW, [
    { name: 'E1', cuts: [1] },
    { name: 'E2', cuts: [6] }
  ]);
  const d2 = solver.designExperiment(MULTI_RAW, [
    { name: 'E2', cuts: [6] },
    { name: 'E1', cuts: [1] }
  ]);
  assert.deepEqual(d1.selected.map((x) => x.label), ['E1 × 酶A', 'E2 × 酶A']);
  assert.deepEqual(d2.selected.map((x) => x.label), ['E2 × 酶A', 'E1 × 酶A']);
  // 酶A优先于酶B：实验顺序中同一候选酶的 A 实验排在 B 实验之前
  assert.deepEqual(d1.experiments.map((e) => e.key), ['P1A', 'P1B', 'P2A', 'P2B']);
});

test('不可鉴别：返回预测始终相同的假设对与逐项片段证据', () => {
  const d = solver.designExperiment(MULTI_RAW, [
    { name: 'E1', cuts: [3] },
    { name: 'E2', cuts: [4] }
  ]);
  assert.equal(d.status, 'indistinguishable');
  const pair = d.indistinguishablePair;
  assert.ok(pair && pair.first !== pair.second);
  assert.equal(pair.evidence.length, 4);
  pair.evidence.forEach((ev) => {
    assert.equal(ev.equal, true);
    assert.deepEqual(ev.first, ev.second);
    assert.equal(ev.first.reduce((a, b) => a + b, 0), 8);
  });
  // 独立复核：证据中的两份预测确实分别对应两个假设的切点集合
  const h1 = d.hypotheses.find((h) => h.id === pair.first);
  const h2 = d.hypotheses.find((h) => h.id === pair.second);
  pair.evidence.forEach((ev, i) => {
    const e = d.experiments[i];
    const probeCuts = d.probes[e.probeIndex].cuts;
    assert.deepEqual(ev.first, digestFragments(8, probeCuts, knownCuts(h1.map, e.enzyme)));
    assert.deepEqual(ev.second, digestFragments(8, probeCuts, knownCuts(h2.map, e.enzyme)));
  });
});

test('候选验证酶校验：数量、切点范围、重复切点、空切点、重名', () => {
  const bad = [
    [[{ cuts: [1] }]], // 只有 1 种
    [[{ cuts: [1] }, { cuts: [2] }, { cuts: [3] }, { cuts: [4] }, { cuts: [5] }, { cuts: [6] }]], // 6 种
    [[{ cuts: [0] }, { cuts: [1] }]], // 切点 0
    [[{ cuts: [8] }, { cuts: [1] }]], // 切点等于总长度
    [[{ cuts: [3, 3] }, { cuts: [1] }]], // 重复切点
    [[{ cuts: [] }, { cuts: [1] }]], // 空切点
    [[{ name: 'X', cuts: [1] }, { name: 'X', cuts: [2] }]] // 重名
  ];
  bad.forEach((args) => {
    const r = solver.designExperiment(MULTI_RAW, args[0]);
    assert.equal(r.status, 'invalid');
    assert.ok(r.issues.some((i) => i.group === 'probe'));
  });
  const ok = solver.designExperiment(MULTI_RAW, [
    { name: 'X', cuts: [1] },
    { name: 'Y', cuts: [7] }
  ]);
  assert.notEqual(ok.status, 'invalid');
});

test('未多解时发起设计：原结论原样返回（unique / infeasible）', () => {
  const u = solver.designExperiment(
    { total: 6, A: [2, 2, 2], B: [3, 3], D: [1, 1, 2, 2] },
    [{ cuts: [2] }, { cuts: [4] }]);
  assert.equal(u.status, 'unique');
  const inf = solver.designExperiment(
    { total: 10, A: [2, 8], B: [4, 6], D: [1, 3, 3, 3] },
    [{ cuts: [2] }, { cuts: [4] }]);
  assert.equal(inf.status, 'infeasible');
  assert.equal(inf.failure.group, 'A');
});

test('完整枚举超出预算时透传 aborted', () => {
  const r = solver.designExperiment(Object.assign({ budget: 1 }, MULTI_RAW), [
    { cuts: [1] }, { cuts: [6] }
  ]);
  assert.equal(r.status, 'aborted');
});
