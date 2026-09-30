/* 页面交互：读取输入 → 调用 DigestSolver.solve → 渲染结论。
 * 修改任一草稿（四个输入框）立即清除旧结论。 */
(function () {
  'use strict';

  var GROUP_LABEL = {
    A: '酶A单酶切',
    B: '酶B单酶切',
    double: '双酶切（联合）',
    D: '双酶切',
    total: '总长度',
    input: '输入'
  };
  var SITE_LABEL = { A: '酶A', B: '酶B', AB: '酶A+酶B' };

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  var totalInput = document.getElementById('total');
  var fragA = document.getElementById('fragA');
  var fragB = document.getElementById('fragB');
  var fragD = document.getElementById('fragD');
  var solveBtn = document.getElementById('solve');
  var statusEl = document.getElementById('status');
  var resultEl = document.getElementById('result');

  /* 修改任一草稿后必须清除旧结论 */
  function clearOutput() {
    statusEl.textContent = '';
    statusEl.className = 'status';
    resultEl.className = 'result empty';
    resultEl.textContent = '';
    resultEl.appendChild(el('p', 'hint', '输入已修改，旧结论已清除，请重新点击“复原图谱”。'));
  }
  [totalInput, fragA, fragB, fragD].forEach(function (input) {
    input.addEventListener('input', clearOutput);
  });

  var EXAMPLES = {
    unique: { total: '6', A: '2, 2, 2', B: '3, 3', D: '1, 1, 2, 2' },
    multiple: { total: '8', A: '1, 2, 5', B: '3, 5', D: '1, 2, 2, 3' },
    infeasible: { total: '10', A: '2, 8', B: '4, 6', D: '1, 3, 3, 3' }
  };
  Array.prototype.forEach.call(document.querySelectorAll('[data-example]'), function (btn) {
    btn.addEventListener('click', function () {
      var ex = EXAMPLES[btn.getAttribute('data-example')];
      totalInput.value = ex.total;
      fragA.value = ex.A;
      fragB.value = ex.B;
      fragD.value = ex.D;
      clearOutput();
    });
  });

  solveBtn.addEventListener('click', function () {
    var pA = DigestSolver.parseFragments(fragA.value);
    var pB = DigestSolver.parseFragments(fragB.value);
    var pD = DigestSolver.parseFragments(fragD.value);
    var parseIssues = [];
    if (pA.error) parseIssues.push({ group: 'A', message: pA.error });
    if (pB.error) parseIssues.push({ group: 'B', message: pB.error });
    if (pD.error) parseIssues.push({ group: 'D', message: pD.error });

    var res;
    if (parseIssues.length) {
      res = { status: 'invalid', issues: parseIssues };
    } else {
      res = DigestSolver.solve({
        total: Number(totalInput.value),
        A: pA.values,
        B: pB.values,
        D: pD.values
      });
    }
    render(res);
  });

  function render(res) {
    resultEl.className = 'result';
    resultEl.textContent = '';

    if (res.status === 'invalid') {
      statusEl.textContent = '✗ 输入有误';
      statusEl.className = 'status error';
      var ul = el('ul', 'issues');
      res.issues.forEach(function (issue) {
        ul.appendChild(el('li', null, (GROUP_LABEL[issue.group] || issue.group) + '：' + issue.message));
      });
      resultEl.appendChild(ul);
      return;
    }

    if (res.status === 'aborted') {
      statusEl.textContent = '✗ 枚举规模超出预算';
      statusEl.className = 'status error';
      resultEl.appendChild(el('p', null, res.message));
      return;
    }

    if (res.status === 'infeasible') {
      statusEl.textContent = '✗ 无可行图谱';
      statusEl.className = 'status error';
      resultEl.appendChild(el('p', 'failure',
        '最先无法同时满足的消化组：' + (GROUP_LABEL[res.failure.group] || res.failure.group)));
      resultEl.appendChild(el('p', null, res.failure.message));
      if (res.failure.passed && res.failure.passed.length) {
        resultEl.appendChild(el('p', 'passed',
          '已通过的检查：' + res.failure.passed.map(function (g) {
            return GROUP_LABEL[g] + '可由双酶切片段合并得到';
          }).join('；') + '。'));
      }
      return;
    }

    if (res.status === 'unique') {
      statusEl.textContent = '✓ 复原成功：图谱唯一（整体反向视为同一图谱，已按规范方向展示）';
      statusEl.className = 'status ok';
      resultEl.appendChild(renderMap(res.solutions[0], null, 0));
      return;
    }

    /* multiple */
    statusEl.textContent = '⚠ 存在多个非反向等价图谱（至少 2 个），以下给出两份见证';
    statusEl.className = 'status warn';
    if (res.divergence) {
      resultEl.appendChild(el('p', 'divergence', divergenceText(res.divergence)));
    }
    resultEl.appendChild(renderMap(res.solutions[0], res.divergence, 1));
    resultEl.appendChild(renderMap(res.solutions[1], res.divergence, 2));
  }

  function divergenceText(div) {
    if (div.kind === 'fragment') {
      return '首个分歧：第 ' + (div.fragmentIndex + 1) + ' 个双酶切片段（起点坐标 ' +
        div.coordinate + '）——见证1 长度 ' + div.first + '，见证2 长度 ' + div.second + '。';
    }
    return '首个分歧：坐标 ' + div.coordinate + ' 处的内部切点——见证1 归属 ' +
      SITE_LABEL[div.first] + '，见证2 归属 ' + SITE_LABEL[div.second] + '。';
  }

  /* 渲染一张图谱：从左端开始的双酶切片段、每个内部切点所属酶与坐标、
   * 以及两组单酶切如何由连续双酶切片段合并得到。 */
  function renderMap(map, div, witnessNo) {
    var wrap = el('div', 'map');
    wrap.appendChild(el('h2', null, witnessNo > 0 ? '见证 ' + witnessNo : '复原图谱'));

    var track = el('div', 'track');
    track.appendChild(el('span', 'coord', '0'));
    map.fragments.forEach(function (len, i) {
      if (i > 0) {
        var site = map.sites[i - 1];
        var siteEl = el('span', 'site site-' + site);
        siteEl.appendChild(el('span', 'siteenzyme', SITE_LABEL[site]));
        siteEl.appendChild(el('span', 'sitecoord', '@' + map.cuts[i - 1]));
        if (div && div.kind === 'site' && div.siteIndex === i - 1) {
          siteEl.classList.add('divergent');
        }
        track.appendChild(siteEl);
      }
      var frag = el('span', 'frag', 'D' + (i + 1) + ' · ' + len);
      frag.style.flexGrow = String(len);
      frag.title = '双酶切片段 D' + (i + 1) + '，长度 ' + len;
      if (div && div.kind === 'fragment' && div.fragmentIndex === i) {
        frag.classList.add('divergent');
      }
      track.appendChild(frag);
    });
    track.appendChild(el('span', 'coord', String(map.total)));
    wrap.appendChild(track);

    var table = el('table', 'cuts');
    var head = el('tr');
    ['内部切点', '坐标', '所属酶'].forEach(function (h) { head.appendChild(el('th', null, h)); });
    table.appendChild(head);
    if (map.sites.length === 0) {
      var none = el('tr');
      var td = el('td', null, '（无内部切点）');
      td.colSpan = 3;
      none.appendChild(td);
      table.appendChild(none);
    }
    map.sites.forEach(function (s, i) {
      var tr = el('tr');
      if (div && div.kind === 'site' && div.siteIndex === i) tr.className = 'divergent-row';
      tr.appendChild(el('td', null, 'S' + (i + 1)));
      tr.appendChild(el('td', null, String(map.cuts[i])));
      tr.appendChild(el('td', null, SITE_LABEL[s]));
      table.appendChild(tr);
    });
    wrap.appendChild(table);

    wrap.appendChild(renderMerge('酶A单酶切', map, map.aRuns));
    wrap.appendChild(renderMerge('酶B单酶切', map, map.bRuns));
    return wrap;
  }

  function renderMerge(title, map, runs) {
    var box = el('div', 'merge');
    box.appendChild(el('h3', null, title + '：由连续双酶切片段合并'));
    var prefix = [0];
    map.fragments.forEach(function (f) { prefix.push(prefix[prefix.length - 1] + f); });
    var ul = el('ul');
    runs.forEach(function (run, i) {
      var parts = [];
      for (var k = run.start; k < run.end; k++) {
        parts.push('D' + (k + 1) + '(' + map.fragments[k] + ')');
      }
      ul.appendChild(el('li', null,
        '片段 ' + (i + 1) + '：坐标 [' + prefix[run.start] + ', ' + prefix[run.end] +
        ')，长度 ' + run.length + ' = ' + parts.join(' + ')));
    });
    box.appendChild(ul);
    return box;
  }
})();
