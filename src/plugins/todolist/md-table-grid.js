// 🆕 Markdown 表格「网格编辑器」共用引擎（主窗体 #tlAddCheckOverlay 与便利贴 #addCheckOv 都吃这一份）
//
// ⚠️ LITE（src/pwa-md-editor/md-table-grid.js）是逐字镜像：PWA 独立部署、不能跨目录加载，
//    改动这里的解析／序列化／结构性操作后必须同步过去（两边只差文件头这段说明）。
//
// 为什么抽成共用档：两个窗体各自的浮层 markup／配色不同，但表格的解析、序列化、增删行列与
// 「什么该重绘」的口径必须完全一致，否则会出现「桌面改好、便利贴还是旧的」这种双端不同步。
//
// 三条硬契约（改这里前先看 /tmp/table-grid-harness.js 钉住的断言）：
//  1. 网格只是那块 textarea 的「另一层视图」：任何格子改动都即时序列化回 textarea，
//     落盘仍由各窗体既有的「按区块 start..end 区间回写备注」路径负责，这里绝不写第二条存档分支。
//  2. 单元格输入过程中绝不重绘网格（重绘会抢走光标、打断打字）；只有结构性操作才重绘。
//  3. 使用者没动过就不改写原文：enter() 只解析、不序列化，所以「打开后直接 ⌘S」＝原文原样保存。
//     反向不变量：serialize(parse(x)) 再 parse 必须得同一模型，且区块切分器仍认它是「一个 table」。
(function (global) {
  'use strict';

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // 拆一行表格：去掉首尾的 |，按「未转义的 |」切格并解开 \|。不用 lookbehind（正则回扫更稳）。
  function splitCells(line) {
    let s = String(line == null ? '' : line).trim();
    if (s.charAt(0) === '|') s = s.slice(1);
    if (s.length && s.charAt(s.length - 1) === '|' && s.charAt(s.length - 2) !== '\\') s = s.slice(0, -1);
    const cells = [];
    let cur = '';
    for (let i = 0; i < s.length; i++) {
      const c = s.charAt(i);
      if (c === '\\' && s.charAt(i + 1) === '|') { cur += '|'; i++; continue; }
      if (c === '|') { cells.push(cur.trim()); cur = ''; continue; }
      cur += c;
    }
    cells.push(cur.trim());
    return cells;
  }

  // 认不出表格就回传 null（让上层退回原文视图，绝不硬猜）
  function parseMd(text) {
    const lines = String(text == null ? '' : text).replace(/\r\n/g, '\n').split('\n')
      .map((l) => l.trim()).filter((l) => l.length);
    if (lines.length < 2) return null;
    if (lines[0].indexOf('|') < 0) return null;
    const d = lines[1];
    if (!/^[\s|:-]+$/.test(d) || d.indexOf('-') < 0 || d.indexOf('|') < 0) return null;
    const alignRaw = splitCells(d);
    const cols = Math.max(splitCells(lines[0]).length, alignRaw.length);
    if (!cols) return null;
    const padTo = (arr) => { const a = arr.slice(); while (a.length < cols) a.push(''); return a.slice(0, cols); };
    const aligns = [];
    for (let i = 0; i < cols; i++) {
      const c = alignRaw[i] || '';
      const left = c.charAt(0) === ':';
      const right = c.length > 1 && c.charAt(c.length - 1) === ':';
      aligns.push(left && right ? 'center' : right ? 'right' : left ? 'left' : 'none');
    }
    return { aligns, header: padTo(splitCells(lines[0])), rows: lines.slice(2).map((l) => padTo(splitCells(l))) };
  }

  function serialize(m) {
    const cell = (v) => {
      const t = String(v == null ? '' : v).replace(/[\r\n]+/g, ' ').replace(/\|/g, '\\|').trim();
      return t || ' ';
    };
    const row = (arr) => '| ' + arr.map(cell).join(' | ') + ' |';
    const dash = (a) => (a === 'center' ? ':---:' : a === 'right' ? '---:' : a === 'left' ? ':---' : '---');
    return [row(m.header), '| ' + m.aligns.map(dash).join(' | ') + ' |'].concat(m.rows.map(row)).join('\n');
  }

  function newModel(rows, cols) {
    const n = Math.max(1, Math.min(12, cols | 0));
    const m = Math.max(0, Math.min(50, rows | 0));
    return {
      aligns: Array.apply(null, Array(n)).map(() => 'none'),
      header: Array.apply(null, Array(n)).map(() => ''),
      rows: Array.apply(null, Array(m)).map(() => Array.apply(null, Array(n)).map(() => ''))
    };
  }

  // opts：各窗体把自己的节点与差异交进来
  //   textarea  区块原文输入框（网格的输出目标）
  //   grid      整块表格模式的容器（显示／隐藏）
  //   scroll    生成 <table> 的挂载点
  //   controls  { rows, cols, build, addRow, delRow, addCol, delCol, toggle }（缺节点则该功能静默不生效）
  //   setWide   (on:boolean)=>void  进入／离开表格模式时调整浮层宽度（两端宽度算法不同，交给窗体）
  //   onSave / onClose  格子里的 ⌘S 与 Esc 走哪条路（不传＝不绑，由窗体自己的既有快捷键处理）
  function createGrid(opts) {
    const o = opts || {};
    const ctl = o.controls || {};
    const labels = o.labels || {};
    const labelToRaw = labels.toRaw || '改 Markdown 原文';
    const labelToGrid = labels.toGrid || '回到网格';
    let model = null;
    let rawView = false;
    let bound = false;

    const syncTextarea = () => { if (o.textarea && model) o.textarea.value = serialize(model); };
    const showGrid = (on) => {
      if (o.grid) o.grid.style.display = on ? '' : 'none';
      if (o.textarea) o.textarea.style.display = on ? 'none' : '';
      if (ctl.toggle) ctl.toggle.textContent = on ? labelToRaw : labelToGrid;
    };
    // 契约 2：只有结构性操作会走到这里重绘
    const render = () => {
      if (!o.scroll || !model) return;
      const th = model.header.map((v, c) => '<th><input type="text" class="md-tg-cell md-tg-head" data-r="-1" data-c="' + c + '" value="' + escapeHtml(v) + '" placeholder="列名"></th>').join('');
      const body = model.rows.map((r, ri) => '<tr>' + r.map((v, c) =>
        '<td><input type="text" class="md-tg-cell" data-r="' + ri + '" data-c="' + c + '" value="' + escapeHtml(v) + '"></td>').join('') + '</tr>').join('');
      o.scroll.innerHTML = '<table class="md-tg-table"><thead><tr>' + th + '</tr></thead><tbody>' + body + '</tbody></table>';
    };
    const struct = (fn) => {
      if (!model) return;
      fn(model);
      syncTextarea();
      render();
    };
    const buildBlank = () => {
      const r = ctl.rows ? parseInt(ctl.rows.value, 10) : NaN;
      const c = ctl.cols ? parseInt(ctl.cols.value, 10) : NaN;
      model = newModel(isNaN(r) ? 3 : r, isNaN(c) ? 3 : c);
      rawView = false;
      showGrid(true);
      render();
      syncTextarea();
    };

    function bind() {
      if (bound || !ctl.build) return;
      bound = true;
      ctl.build.onclick = buildBlank;
      if (ctl.addRow) ctl.addRow.onclick = () => struct((m) => { if (m.rows.length < 50) m.rows.push(m.aligns.map(() => '')); });
      if (ctl.delRow) ctl.delRow.onclick = () => struct((m) => { m.rows.pop(); });
      if (ctl.addCol) ctl.addCol.onclick = () => struct((m) => {
        if (m.aligns.length >= 12) return;
        m.aligns.push('none'); m.header.push(''); m.rows.forEach((r) => r.push(''));
      });
      if (ctl.delCol) ctl.delCol.onclick = () => struct((m) => {
        if (m.aligns.length <= 1) return;
        m.aligns.pop(); m.header.pop(); m.rows.forEach((r) => r.pop());
      });
      if (ctl.toggle) ctl.toggle.onclick = () => {
        if (!model) return;
        if (rawView) {
          // 从原文切回网格：重新解析使用者手改的 markdown，解析失败就留在原文并说明
          const m = parseMd(o.textarea ? o.textarea.value : '');
          if (!m) { if (o.toast) o.toast(labels.invalidTable || '这段 Markdown 不是合法表格（需要表头行＋分隔行），请先修正', 'danger'); return; }
          model = m;
          rawView = false;
          showGrid(true);
          render();
        } else {
          syncTextarea();
          rawView = true;
          showGrid(false);
        }
      };
      // 单元格 input 只更新模型＋同步 textarea，绝不 render()
      if (o.scroll && !o.scroll._cellBound) {
        o.scroll._cellBound = true;
        o.scroll.addEventListener('input', (e) => {
          const el = e.target;
          if (!el || !el.classList || !el.classList.contains('md-tg-cell')) return;
          const r = parseInt(el.dataset.r, 10), c = parseInt(el.dataset.c, 10);
          if (!model || isNaN(r) || isNaN(c)) return;
          if (r < 0) model.header[c] = el.value; else if (model.rows[r]) model.rows[r][c] = el.value;
          syncTextarea();
        });
      }
      // 格子／工具列里的快捷键：⌘S 落盘、Esc 关闭（窗体没给 hook 就不绑，交给它自己的快捷键口径）
      if (o.grid && (o.onSave || o.onClose)) {
        o.grid.addEventListener('keydown', (e) => {
          if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 's' || e.key === 'S')) {
            e.preventDefault(); e.stopPropagation();
            if (o.onSave) o.onSave();
            return;
          }
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (o.onClose) o.onClose(); return; }
          if (e.key === 'Enter' && (e.target === ctl.rows || e.target === ctl.cols)) {
            e.preventDefault(); buildBlank();
          }
        });
      }
    }

    function enter(src) {
      const m = parseMd(src);
      if (!m) { model = null; rawView = false; showGrid(false); return false; }
      model = m;
      rawView = false;
      showGrid(true);
      render();
      if (o.setWide) o.setWide(true);
      return true;
    }
    // 从零建一张空白表（不经过原文）：给「加入表格」这类没有既有区块可解析的入口用
    function enterBlank(rows, cols) {
      model = newModel(isNaN(rows) ? 3 : rows, isNaN(cols) ? 3 : cols);
      rawView = false;
      showGrid(true);
      render();
      syncTextarea();
      if (o.setWide) o.setWide(true);
      return true;
    }
    function exit() {
      model = null;
      rawView = false;
      showGrid(false);
      if (o.setWide) o.setWide(false);
    }

    return {
      bind, enter, enterBlank, exit, buildBlank,
      isGridVisible: () => !!model && !rawView,
      focusFirstCell: () => {
        const first = o.scroll && o.scroll.querySelector('input');
        if (first) setTimeout(() => first.focus(), 0);
        return !!first;
      },
      getState: () => ({ model, rawView })
    };
  }

  global.MdTableGrid = { splitCells, parseMd, serialize, newModel, createGrid, escapeHtml };
})(typeof window !== 'undefined' ? window : this);
