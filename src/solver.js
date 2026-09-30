/*
 * 限制性内切酶图谱复原求解器（纯逻辑，浏览器与 Node 通用）。
 *
 * 输入：线性质粒构建体总长度 total，以及酶A单酶切、酶B单酶切、双酶切
 * 三组正整数片段（多重集，各自之和必须等于 total）。
 *
 * 在浏览器内联合枚举：
 *   1. 双酶切片段的去重排列（相同长度的片段不重复排列）；
 *   2. 每个内部切点的归属（仅酶A / 仅酶B / 双切）。
 * 要求两组单酶切片段多重集完全吻合；整体反向视为同一图谱。
 *
 * 结论分为：
 *   unique     唯一图谱（反向等价类只有 1 个）
 *   multiple   存在多个非反向等价图谱（给出两份首个分歧明确的见证）
 *   infeasible 无可行图谱（指出最先无法同时满足的消化组：A / B / double）
 *   invalid    输入不合法（如某组片段之和不等于总长度）
 *   aborted    枚举规模超出预算
 *
 * 多解时可进一步发起 designExperiments（鉴别实验设计）：
 *   1. 在预算内完整枚举全部非反向等价类（不再只保留两份见证）；
 *   2. 每个等价类按已标记的左端展开为两种定向假设（正向 / 反向）；
 *   3. 录入 2~5 种候选验证酶（各给出从标记左端量取的内部切点）；
 *   4. 为「候选酶 × 酶A / 酶B」的每种组合计算单酶切与双酶切预测片段多重集；
 *   5. 选择数量最少的一组实验，使任意两种定向假设至少被一项预测区分；
 *      并列时按候选酶录入顺序、酶A 优先于酶B 稳定裁决；
 *   6. 若全部实验仍无法区分某一对假设，返回该对假设与逐项相同的片段证据。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DigestSolver = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SITE_A = 'A'; // 仅酶A切割
  var SITE_B = 'B'; // 仅酶B切割
  var SITE_AB = 'AB'; // 两种酶共切
  var DEFAULT_BUDGET = 1000000; // 枚举节点预算，超出则中止
  var MAX_DOUBLE_FRAGMENTS = 12; // 双酶切片段数上限

  function isPositiveInteger(x) {
    return typeof x === 'number' && Number.isInteger(x) && x > 0;
  }

  function sum(arr) {
    var s = 0;
    for (var i = 0; i < arr.length; i++) s += arr[i];
    return s;
  }

  function sortedCopy(arr) {
    return arr.slice().sort(function (a, b) { return a - b; });
  }

  function toCounts(arr) {
    var m = new Map();
    for (var i = 0; i < arr.length; i++) m.set(arr[i], (m.get(arr[i]) || 0) + 1);
    return m;
  }

  /* ---------- 输入解析与校验 ---------- */

  function parseFragments(text) {
    if (typeof text !== 'string' || text.trim() === '') {
      return { values: null, error: '片段列表为空。' };
    }
    var parts = text.split(/[\s,，、;；]+/).filter(function (p) { return p !== ''; });
    var values = [];
    for (var i = 0; i < parts.length; i++) {
      var v = Number(parts[i]);
      if (!isPositiveInteger(v)) {
        return { values: null, error: '“' + parts[i] + '” 不是正整数。' };
      }
      values.push(v);
    }
    return { values: values, error: null };
  }

  function validate(raw) {
    var issues = [];
    if (!raw || typeof raw !== 'object') {
      return [{ group: 'input', message: '输入为空。' }];
    }
    var total = raw.total;
    if (!isPositiveInteger(total)) {
      issues.push({ group: 'total', message: '总长度必须是正整数。' });
    }
    var groups = [
      ['A', raw.A, '酶A单酶切'],
      ['B', raw.B, '酶B单酶切'],
      ['D', raw.D, '双酶切']
    ];
    groups.forEach(function (g) {
      var key = g[0], arr = g[1], label = g[2];
      if (!Array.isArray(arr) || arr.length === 0) {
        issues.push({ group: key, message: label + '片段列表为空。' });
        return;
      }
      for (var i = 0; i < arr.length; i++) {
        if (!isPositiveInteger(arr[i])) {
          issues.push({ group: key, message: label + '第 ' + (i + 1) + ' 个片段不是正整数。' });
          return;
        }
      }
      if (isPositiveInteger(total) && sum(arr) !== total) {
        issues.push({
          group: key,
          message: label + '片段长度之和为 ' + sum(arr) + '，与总长度 ' + total + ' 不一致。'
        });
      }
    });
    if (Array.isArray(raw.D) && raw.D.length > MAX_DOUBLE_FRAGMENTS) {
      issues.push({
        group: 'D',
        message: '双酶切片段数 ' + raw.D.length + ' 超过上限 ' + MAX_DOUBLE_FRAGMENTS + '。'
      });
    }
    return issues;
  }

  /* ---------- 图谱表示 ---------- */

  // 令牌序列：[片段0, 切点0, 片段1, 切点1, ..., 片段n-1]
  function tokensOf(frags, sts) {
    var t = [frags[0]];
    for (var i = 0; i < sts.length; i++) {
      t.push(sts[i]);
      t.push(frags[i + 1]);
    }
    return t;
  }

  // 某单酶切的片段如何由连续双酶切片段合并得到：
  // 在该酶不切割的切点处合并相邻双酶切片段。
  function computeRuns(frags, sts, enzyme) {
    var runs = [];
    var start = 0;
    var len = frags[0];
    for (var i = 0; i < sts.length; i++) {
      var otherOnly = enzyme === SITE_A ? sts[i] === SITE_B : sts[i] === SITE_A;
      if (!otherOnly) {
        runs.push({ start: start, end: i + 1, length: len });
        start = i + 1;
        len = frags[i + 1];
      } else {
        len += frags[i + 1];
      }
    }
    runs.push({ start: start, end: frags.length, length: len });
    return runs;
  }

  function makeMap(frags, sts) {
    var cuts = [];
    var pos = 0;
    for (var i = 0; i < sts.length; i++) {
      pos += frags[i];
      cuts.push(pos);
    }
    var total = pos + (frags.length ? frags[frags.length - 1] : 0);
    return {
      fragments: frags,
      sites: sts,
      cuts: cuts,
      total: total,
      aRuns: computeRuns(frags, sts, SITE_A),
      bRuns: computeRuns(frags, sts, SITE_B),
      tokens: tokensOf(frags, sts)
    };
  }

  // 整体反向视为同一图谱：取令牌序列与其反向的字典序较小者作为规范形。
  function canonical(frags, sts) {
    var rf = frags.slice().reverse();
    var rs = sts.slice().reverse();
    var k1 = JSON.stringify(tokensOf(frags, sts));
    var k2 = JSON.stringify(tokensOf(rf, rs));
    if (k1 <= k2) return { key: k1, frags: frags.slice(), sts: sts.slice() };
    return { key: k2, frags: rf, sts: rs };
  }

  /* ---------- 联合枚举搜索 ----------
   * mode 'A'     ：只要求酶A单酶切可由双酶切片段连续合并得到（可行性）
   * mode 'B'     ：只要求酶B单酶切（可行性）
   * mode 'joint' ：同时满足两组单酶切，收集反向等价类
   *   cfg.collectAll 缺省时只保留 2 个见证（区分唯一 / 多解）；
   *   collectAll=true 时完整枚举全部非反向等价类（鉴别实验设计使用）。
   */
  function search(cfg) {
    var mode = cfg.mode;
    var trackA = mode !== 'B';
    var trackB = mode !== 'A';
    var collect = mode === 'joint';
    var collectAll = collect && cfg.collectAll === true;
    var maxClasses = collectAll && isPositiveInteger(cfg.maxClasses) ? cfg.maxClasses : 0;
    var n = cfg.D.length;
    var budget = cfg.budget;

    var counts = toCounts(cfg.D);
    var dValues = Array.from(counts.keys()).sort(function (a, b) { return a - b; });
    var dLeft = dValues.map(function (v) { return counts.get(v); });

    var aLeft = trackA ? toCounts(cfg.A) : null;
    var bLeft = trackB ? toCounts(cfg.B) : null;
    var aLeftCount = trackA ? cfg.A.length : 0;
    var bLeftCount = trackB ? cfg.B.length : 0;

    var fragments = new Array(n);
    var sites = new Array(Math.max(0, n - 1));
    var runA = 0; // 当前未闭合的酶A片段累计长度
    var runB = 0;
    var nodes = 0;
    var aborted = false;
    var classesOverflow = false;
    var stop = false;
    var found = false;
    var classes = new Map();

    function maxRemaining(left) {
      var mx = 0;
      left.forEach(function (c, v) { if (c > 0 && v > mx) mx = v; });
      return mx;
    }

    function closeRun(left, run) {
      var c = left.get(run) || 0;
      if (c < 1) return false;
      left.set(run, c - 1);
      return true;
    }

    function record() {
      if (collect) {
        var canon = canonical(fragments, sites);
        if (!classes.has(canon.key)) {
          classes.set(canon.key, makeMap(canon.frags, canon.sts));
          if (!collectAll && classes.size >= 2) {
            stop = true; // 只需区分唯一 / 多解
          } else if (maxClasses > 0 && classes.size > maxClasses) {
            // 完整枚举也设置上限：防止解空间爆炸时无界收集等价类
            classesOverflow = true;
            stop = true;
          }
        }
      } else {
        found = true;
        stop = true;
      }
    }

    function rec(depth) {
      if (stop) return;
      nodes++;
      if (nodes > budget) {
        aborted = true;
        stop = true;
        return;
      }
      if (depth === n) {
        // 末尾未闭合的段必须恰好是各自多重集中最后剩余的片段
        if (trackA && (aLeftCount !== 1 || (aLeft.get(runA) || 0) < 1)) return;
        if (trackB && (bLeftCount !== 1 || (bLeft.get(runB) || 0) < 1)) return;
        record();
        return;
      }

      if (depth === 0) {
        var maxA0 = trackA ? maxRemaining(aLeft) : 0;
        var maxB0 = trackB ? maxRemaining(bLeft) : 0;
        for (var i = 0; i < dValues.length; i++) {
          if (dLeft[i] === 0) continue;
          var v0 = dValues[i];
          if (trackA && v0 > maxA0) continue;
          if (trackB && v0 > maxB0) continue;
          dLeft[i]--;
          fragments[0] = v0;
          runA += v0;
          runB += v0;
          rec(1);
          runA -= v0;
          runB -= v0;
          dLeft[i]++;
          if (stop) return;
        }
        return;
      }

      // depth >= 1：先选择切点 s[depth-1] 的归属，再放置第 depth 个片段
      var siteIdx = depth - 1;
      var opts = collect ? [SITE_A, SITE_B, SITE_AB] : [true, false];
      for (var o = 0; o < opts.length; o++) {
        var opt = opts[o];
        var aCut = false;
        var bCut = false;
        if (collect) {
          aCut = opt !== SITE_B;
          bCut = opt !== SITE_A;
        } else if (mode === 'A') {
          aCut = opt === true;
        } else {
          bCut = opt === true;
        }

        var savedRunA = runA;
        var savedRunB = runB;
        var aClosed = false;
        var bClosed = false;
        var okSite = true;
        if (aCut) {
          if (closeRun(aLeft, runA)) {
            aClosed = true;
            aLeftCount--;
            runA = 0;
          } else {
            okSite = false;
          }
        }
        if (okSite && bCut) {
          if (closeRun(bLeft, runB)) {
            bClosed = true;
            bLeftCount--;
            runB = 0;
          } else {
            okSite = false;
          }
        }

        if (okSite) {
          // 剪枝：剩余切点数必须容得下两组单酶切各自还需要的切点，
          // 且联合模式下每个剩余切点至少要被一种酶切割。
          var sitesLeft = (n - 1) - depth;
          var aNeed = trackA ? aLeftCount - 1 : 0;
          var bNeed = trackB ? bLeftCount - 1 : 0;
          var feasible =
            aNeed >= 0 && bNeed >= 0 &&
            aNeed <= sitesLeft && bNeed <= sitesLeft &&
            (!collect || aNeed + bNeed >= sitesLeft);
          if (feasible) {
            if (collect) sites[siteIdx] = opt;
            var maxA = trackA ? maxRemaining(aLeft) : 0;
            var maxB = trackB ? maxRemaining(bLeft) : 0;
            for (var j = 0; j < dValues.length; j++) {
              if (dLeft[j] === 0) continue;
              var v = dValues[j];
              if (trackA && runA + v > maxA) continue;
              if (trackB && runB + v > maxB) continue;
              dLeft[j]--;
              fragments[depth] = v;
              runA += v;
              runB += v;
              rec(depth + 1);
              runA -= v;
              runB -= v;
              dLeft[j]++;
              if (stop) break;
            }
          }
        }

        runA = savedRunA;
        runB = savedRunB;
        if (aClosed) {
          aLeft.set(savedRunA, aLeft.get(savedRunA) + 1);
          aLeftCount++;
        }
        if (bClosed) {
          bLeft.set(savedRunB, bLeft.get(savedRunB) + 1);
          bLeftCount++;
        }
        if (stop) return;
      }
    }

    rec(0);
    return { aborted: aborted, overflow: classesOverflow, found: found, classes: classes };
  }

  /* ---------- 首个分歧 ---------- */

  function divergence(m1, m2) {
    var t1 = m1.tokens;
    var t2 = m2.tokens;
    var len = Math.min(t1.length, t2.length);
    for (var i = 0; i < len; i++) {
      if (t1[i] !== t2[i]) {
        var coordinate = 0;
        var k;
        if (i % 2 === 0) {
          var fi = i / 2;
          for (k = 0; k < fi; k++) coordinate += m1.fragments[k];
          return {
            tokenIndex: i,
            kind: 'fragment',
            fragmentIndex: fi,
            coordinate: coordinate,
            first: t1[i],
            second: t2[i]
          };
        }
        var si = (i - 1) / 2;
        for (k = 0; k <= si; k++) coordinate += m1.fragments[k];
        return {
          tokenIndex: i,
          kind: 'site',
          siteIndex: si,
          coordinate: coordinate,
          first: t1[i],
          second: t2[i]
        };
      }
    }
    return null;
  }

  /* ---------- 主入口 ---------- */

  function infeasible(group, message, passed) {
    return {
      status: 'infeasible',
      failure: { group: group, message: message, passed: passed }
    };
  }

  function solve(raw) {
    var issues = validate(raw);
    if (issues.length) return { status: 'invalid', issues: issues };

    var total = raw.total;
    var A = sortedCopy(raw.A);
    var B = sortedCopy(raw.B);
    var D = sortedCopy(raw.D);
    var budget = isPositiveInteger(raw.budget) ? raw.budget : DEFAULT_BUDGET;

    // 阶段一：酶A单酶切能否由双酶切片段连续合并得到
    if (A.length > D.length) {
      return infeasible('A',
        '酶A单酶切片段数（' + A.length + '）多于双酶切片段数（' + D.length +
        '），合并只会减少片段数，无法得到。', []);
    }
    var ra = search({ mode: 'A', A: A, D: D, budget: budget });
    if (ra.aborted) return { status: 'aborted', message: '枚举规模超出预算，请减少双酶切片段数。' };
    if (!ra.found) {
      return infeasible('A',
        '不存在双酶切片段的排列，使其连续分段合并后得到酶A单酶切片段多重集。', []);
    }

    // 阶段二：酶B单酶切能否由双酶切片段连续合并得到
    if (B.length > D.length) {
      return infeasible('B',
        '酶B单酶切片段数（' + B.length + '）多于双酶切片段数（' + D.length +
        '），合并只会减少片段数，无法得到。', ['A']);
    }
    var rb = search({ mode: 'B', B: B, D: D, budget: budget });
    if (rb.aborted) return { status: 'aborted', message: '枚举规模超出预算，请减少双酶切片段数。' };
    if (!rb.found) {
      return infeasible('B',
        '不存在双酶切片段的排列，使其连续分段合并后得到酶B单酶切片段多重集。', ['A']);
    }

    // 阶段三：两组单酶切能否同时满足
    if (A.length + B.length - 1 < D.length) {
      return infeasible('double',
        '双酶切内部切点共 ' + (D.length - 1) + ' 个，但两种单酶切合计只能提供 ' +
        (A.length - 1 + B.length - 1) + ' 个切点，必有间隔既不被酶A也不被酶B切割。', ['A', 'B']);
    }
    var rj = search({ mode: 'joint', A: A, B: B, D: D, budget: budget });
    if (rj.aborted) return { status: 'aborted', message: '枚举规模超出预算，请减少双酶切片段数。' };
    if (rj.classes.size === 0) {
      return infeasible('double',
        '酶A、酶B单酶切各自均可由双酶切片段合并得到，但不存在同时满足两组的片段排列与切点归属。',
        ['A', 'B']);
    }

    var solutions = Array.from(rj.classes.values());
    var result = {
      status: solutions.length === 1 ? 'unique' : 'multiple',
      total: total,
      solutions: solutions
    };
    if (solutions.length > 1) {
      result.divergence = divergence(solutions[0], solutions[1]);
    }
    return result;
  }

  /* ======================================================================
   * 鉴别实验设计
   * ====================================================================== */

  var MIN_ENZYMES = 2;
  var MAX_ENZYMES = 5;
  var EXP_BUDGET = 2000000; // 完整枚举全部非反向等价类的节点预算
  var MAX_CLASSES = 2000; // 非反向等价类数量上限（防止解空间爆炸导致内存无界增长）
  var MAX_HYPOTHESIS_PAIRS = 1000000; // 鉴别对矩阵规模上限

  // 多集排序后的稳定键（片段长度多重集）
  function multisetKey(arr) {
    return arr.slice().sort(function (a, b) { return a - b; }).join(',');
  }

  /* 给定一组切点坐标（0 < p < total），预测线性 DNA 的酶切片段多重集。
   * 重合切点只计一次（如候选酶与酶A共切同一位点，不产生 0 长度片段）。 */
  function digestFragments(total, cuts) {
    var ps = Array.from(new Set(cuts)).sort(function (a, b) { return a - b; });
    var out = [];
    var prev = 0;
    for (var i = 0; i < ps.length; i++) {
      out.push(ps[i] - prev);
      prev = ps[i];
    }
    out.push(total - prev);
    return out;
  }

  /* 单个定向假设上某个候选酶的全部预测（候选酶单酶切 + 与酶A/酶B双酶切）。
   * 假设坐标均以已标记左端为 0；候选酶录入的切点即在该坐标系下量取。 */
  function hypothesisSignatures(hyp, enzymes) {
    var cutsA = [];
    var cutsB = [];
    for (var s = 0; s < hyp.sites.length; s++) {
      if (hyp.sites[s] === SITE_A || hyp.sites[s] === SITE_AB) cutsA.push(hyp.cuts[s]);
      if (hyp.sites[s] === SITE_B || hyp.sites[s] === SITE_AB) cutsB.push(hyp.cuts[s]);
    }
    var sigs = new Array(enzymes.length);
    for (var e = 0; e < enzymes.length; e++) {
      var cutsC = enzymes[e].cuts;
      var cFrags = digestFragments(hyp.total, cutsC);
      var caFrags = digestFragments(hyp.total, cutsC.concat(cutsA));
      var cbFrags = digestFragments(hyp.total, cutsC.concat(cutsB));
      sigs[e] = {
        C: cFrags,
        CA: caFrags,
        CB: cbFrags,
        CKey: multisetKey(cFrags),
        CAKey: multisetKey(caFrags),
        CBKey: multisetKey(cbFrags)
      };
    }
    return sigs;
  }

  // 两个签名在某个实验上是否预测一致（双酶切片段多重集相等）
  function sameOnExperiment(s1, s2, enzymeIdx, partner) {
    return partner === 'A'
      ? s1[enzymeIdx].CAKey === s2[enzymeIdx].CAKey
      : s1[enzymeIdx].CBKey === s2[enzymeIdx].CBKey;
  }

  // 位掩码：该实验无法区分的假设对（bit=1 表示预测仍相同）
  function experimentMask(experiment, sigs, pairIndex) {
    var mask = pairIndex.zero.slice();
    pairIndex.pairs.forEach(function (p, idx) {
      if (sameOnExperiment(sigs[p.i], sigs[p.j], experiment.enzymeIdx, experiment.partner)) {
        mask[idx >> 6] |= pairIndex.bits[idx & 63];
      }
    });
    return mask;
  }

  function maskIsZero(mask) {
    for (var i = 0; i < mask.length; i++) if (mask[i] !== 0n) return false;
    return true;
  }

  function maskIntersectInto(acc, mask) {
    for (var i = 0; i < acc.length; i++) acc[i] &= mask[i];
  }

  /* 在给定实验集合中找一对预测始终相同的假设（用于不可鉴别证据）。 */
  function findIndistinguishablePair(experiments, sigs, pairs) {
    for (var idx = 0; idx < pairs.length; idx++) {
      var p = pairs[idx];
      var allSame = true;
      for (var x = 0; x < experiments.length; x++) {
        if (!sameOnExperiment(sigs[p.i], sigs[p.j], experiments[x].enzymeIdx, experiments[x].partner)) {
          allSame = false;
          break;
        }
      }
      if (allSame) return p;
    }
    return null;
  }

  // 逐项片段证据：逐候选酶列出该对假设的单酶切与两组双酶切预测（全部相同）
  function evidenceForPair(pair, sigs, enzymes) {
    var items = [];
    for (var e = 0; e < enzymes.length; e++) {
      ['C', 'CA', 'CB'].forEach(function (kind) {
        var f1 = sigs[pair.i][e][kind].slice().sort(function (a, b) { return a - b; });
        var f2 = sigs[pair.j][e][kind].slice().sort(function (a, b) { return a - b; });
        items.push({
          enzymeIndex: e,
          enzymeName: enzymes[e].name,
          kind: kind,
          partner: kind === 'C' ? null : (kind === 'CA' ? 'A' : 'B'),
          first: f1,
          second: f2,
          equal: multisetKey(f1) === multisetKey(f2)
        });
      });
    }
    return items;
  }

  /* 候选验证酶录入校验：2~5 种，名称非空且不重复，内部切点为去重后严格位于
   * (0, total) 的正整数（从已标记左端量取）。cuts 可传整数数组或 cutsText 字符串。 */
  function validateEnzymes(total, rawEnzymes) {
    if (!Array.isArray(rawEnzymes) || rawEnzymes.length < MIN_ENZYMES || rawEnzymes.length > MAX_ENZYMES) {
      return {
        enzymes: null,
        issues: [{ group: 'enzymes', message: '候选验证酶必须为 ' + MIN_ENZYMES + '~' + MAX_ENZYMES + ' 种。' }]
      };
    }
    var issues = [];
    var enzymes = [];
    var names = new Set();
    rawEnzymes.forEach(function (raw, i) {
      var where = '第 ' + (i + 1) + ' 种候选酶';
      var name = (raw && typeof raw.name === 'string') ? raw.name.trim() : '';
      if (name === '') {
        issues.push({ group: 'enzymes', index: i, message: where + '名称为空。' });
        return;
      }
      if (names.has(name)) {
        issues.push({ group: 'enzymes', index: i, message: '候选酶名称重复：“' + name + '”。' });
        return;
      }
      names.add(name);

      var tokens = [];
      if (Array.isArray(raw.cuts)) {
        tokens = raw.cuts.map(function (v) { return String(v); });
      } else if (typeof raw.cutsText === 'string') {
        tokens = raw.cutsText.split(/[\s,，、;；]+/).filter(function (p) { return p !== ''; });
      }
      var cuts = [];
      var seen = new Set();
      for (var k = 0; k < tokens.length; k++) {
        var v = Number(tokens[k]);
        if (!isPositiveInteger(v) || v <= 0 || v >= total) {
          issues.push({ group: 'enzymes', index: i, message: where + '（' + name + '）的内部切点 “' + tokens[k] +
            '” 不是 1 与 ' + (total - 1) + ' 之间的整数。' });
          return;
        }
        if (seen.has(v)) {
          issues.push({ group: 'enzymes', index: i, message: where + '（' + name + '）的内部切点 ' + v + ' 重复。' });
          return;
        }
        seen.add(v);
        cuts.push(v);
      }
      enzymes.push({ name: name, cuts: cuts.sort(function (a, b) { return a - b; }) });
    });
    return { enzymes: issues.length ? null : enzymes, issues: issues };
  }

  /* 完整枚举某个消化输入下的全部非反向等价类（受节点预算与类数量上限约束）。 */
  function enumerateClasses(raw, budget, maxClasses) {
    var issues = validate(raw);
    if (issues.length) return { status: 'invalid', issues: issues };
    var A = sortedCopy(raw.A);
    var B = sortedCopy(raw.B);
    var D = sortedCopy(raw.D);
    var rj = search({
      mode: 'joint',
      A: A,
      B: B,
      D: D,
      budget: budget,
      collectAll: true,
      maxClasses: maxClasses
    });
    if (rj.aborted) return { status: 'aborted', message: '完整枚举规模超出预算，请减少双酶切片段数。' };
    if (rj.overflow) {
      return {
        status: 'aborted',
        overflow: true,
        message: '非反向等价图谱数量超过上限 ' + maxClasses +
          '，鉴别设计需要完整枚举，请收紧双酶切片段数或片段取值。'
      };
    }
    if (rj.classes.size === 0) {
      return { status: 'infeasible', message: '不存在可行图谱，无法设计鉴别实验。' };
    }
    // 稳定顺序：按令牌序列字典序，保证假设编号与裁决可复现
    var classes = Array.from(rj.classes.values()).sort(function (m1, m2) {
      return JSON.stringify(m1.tokens) < JSON.stringify(m2.tokens) ? -1 : 1;
    });
    return { status: 'ok', total: raw.total, classes: classes };
  }

  /* 主入口：设计鉴别实验。
   * 参数 raw 为原消化输入 {total,A,B,D}；rawEnzymes 为 2~5 种候选酶
   * [{name, cuts:number[] 或 cutsText}]，按录入顺序裁决。 */
  function designExperiments(raw, rawEnzymes, options) {
    var budget = options && isPositiveInteger(options.budget) ? options.budget : EXP_BUDGET;
    var maxClasses = options && isPositiveInteger(options.maxClasses) ? options.maxClasses : MAX_CLASSES;
    var en = enumerateClasses(raw, budget, maxClasses);
    if (en.status !== 'ok') return en;

    var checked = validateEnzymes(en.total, rawEnzymes);
    if (checked.issues.length) return { status: 'invalid', issues: checked.issues };
    var enzymes = checked.enzymes;

    // 每个非反向等价类按左端标记展开为两种定向假设：正向（规范方向）与整体反向。
    // 自反（回文）等价类两种定向完全重合，物理上只有一个假设，只保留一个。
    var hypotheses = [];
    en.classes.forEach(function (m, ci) {
      var rf = m.fragments.slice().reverse();
      var rs = m.sites.slice().reverse();
      var palindromic = JSON.stringify(tokensOf(rf, rs)) === JSON.stringify(m.tokens);
      hypotheses.push({
        classIndex: ci,
        orientation: 'forward',
        palindromic: palindromic,
        label: '假设 ' + (ci + 1) + 'a（等价类 ' + (ci + 1) + '·正向）',
        fragments: m.fragments.slice(),
        sites: m.sites.slice(),
        cuts: m.cuts.slice(),
        total: m.total,
        tokens: m.tokens
      });
      if (!palindromic) {
        var rm = makeMap(rf, rs); // 反向后切点坐标自动变为 total - 原坐标
        hypotheses.push({
          classIndex: ci,
          orientation: 'reverse',
          palindromic: false,
          label: '假设 ' + (ci + 1) + 'b（等价类 ' + (ci + 1) + '·反向）',
          fragments: rm.fragments,
          sites: rm.sites,
          cuts: rm.cuts,
          total: rm.total,
          tokens: rm.tokens
        });
      }
    });

    var sigs = hypotheses.map(function (h) { return hypothesisSignatures(h, enzymes); });

    // 全部待区分的假设对（含同一等价类的正/反向：标记左端后二者是不同假设）
    var pairs = [];
    for (var i = 0; i < hypotheses.length; i++) {
      for (var j = i + 1; j < hypotheses.length; j++) pairs.push({ i: i, j: j });
    }
    if (pairs.length > MAX_HYPOTHESIS_PAIRS) {
      return { status: 'aborted', message: '假设数量过多（' + hypotheses.length +
        ' 个定向假设），鉴别对矩阵超出预算，请收紧双酶切片段枚举。' };
    }
    var words = Math.max(1, Math.ceil(pairs.length / 64));
    var pairIndex = {
      pairs: pairs,
      zero: new BigUint64Array(words),
      bits: (function () { var b = []; for (var x = 0; x < 64; x++) b.push(1n << BigInt(x)); return b; })()
    };

    // 候选实验：每种候选酶 × {与酶A双酶切, 与酶B双酶切}，按录入顺序、酶A优先
    var experiments = [];
    enzymes.forEach(function (enz, e) {
      experiments.push({ enzymeIdx: e, enzymeName: enz.name, partner: 'A', label: enz.name + ' ＋ 酶A 双酶切' });
      experiments.push({ enzymeIdx: e, enzymeName: enz.name, partner: 'B', label: enz.name + ' ＋ 酶B 双酶切' });
    });
    var masks = experiments.map(function (exp) { return experimentMask(exp, sigs, pairIndex); });

    // 求数量最少的实验组：按组数 k=1..E 递增穷举组合，交集掩码为 0 即区分全部假设对。
    // 候选实验已按 (酶录入顺序, 酶A优先) 排列，组合按下标递增枚举 →
    // 首个可行组合即并列情况下字典序最小、裁决稳定的最小组。
    var selected = null;
    var E = experiments.length;
    if (pairs.length > 0) {
      var combo = [];
      var currentK = 0;
      function choose(start) {
        if (selected) return;
        if (combo.length === currentK) {
          var acc = null;
          for (var t = 0; t < combo.length; t++) {
            if (acc === null) acc = masks[combo[t]].slice();
            else maskIntersectInto(acc, masks[combo[t]]);
          }
          if (acc !== null && maskIsZero(acc)) selected = combo.slice();
          return;
        }
        for (var q = start; q <= E - (currentK - combo.length); q++) {
          combo.push(q);
          choose(q + 1);
          combo.pop();
          if (selected) return;
        }
      }
      for (currentK = 1; currentK <= E; currentK++) {
        choose(0);
        if (selected) break;
      }
    }

    // 每种假设 × 候选酶的三管预测（候选酶单酶切 / ＋酶A / ＋酶B），供页面逐项展示
    var predictions = sigs.map(function (hs) {
      return hs.map(function (s) {
        return {
          C: s.C.slice().sort(function (a, b) { return a - b; }),
          CA: s.CA.slice().sort(function (a, b) { return a - b; }),
          CB: s.CB.slice().sort(function (a, b) { return a - b; })
        };
      });
    });

    var result = {
      total: en.total,
      classes: en.classes,
      hypotheses: hypotheses,
      enzymes: enzymes,
      predictions: predictions,
      allExperiments: experiments
    };

    if (pairs.length === 0) {
      result.status = 'distinguishable';
      result.discriminating = []; // 只有一个假设，无需实验
      return result;
    }

    if (selected) {
      result.status = 'distinguishable';
      result.discriminating = selected.map(function (idx) {
        var exp = experiments[idx];
        var count = 0;
        pairs.forEach(function (p) {
          if (!sameOnExperiment(sigs[p.i], sigs[p.j], exp.enzymeIdx, exp.partner)) count++;
        });
        return {
          enzymeIdx: exp.enzymeIdx,
          enzymeName: exp.enzymeName,
          partner: exp.partner,
          label: exp.label,
          separatedPairs: count
        };
      });
      return result;
    }

    result.status = 'indistinguishable';
    var p = findIndistinguishablePair(experiments, sigs, pairs);
    result.indistinguishablePair = {
      firstIndex: p.i,
      secondIndex: p.j,
      first: hypotheses[p.i].label,
      second: hypotheses[p.j].label,
      evidence: evidenceForPair(p, sigs, enzymes)
    };
    return result;
  }

  return {
    solve: solve,
    designExperiments: designExperiments,
    validateEnzymes: validateEnzymes,
    digestFragments: digestFragments,
    parseFragments: parseFragments,
    divergence: divergence,
    SITE_A: SITE_A,
    SITE_B: SITE_B,
    SITE_AB: SITE_AB,
    MAX_DOUBLE_FRAGMENTS: MAX_DOUBLE_FRAGMENTS,
    MIN_ENZYMES: MIN_ENZYMES,
    MAX_ENZYMES: MAX_ENZYMES
  };
});
