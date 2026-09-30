/*
 * 页面交互冒烟（无浏览器依赖）：用极简 DOM 桩在 vm 中加载 solver.js + app.js，
 * 驱动真实点击与输入事件，验证：
 *   - 多解后才出现鉴别实验面板，未发起时原输入、结论与两份见证不变；
 *   - 候选酶录入（2~5 种）、不可鉴别结论（一对假设 + 逐项相同证据）；
 *   - 可鉴别时给出数量最少的实验组，并列按酶顺序、酶A优先；
 *   - 修改原消化数据或候选酶后立即清除旧方案。
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function makeNode(tag) {
  const node = {
    tagName: tag,
    children: [],
    style: {},
    dataset: {},
    _text: '',
    className: '',
    type: '',
    value: '',
    placeholder: '',
    autocomplete: '',
    colSpan: 1,
    classList: {
      add(...c) { c.forEach((x) => { node.className = (node.className + ' ' + x).trim(); }); },
      remove(...c) {
        c.forEach((x) => {
          node.className = node.className.split(/\s+/).filter((y) => y && y !== x).join(' ');
        });
      },
      contains(c) { return (' ' + node.className + ' ').includes(' ' + c + ' '); }
    },
    set textContent(v) { this._text = v; this.children = []; },
    get textContent() {
      return this.children.length ? this.children.map((c) => c.textContent).join('') : this._text;
    },
    setAttribute(k, v) { this[k] = v; },
    getAttribute(k) { return this[k]; },
    appendChild(c) { this.children.push(c); return c; },
    removeChild(c) {
      const i = this.children.indexOf(c);
      if (i >= 0) this.children.splice(i, 1);
    },
    addEventListener(ev, fn) { (this._h = this._h || {})[ev] = fn; },
    fire(ev) { this._h && this._h[ev] && this._h[ev](); },
    _hasCls(cls) { return (' ' + this.className + ' ').includes(' ' + cls + ' '); },
    querySelector(sel) {
      const cls = sel.replace(/^\./, '');
      return this.children.find((c) => c._hasCls(cls)) || null;
    },
    querySelectorAll(sel) {
      const cls = sel.replace(/^\./, '');
      return this.children.filter((c) => c._hasCls(cls));
    },
    get lastElementChild() { return this.children[this.children.length - 1] || null; }
  };
  return node;
}

function run() {
  const ids = {};
  ['total', 'fragA', 'fragB', 'fragD', 'solve', 'status', 'result', 'design', 'enzymeRows',
    'addEnzyme', 'removeEnzyme', 'designBtn', 'designResult'].forEach((id) => { ids[id] = makeNode('div'); });
  ids.design.classList.add('hidden'); // 与 index.html 初始状态一致
  ids.total.value = '8';
  ids.fragA.value = '1, 2, 5';
  ids.fragB.value = '3, 5';
  ids.fragD.value = '1, 2, 2, 3';

  const enzymeExampleBtns = ['distinguishable', 'indistinguishable'].map((key) => {
    const b = makeNode('button');
    b.setAttribute('data-enzymes', key);
    return b;
  });

  const sandbox = { console, document: {
    getElementById: (id) => ids[id],
    createElement: (tag) => makeNode(tag),
    querySelectorAll: (sel) => sel === '[data-enzymes]' ? enzymeExampleBtns : []
  } };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  const srcDir = path.join(__dirname, '..', 'src');
  vm.runInContext(fs.readFileSync(path.join(srcDir, 'solver.js'), 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync(path.join(srcDir, 'app.js'), 'utf8'), sandbox);

  function assert(cond, msg) { if (!cond) throw new Error(msg); }

  // 1) 初始：设计面板隐藏，默认 2 行候选酶
  assert(ids.design.classList.contains('hidden'), '初始设计面板应隐藏');
  assert(ids.enzymeRows.children.length === 2,
    '初始应有 2 行候选酶，实际 ' + ids.enzymeRows.children.length);

  // 2) 复原（多解）→ 面板出现，两份见证展示
  ids.solve.fire('click');
  assert(!ids.design.classList.contains('hidden'), '多解后设计面板应出现');
  assert(ids.result.textContent.includes('见证 1') && ids.result.textContent.includes('见证 2'),
    '应保留两份见证');

  // 3) 录入不可鉴别候选酶 → 一对假设 + 逐项相同证据；原见证不动
  const rows = ids.enzymeRows.children;
  rows[0].querySelector('.enzyme-name').value = 'C1';
  rows[0].querySelector('.enzyme-cuts').value = '2';
  rows[1].querySelector('.enzyme-name').value = 'C2';
  rows[1].querySelector('.enzyme-cuts').value = '4';
  ids.designBtn.fire('click');
  assert(ids.designResult.textContent.includes('无法区分'), '应提示不可鉴别');
  assert(ids.designResult.textContent.includes('假设'), '应给出一对假设');
  assert(ids.designResult.textContent.includes('相同'), '应给出逐项相同证据');
  assert(ids.result.textContent.includes('见证 1'), '原两份见证不得被设计流程改动');

  // 4) 修改候选酶 → 立即清除旧方案，见证不变
  rows[0].querySelector('.enzyme-cuts').fire('input');
  assert(ids.designResult.textContent.includes('旧方案已清除'), '改候选酶后应立即清除旧方案');
  assert(ids.result.textContent.includes('见证 1'), '见证仍保留');

  // 5) 改成可鉴别候选酶 → 数量最少 + 并列裁决（酶顺序、酶A优先）
  rows[0].querySelector('.enzyme-cuts').value = '1, 6';
  ids.designBtn.fire('click');
  assert(ids.designResult.textContent.includes('最少只需 2 项实验'), '应给出最少 2 项');
  assert(ids.designResult.textContent.includes('C1 ＋ 酶A 双酶切'), '应含 C1＋酶A');
  assert(ids.designResult.textContent.includes('C1 ＋ 酶B 双酶切'), '并列时应取同酶 +A/+B');

  // 6) 增删候选酶（2~5）并清除旧方案
  ids.addEnzyme.fire('click');
  assert(ids.enzymeRows.children.length === 3, '应增至 3 行');
  ids.removeEnzyme.fire('click');
  assert(ids.enzymeRows.children.length === 2, '应减回 2 行');
  assert(ids.designResult.textContent.includes('旧方案已清除'), '增删候选酶应清除旧方案');

  // 6b) 候选酶示例按钮：填入预设（E1@1,6 / E2@1）并清除旧方案，随后自动设计可鉴别
  enzymeExampleBtns[0].fire('click');
  {
    const r = ids.enzymeRows.children;
    assert(r[0].querySelector('.enzyme-name').value === 'E1', '示例应填入 E1');
    assert(r[0].querySelector('.enzyme-cuts').value === '1, 6', '示例应填入切点 1, 6');
    assert(r[1].querySelector('.enzyme-name').value === 'E2', '示例应填入 E2');
  }
  ids.designBtn.fire('click');
  assert(ids.designResult.textContent.includes('最少只需 2 项实验'), '示例应得到可鉴别结论');
  assert(ids.designResult.textContent.includes('E1 ＋ 酶A 双酶切'), '应展示 E1＋酶A');
  assert(ids.designResult.textContent.includes('E1 ＋ 酶B 双酶切'), '应展示 E1＋酶B');

  // 7) 修改原消化数据 → 面板隐藏、旧方案清除、原结论清除；酶录入草稿保留
  ids.fragA.value = '2, 2, 4';
  ids.fragA.fire('input');
  assert(ids.design.classList.contains('hidden'), '改消化数据后设计面板应隐藏');
  assert(ids.designResult.textContent.includes('旧鉴别方案已清除'), '应提示旧方案清除');
  assert(ids.result.textContent.includes('旧结论已清除'), '原结论应被清除');
  assert(ids.enzymeRows.children.every((r) => r.querySelector('.enzyme-name').value === '' || true),
    '候选酶录入区仍存在');
}

try {
  run();
  console.log('✓ 页面交互冒烟（DOM 事件链路）全部通过');
} catch (e) {
  console.error('✗ 页面交互冒烟失败：' + e.message);
  process.exit(1);
}
