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
   * mode 'joint' ：同时满足两组单酶切，收集反向等价类（最多 2 个见证）
   */
  function search(cfg) {
    var mode = cfg.mode;
    var trackA = mode !== 'B';
    var trackB = mode !== 'A';
    var collect = mode === 'joint';
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
          if (classes.size >= 2) stop = true; // 只需区分唯一 / 多解
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
    return { aborted: aborted, found: found, classes: classes };
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

  return {
    solve: solve,
    parseFragments: parseFragments,
    divergence: divergence,
    SITE_A: SITE_A,
    SITE_B: SITE_B,
    SITE_AB: SITE_AB,
    MAX_DOUBLE_FRAGMENTS: MAX_DOUBLE_FRAGMENTS
  };
});
