/* 页面交互：读取输入 → 调用 DigestSolver.solve → 渲染结论；
 * 多解后可录入候选验证酶发起 DigestSolver.designExperiment。
 * 修改任一草稿（四个输入框或候选验证酶）立即清除旧结论 / 旧方案。 */
(function () {
  'use strict';

  var GROUP_LABEL = {
    A: '酶A单酶切',
    B: '酶B单酶切',
    double: '双酶切（联合）',
    D: '双酶切',
    total: '总长度',
    input: '输入',
    probe: '候选验证酶'
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

  /* 最近一次复原：保存原始输入与结论，供“设计鉴别实验”复用。
   * 未成功复原为多解时为 null，此时发起设计不会改变原输入与见证。 */
  var lastSolve = null;

  /* 修改任一草稿后必须清除旧结论 */
  function clearOutput() {
    lastSolve = null;
    statusEl.textContent = '';
    statusEl.className = 'status';
    resultEl.className = 'result empty';
    resultEl.textContent = '';
    resultEl.appendChild(el('p', 'hint', '输入已修改，旧结论已清除，请重新点击“复原图谱”。'));
    clearDesign();
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
    var raw = null;
    if (parseIssues.length) {
      res = { status: 'invalid', issues: parseIssues };
    } else {
      raw = {
        total: Number(totalInput.value),
        A: pA.values,
        B: pB.values,
        D: pD.values
      };
      res = DigestSolver.solve(raw);
    }
    lastSolve = res.status === 'multiple' ? { raw: raw, result: res } : null;
    render(res);
    clearDesign();
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

  /* ---------- 鉴别实验设计 ---------- */

  var probeRowsEl = document.getElementById('probeRows');
  var addProbeBtn = document.getElementById('addProbe');
  var removeProbeBtn = document.getElementById('removeProbe');
  var designBtn = document.getElementById('design');
  var designStatusEl = document.getElementById('designStatus');
  var designResultEl = document.getElementById('designResult');

  var DEFAULT_PROBE_COUNT = 2;

  function probeInputs() {
    return Array.prototype.map.call(probeRowsEl.querySelectorAll('.probe-row'), function (row) {
      return { name: row.querySelector('.probe-name'), cuts: row.querySelector('.probe-cuts') };
    });
  }

  function addProbeRow(name, cuts) {
    var row = el('div', 'probe-row');
    var no = probeRowsEl.children.length + 1;
    var nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'probe-name';
    nameInput.placeholder = '验证酶' + no;
    nameInput.value = name || '';
    nameInput.autocomplete = 'off';
    var cutsInput = document.createElement('input');
    cutsInput.type = 'text';
    cutsInput.className = 'probe-cuts';
    cutsInput.placeholder = '内部切点，例如 1, 5';
    cutsInput.value = cuts || '';
    cutsInput.autocomplete = 'off';
    row.appendChild(el('span', 'probe-label', '候选酶 ' + no + '：名称'));
    row.appendChild(nameInput);
    row.appendChild(el('span', 'probe-label', '从左端量取的切点'));
    row.appendChild(cutsInput);
    probeRowsEl.appendChild(row);
  }

  function renumberProbeRows() {
    Array.prototype.forEach.call(probeRowsEl.querySelectorAll('.probe-row'), function (row, i) {
      row.querySelector('.probe-label').textContent = '候选酶 ' + (i + 1) + '：名称';
    });
  }

  for (var pi = 0; pi < DEFAULT_PROBE_COUNT; pi++) addProbeRow();

  /* 修改候选验证酶（含增删行）立即清除旧方案，但不动原复原结论与见证 */
  function clearDesign() {
    designStatusEl.textContent = '';
    designStatusEl.className = 'status';
    designResultEl.className = 'result empty';
    designResultEl.textContent = '';
    designResultEl.appendChild(el('p', 'hint',
      lastSolve
        ? '当前为多解结论：录入 2–5 种候选验证酶后点击“设计鉴别实验”。'
        : '仅在复原结论为“存在多个非反向等价图谱”后可发起；未发起时原输入、结论与见证保持不变。'));
  }

  probeRowsEl.addEventListener('input', function (e) {
    if (e.target.classList.contains('probe-name') || e.target.classList.contains('probe-cuts')) {
      clearDesign();
    }
  });

  addProbeBtn.addEventListener('click', function () {
    if (probeRowsEl.children.length >= DigestSolver.MAX_PROBE_ENZYMES) return;
    addProbeRow();
    clearDesign();
  });
  removeProbeBtn.addEventListener('click', function () {
    if (probeRowsEl.children.length <= DigestSolver.MIN_PROBE_ENZYMES) return;
    probeRowsEl.removeChild(probeRowsEl.lastElementChild);
    renumberProbeRows();
    clearDesign();
  });

  var PROBE_EXAMPLES = {
    distinguishable: [
      { name: '验证酶1', cuts: '1' },
      { name: '验证酶2', cuts: '6' }
    ],
    indistinguishable: [
      { name: '验证酶1', cuts: '3' },
      { name: '验证酶2', cuts: '4' }
    ]
  };
  Array.prototype.forEach.call(document.querySelectorAll('[data-probe-example]'), function (btn) {
    btn.addEventListener('click', function () {
      // 探针示例配套多解见证场景：先把原消化数据设为多解示例并复原
      var ex = EXAMPLES.multiple;
      totalInput.value = ex.total;
      fragA.value = ex.A;
      fragB.value = ex.B;
      fragD.value = ex.D;
      var pA = DigestSolver.parseFragments(fragA.value);
      var pD = DigestSolver.parseFragments(fragD.value);
      var raw = { total: Number(totalInput.value), A: pA.values, B: DigestSolver.parseFragments(fragB.value).values, D: pD.values };
      var res = DigestSolver.solve(raw);
      lastSolve = res.status === 'multiple' ? { raw: raw, result: res } : null;
      render(res);

      var spec = PROBE_EXAMPLES[btn.getAttribute('data-probe-example')];
      probeRowsEl.textContent = '';
      spec.forEach(function (p) { addProbeRow(p.name, p.cuts); });
      clearDesign();
    });
  });

  designBtn.addEventListener('click', function () {
    if (!lastSolve) {
      designStatusEl.textContent = '✗ 请先点击“复原图谱”并得到多解结论，再发起鉴别实验设计';
      designStatusEl.className = 'status error';
      designResultEl.className = 'result empty';
      designResultEl.textContent = '';
      designResultEl.appendChild(el('p', 'hint', '原输入、结论与见证保持不变。'));
      return;
    }
    var issues = [];
    var probes = [];
    probeInputs().forEach(function (inp, i) {
      var parsed = DigestSolver.parseFragments(inp.cuts.value);
      if (parsed.error) {
        issues.push({ group: 'probe', message: '候选验证酶 ' + (i + 1) + '：' + parsed.error });
        return;
      }
      probes.push({ name: inp.name.value.trim(), cuts: parsed.values });
    });
    if (issues.length) {
      renderDesign({ status: 'invalid', issues: issues });
      return;
    }
    renderDesign(DigestSolver.designExperiment(lastSolve.raw, probes));
  });

  function orientationText(h) {
    return '假设 ' + h.id + '（等价类 ' + h.classIndex + ' 的' +
      (h.orientation === '+' ? '正向' : '反向') + '定向' +
      (h.selfReverse ? '，该类自反向，两种定向重合' : '') + '）';
  }

  function hypothesisBrief(h) {
    var parts = [];
    h.map.fragments.forEach(function (f, i) {
      if (i > 0) parts.push('—' + h.map.sites[i - 1] + '@' + h.map.cuts[i - 1] + '—');
      parts.push(String(f));
    });
    return parts.join('');
  }

  function renderDesign(res) {
    designResultEl.className = 'result';
    designResultEl.textContent = '';

    if (res.status === 'invalid') {
      designStatusEl.textContent = '✗ 候选验证酶录入有误';
      designStatusEl.className = 'status error';
      var ul = el('ul', 'issues');
      res.issues.forEach(function (issue) {
        ul.appendChild(el('li', null, (GROUP_LABEL[issue.group] || issue.group) + '：' + issue.message));
      });
      designResultEl.appendChild(ul);
      return;
    }

    if (res.status === 'aborted') {
      designStatusEl.textContent = '✗ 枚举规模超出预算';
      designStatusEl.className = 'status error';
      designResultEl.appendChild(el('p', null, res.message));
      return;
    }

    // 假设一览（始终展示，便于核对预测）
    var summary = el('div', 'design-summary');
    var classCount = (function () {
      var cs = {};
      res.hypotheses.forEach(function (h) { cs[h.classIndex] = true; });
      return Object.keys(cs).length;
    })();
    summary.appendChild(el('p', null,
      '预算内共枚举到 ' + classCount + ' 个非反向等价图谱，展开为 ' +
      res.hypotheses.length + ' 种定向假设：'));
    var hypUl = el('ul', 'hyp-list');
    res.hypotheses.forEach(function (h) {
      hypUl.appendChild(el('li', null, orientationText(h) + '：' + hypothesisBrief(h)));
    });
    summary.appendChild(hypUl);
    designResultEl.appendChild(summary);

    if (res.status === 'distinguishable') {
      designStatusEl.textContent = '✓ 已选出数量最少的鉴别实验集（共 ' +
        res.selected.length + ' 项，覆盖 ' + res.pairCount + ' 对定向假设）';
      designStatusEl.className = 'status ok';
      var intro = el('p', null,
        '下列任意一项实验的预测片段多重集一旦与实测不符，即可排除对应定向假设；' +
        '全部 ' + res.pairCount + ' 对定向假设至少被其中一项实验区分。' +
        '并列时已按候选酶录入顺序、酶A优先于酶B稳定裁决。');
      designResultEl.appendChild(intro);
      res.selected.forEach(function (sel) {
        designResultEl.appendChild(renderPredictionTable(sel, res));
      });
      return;
    }

    /* indistinguishable */
    designStatusEl.textContent = '✗ 全部候选实验仍无法区分部分定向假设';
    designStatusEl.className = 'status error';
    var pair = res.indistinguishablePair;
    var h1 = res.hypotheses.filter(function (h) { return h.id === pair.first; })[0];
    var h2 = res.hypotheses.filter(function (h) { return h.id === pair.second; })[0];
    designResultEl.appendChild(el('p', 'failure',
      '预测始终相同的一对定向假设：' + orientationText(h1) + ' 与 ' + orientationText(h2) + '。'));
    designResultEl.appendChild(el('p', null, '假设 ' + pair.first + '：' + hypothesisBrief(h1)));
    designResultEl.appendChild(el('p', null, '假设 ' + pair.second + '：' + hypothesisBrief(h2)));
    designResultEl.appendChild(el('p', null,
      '逐项片段证据（两种假设在每项候选实验下的预测片段多重集均相同）：'));

    var table = el('table', 'evidence');
    var head = el('tr');
    ['候选实验', '假设 ' + pair.first + ' 预测片段', '假设 ' + pair.second + ' 预测片段', '是否相同'].forEach(function (h) {
      head.appendChild(el('th', null, h));
    });
    table.appendChild(head);
    pair.evidence.forEach(function (ev) {
      var tr = el('tr');
      tr.appendChild(el('td', null, ev.label));
      tr.appendChild(el('td', null, ev.first.join(', ')));
      tr.appendChild(el('td', null, ev.second.join(', ')));
      tr.appendChild(el('td', ev.equal ? 'same' : 'diff', ev.equal ? '相同' : '不同'));
      table.appendChild(tr);
    });
    designResultEl.appendChild(table);
    designResultEl.appendChild(el('p', 'hint',
      '请修改原消化数据或调整候选验证酶的切点；修改后旧方案将立即清除。'));
  }

  function renderPredictionTable(sel, res) {
    var box = el('div', 'map');
    box.appendChild(el('h2', null, '实验：' + sel.label));
    var table = el('table', 'cuts');
    var head = el('tr');
    ['定向假设', '预测片段多重集（长度升序）'].forEach(function (h) {
      head.appendChild(el('th', null, h));
    });
    table.appendChild(head);
    res.predictions[sel.key].byHypothesis.forEach(function (frags, i) {
      var tr = el('tr');
      tr.appendChild(el('td', null, res.hypotheses[i].id));
      tr.appendChild(el('td', null, frags.join(', ')));
      table.appendChild(tr);
    });
    box.appendChild(table);
    return box;
  }

  clearDesign();
})();
