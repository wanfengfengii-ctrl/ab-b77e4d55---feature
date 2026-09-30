/* 页面交互：读取输入 → 调用 DigestSolver.solve → 渲染结论。
 * 修改任一草稿（四个输入框）立即清除旧结论与旧鉴别方案。 */
(function () {
  'use strict';

  var GROUP_LABEL = {
    A: '酶A单酶切',
    B: '酶B单酶切',
    double: '双酶切（联合）',
    D: '双酶切',
    total: '总长度',
    input: '输入',
    enzymes: '候选验证酶'
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

  /* 最近一次复原所用的消化数据（鉴别实验设计基于它完整重枚举） */
  var lastDigest = null;

  /* 修改任一草稿后必须清除旧结论与旧鉴别方案 */
  function clearOutput() {
    statusEl.textContent = '';
    statusEl.className = 'status';
    resultEl.className = 'result empty';
    resultEl.textContent = '';
    resultEl.appendChild(el('p', 'hint', '输入已修改，旧结论已清除，请重新点击“复原图谱”。'));
    resetDesignPanel();
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
    var digest = null;
    if (parseIssues.length) {
      res = { status: 'invalid', issues: parseIssues };
    } else {
      digest = { total: Number(totalInput.value), A: pA.values, B: pB.values, D: pD.values };
      res = DigestSolver.solve(digest);
    }
    lastDigest = (res.status === 'unique' || res.status === 'multiple') ? digest : null;
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
      setDesignAvailable(false);
      return;
    }

    if (res.status === 'aborted') {
      statusEl.textContent = '✗ 枚举规模超出预算';
      statusEl.className = 'status error';
      resultEl.appendChild(el('p', null, res.message));
      setDesignAvailable(false);
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
      setDesignAvailable(false);
      return;
    }

    if (res.status === 'unique') {
      statusEl.textContent = '✓ 复原成功：图谱唯一（整体反向视为同一图谱，已按规范方向展示）';
      statusEl.className = 'status ok';
      resultEl.appendChild(renderMap(res.solutions[0], null, 0));
      setDesignAvailable(false);
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
    setDesignAvailable(true);
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

  /* ================= 鉴别实验设计面板 ================= */

  var designPanel = document.getElementById('design');
  var enzymeRows = document.getElementById('enzymeRows');
  var addEnzymeBtn = document.getElementById('addEnzyme');
  var removeEnzymeBtn = document.getElementById('removeEnzyme');
  var designBtn = document.getElementById('designBtn');
  var designResult = document.getElementById('designResult');

  function setDesignAvailable(available) {
    if (!available) {
      designPanel.classList.add('hidden');
      // 非多解结论下，旧鉴别方案不再适用，一并清除（候选酶录入草稿保留）
      lastDigest = null;
      clearDesignResult('当前结论不是多解；重新得到多个非反向等价图谱后可发起鉴别实验设计。');
    } else {
      designPanel.classList.remove('hidden');
    }
  }

  function resetDesignPanel() {
    lastDigest = null;
    designPanel.classList.add('hidden');
    clearDesignResult('原消化数据已修改，旧鉴别方案已清除；重新得到多解结论后可再次发起设计。');
  }

  function buildEnzymeRows(n) {
    var count = enzymeRows.querySelectorAll('.enzyme-row').length;
    while (count < n && count < DigestSolver.MAX_ENZYMES) {
      addEnzymeRow(count + 1);
      count++;
    }
    while (count > n && count > DigestSolver.MIN_ENZYMES) {
      enzymeRows.removeChild(enzymeRows.lastElementChild);
      count--;
    }
  }

  function addEnzymeRow(no) {
    var row = el('div', 'enzyme-row');
    var name = el('input', 'enzyme-name');
    name.type = 'text';
    name.placeholder = '酶名称（如 EcoRV）';
    name.autocomplete = 'off';
    name.setAttribute('aria-label', '第 ' + no + ' 种候选验证酶名称');
    var cuts = el('input', 'enzyme-cuts');
    cuts.type = 'text';
    cuts.placeholder = '内部切点（从标记左端量取，如 2, 5）';
    cuts.autocomplete = 'off';
    cuts.setAttribute('aria-label', '第 ' + no + ' 种候选验证酶内部切点');
    [name, cuts].forEach(function (input) {
      input.addEventListener('input', function () {
        clearDesignResult('候选验证酶已修改，旧方案已清除，请重新点击“设计鉴别实验”。');
      });
    });
    row.appendChild(name);
    row.appendChild(cuts);
    enzymeRows.appendChild(row);
  }

  /* 修改原消化数据或候选验证酶后，立即清除旧鉴别方案（不清空酶录入草稿本身） */
  function clearDesignResult(hint) {
    designResult.textContent = '';
    designResult.className = 'design-result';
    if (hint) designResult.appendChild(el('p', 'hint', hint));
  }

  addEnzymeBtn.addEventListener('click', function () {
    var count = enzymeRows.querySelectorAll('.enzyme-row').length;
    if (count >= DigestSolver.MAX_ENZYMES) return;
    addEnzymeRow(count + 1);
    clearDesignResult('候选验证酶已修改，旧方案已清除，请重新点击“设计鉴别实验”。');
  });
  removeEnzymeBtn.addEventListener('click', function () {
    var count = enzymeRows.querySelectorAll('.enzyme-row').length;
    if (count <= DigestSolver.MIN_ENZYMES) return;
    enzymeRows.removeChild(enzymeRows.lastElementChild);
    clearDesignResult('候选验证酶已修改，旧方案已清除，请重新点击“设计鉴别实验”。');
  });

  // 候选酶示例（与上方“多解见证”输入配套）：填入 2 行并清除旧方案
  var ENZYME_EXAMPLES = {
    distinguishable: [{ name: 'E1', cuts: '1, 6' }, { name: 'E2', cuts: '1' }],
    indistinguishable: [{ name: 'C1', cuts: '2' }, { name: 'C2', cuts: '4' }]
  };
  Array.prototype.forEach.call(document.querySelectorAll('[data-enzymes]'), function (btn) {
    btn.addEventListener('click', function () {
      var preset = ENZYME_EXAMPLES[btn.getAttribute('data-enzymes')];
      if (!preset) return;
      buildEnzymeRows(preset.length);
      var rows = enzymeRows.querySelectorAll('.enzyme-row');
      Array.prototype.forEach.call(rows, function (row, i) {
        row.querySelector('.enzyme-name').value = preset[i].name;
        row.querySelector('.enzyme-cuts').value = preset[i].cuts;
      });
      clearDesignResult('候选验证酶已填入示例，旧方案已清除，请点击“设计鉴别实验”。');
    });
  });

  designBtn.addEventListener('click', function () {
    if (!lastDigest) {
      clearDesignResult();
      designResult.appendChild(renderDesignMessage('error', '请先在上方完成图谱复原并得到多解结论。'));
      return;
    }
    var rawEnzymes = [];
    var rows = enzymeRows.querySelectorAll('.enzyme-row');
    Array.prototype.forEach.call(rows, function (row) {
      rawEnzymes.push({
        name: row.querySelector('.enzyme-name').value,
        cutsText: row.querySelector('.enzyme-cuts').value
      });
    });
    var res = DigestSolver.designExperiments(lastDigest, rawEnzymes);
    renderDesign(res);
  });

  function renderDesignMessage(kind, text) {
    var p = el('p', 'design-msg ' + kind, text);
    return p;
  }

  function renderDesign(res) {
    designResult.textContent = '';
    designResult.className = 'design-result';

    if (res.status === 'invalid') {
      designResult.appendChild(renderDesignMessage('error', '候选验证酶录入有误：'));
      var ul = el('ul', 'issues');
      res.issues.forEach(function (issue) {
        ul.appendChild(el('li', null, issue.message));
      });
      designResult.appendChild(ul);
      return;
    }
    if (res.status === 'aborted' || res.status === 'infeasible') {
      designResult.appendChild(renderDesignMessage('error', res.message));
      return;
    }

    var summary = el('p', 'design-summary');
    summary.textContent = '完整枚举得到 ' + res.classes.length + ' 个非反向等价图谱，按标记左端展开为 ' +
      res.hypotheses.length + ' 种定向假设；已为 ' + res.enzymes.length +
      ' 种候选酶各计算与酶A、酶B双酶切的预测片段多重集。';
    designResult.appendChild(summary);

    if (res.status === 'distinguishable') {
      designResult.appendChild(renderDistinguishable(res));
    } else {
      designResult.appendChild(renderIndistinguishable(res));
    }
    designResult.appendChild(renderPredictionTable(res));
  }

  function renderDistinguishable(res) {
    var box = el('div', 'design-ok');
    if (res.discriminating.length === 0) {
      box.appendChild(el('h3', null, '仅有一种定向假设，无需鉴别实验。'));
      return box;
    }
    box.appendChild(el('h3', null,
      '✓ 最少只需 ' + res.discriminating.length + ' 项实验即可区分全部 ' +
      res.hypotheses.length + ' 种定向假设（并列时按酶录入顺序、酶A优先裁决）：'));
    var ol = el('ol');
    res.discriminating.forEach(function (exp) {
      ol.appendChild(el('li', null,
        exp.label + '（候选酶 “' + exp.enzymeName + '” 切点 ' +
        res.enzymes[exp.enzymeIdx].cuts.join(', ') +
        '；该项预测可区分 ' + exp.separatedPairs + ' 对假设）'));
    });
    box.appendChild(ol);
    box.appendChild(el('p', 'small muted',
      '判定依据：任意两种定向假设在上述至少一项实验中的双酶切片段多重集不同。'));
    return box;
  }

  function renderIndistinguishable(res) {
    var box = el('div', 'design-bad');
    var pair = res.indistinguishablePair;
    box.appendChild(el('h3', null, '✗ 全部候选实验仍无法区分以下一对定向假设：'));
    var ul = el('ul');
    ul.appendChild(el('li', null, pair.first));
    ul.appendChild(el('li', null, pair.second));
    box.appendChild(ul);
    box.appendChild(el('p', null, '逐项片段证据（两种假设的预测多重集始终相同）：'));

    var table = el('table', 'evidence');
    var head = el('tr');
    ['候选酶', '消化组合', pair.first + ' 预测', pair.second + ' 预测', '是否相同'].forEach(function (h) {
      head.appendChild(el('th', null, h));
    });
    table.appendChild(head);
    pair.evidence.forEach(function (ev) {
      var tr = el('tr');
      tr.appendChild(el('td', null, ev.enzymeName));
      tr.appendChild(el('td', null, ev.kind === 'C'
        ? ev.enzymeName + ' 单酶切'
        : ev.enzymeName + ' ＋ 酶' + ev.partner + ' 双酶切'));
      tr.appendChild(el('td', null, ev.first.join(', ')));
      tr.appendChild(el('td', null, ev.second.join(', ')));
      tr.appendChild(el('td', ev.equal ? 'same' : 'diff', ev.equal ? '相同' : '不同'));
      table.appendChild(tr);
    });
    box.appendChild(table);
    box.appendChild(el('p', 'small muted',
      '提示：修改原消化数据或候选验证酶后，旧方案会立即清除；请换用切点不同的候选酶重新设计。'));
    return box;
  }

  /* 全部假设 × 候选酶的预测明细：候选酶单酶切 / ＋酶A / ＋酶B 三管片段多重集 */
  function renderPredictionTable(res) {
    var box = el('details', 'predictions');
    box.appendChild(el('summary', null, '查看全部定向假设的逐项预测片段多重集'));
    res.hypotheses.forEach(function (hyp, hi) {
      box.appendChild(el('h4', null, hyp.label));
      var table = el('table', 'predtable');
      var head = el('tr');
      ['候选验证酶', '候选酶单酶切', '＋酶A 双酶切', '＋酶B 双酶切'].forEach(function (h) {
        head.appendChild(el('th', null, h));
      });
      table.appendChild(head);
      res.enzymes.forEach(function (enz, ei) {
        var p = res.predictions[hi][ei];
        var tr = el('tr');
        tr.appendChild(el('td', null, enz.name + ' @' + enz.cuts.join(',@')));
        tr.appendChild(el('td', null, p.C.join(', ')));
        tr.appendChild(el('td', null, p.CA.join(', ')));
        tr.appendChild(el('td', null, p.CB.join(', ')));
        table.appendChild(tr);
      });
      box.appendChild(table);
    });
    return box;
  }

  buildEnzymeRows(DigestSolver.MIN_ENZYMES);
})();
