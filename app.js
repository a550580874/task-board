'use strict';

/* ================= 工具 ================= */
const $ = (sel, root = document) => root.querySelector(sel);
const LS_KEY = 'taskboard.v1';
const PALETTE = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#f43f5e',
  '#8b5cf6', '#ec4899', '#14b8a6', '#64748b', '#d97706'];
const MIN_W = 280, MAX_W = 1600, MIN_H = 160, MAX_H = 2400;

const uid = () => (window.crypto && crypto.randomUUID)
  ? crypto.randomUUID()
  : 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* 按 '-' 把一行文本拆成多列展示 */
function parseSegments(text) {
  return String(text ?? '').split('-').map(s => s.trim());
}

/* ================= 层级(子任务)辅助 ================= */

/* parentId -> [直接子任务] */
function childrenMapOf(tasks) {
  const m = new Map();
  tasks.forEach(t => {
    const p = t.parentId || null;
    if (!m.has(p)) m.set(p, []);
    m.get(p).push(t);
  });
  return m;
}

/* 某任务及其全部子孙的 id 列表(含自身) */
function subtreeIds(tasks, root) {
  const m = childrenMapOf(tasks);
  const out = [];
  (function collect(t) {
    out.push(t.id);
    (m.get(t.id) || []).forEach(collect);
  })(root);
  return out;
}

/*
 * 每个任务的汇总信息:
 * - 叶子:progress/done 用自身
 * - 父节点:progress = 直接子任务均值(递归),done = 全部子任务完成,size = 子树规模
 */
function aggregateMap(tasks) {
  const m = childrenMapOf(tasks);
  const memo = new Map();
  const info = (t) => {
    if (memo.has(t.id)) return memo.get(t.id);
    const kids = m.get(t.id) || [];
    let r;
    if (!kids.length) {
      r = { progress: t.done ? 100 : t.progress, done: t.done, hasKids: false, size: 1 };
    } else {
      let p = 0, done = true, size = 1;
      kids.forEach(k => {
        const a = info(k);
        p += a.progress;
        if (!a.done) done = false;
        size += a.size;
      });
      r = { progress: Math.round(p / kids.length), done, hasKids: true, size };
    }
    memo.set(t.id, r);
    return r;
  };
  tasks.forEach(info);
  return memo;
}

/* 把任意顺序/孤儿/循环引用整理成合法的 DFS 扁平顺序(父任务紧跟其子树) */
function flattenDFS(tasks) {
  const ids = new Set(tasks.map(t => t.id));
  tasks.forEach(t => { if (t.parentId && !ids.has(t.parentId)) t.parentId = null; });
  const byParent = new Map();
  tasks.forEach(t => {
    const p = t.parentId || null;
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p).push(t);
  });
  const out = [], seen = new Set();
  (function walk(p) {
    (byParent.get(p) || []).forEach(t => {
      if (seen.has(t.id)) return;
      seen.add(t.id);
      out.push(t);
      walk(t.id);
    });
  })(null);
  tasks.forEach(t => { // 兜底:循环引用等遗漏任务置为顶层
    if (!seen.has(t.id)) { t.parentId = null; out.push(t); seen.add(t.id); }
  });
  return out;
}

/* 分块统计(按顶层任务口径) */
function boardStats(b) {
  const roots = b.tasks.filter(t => !t.parentId);
  if (!roots.length) return { total: 0, done: 0, avg: 0 };
  const am = aggregateMap(b.tasks);
  let done = 0, sum = 0;
  roots.forEach(t => {
    const a = am.get(t.id);
    if (a.done) done++;
    sum += a.progress;
  });
  return { total: roots.length, done, avg: Math.round(sum / roots.length) };
}

/* ================= 数据 ================= */
function sampleBoards() {
  const p1 = uid(), p1a = uid(), p1b = uid(), p4 = uid(), p4a = uid();
  return [
    {
      title: '执行中', color: 0, collapsed: false, headers: ['任务', '负责人', '备注'],
      tasks: [
        { id: p1, parentId: null, text: 'codex 模块重构 - 张三 - 前端', progress: 40, done: false },
        { id: p1a, parentId: p1, text: '拆分解析器 - 张三', progress: 30, done: false },
        { id: p1b, parentId: p1, text: '单元测试补全 - 李四', progress: 50, done: false },
        { id: uid(), parentId: null, text: '登录页样式修复 - 李四', progress: 70, done: false },
      ],
    },
    {
      title: '跟踪中', color: 1, collapsed: false, headers: ['任务', '负责人', '备注'],
      tasks: [
        { id: p4, parentId: null, text: '性能优化专项 - 张三 - trace 分析', progress: 55, done: false },
        { id: p4a, parentId: p4, text: 'trace 数据采集 - 王五', progress: 80, done: false },
        { id: uid(), parentId: null, text: '数据迁移验证 - 李四', progress: 20, done: false },
      ],
    },
  ];
}

function normalizeBoards(arr) {
  return (Array.isArray(arr) ? arr : []).map((b, i) => ({
    id: String(b.id || uid()),
    title: String(b.title || '未命名分块'),
    color: Number.isInteger(b.color) ? b.color : i,
    collapsed: !!b.collapsed,
    w: (Number.isFinite(+b.w) && +b.w >= MIN_W) ? Math.round(+b.w) : null,
    h: (Number.isFinite(+b.h) && +b.h >= MIN_H) ? Math.round(+b.h) : null,
    x: Number.isFinite(+b.x) ? Math.round(+b.x) : null,
    y: Number.isFinite(+b.y) ? Math.round(+b.y) : null,
    headers: (Array.isArray(b.headers) && b.headers.length === 3)
      ? b.headers.map(h => String(h)) : ['任务', '负责人', '备注'],
    tasks: flattenDFS((Array.isArray(b.tasks) ? b.tasks : []).map(t => ({
      id: String(t.id || uid()),
      parentId: t.parentId ? String(t.parentId) : null,
      text: String(t.text ?? ''),
      progress: clamp(Math.round(Number(t.progress) || 0), 0, 100),
      done: !!t.done,
      collapsed: !!t.collapsed,
    }))),
  }));
}

function loadState() {
  const fallbackTheme = (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches)
    ? 'dark' : 'light';
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && Array.isArray(s.boards)) {
        return {
          version: 1,
          theme: (s.theme === 'dark' || s.theme === 'light') ? s.theme : fallbackTheme,
          boards: normalizeBoards(s.boards),
        };
      }
    }
  } catch (e) { /* 数据损坏则使用示例数据 */ }
  return { version: 1, theme: fallbackTheme, boards: normalizeBoards(sampleBoards()) };
}

function saveState() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) { /* 忽略写入失败 */ }
}

let state = loadState();
saveState();
let dragData = null;

/* ================= 联想(输入自动补全) ================= */
function buildIndex() {
  const m = new Map();
  state.boards.forEach(b => b.tasks.forEach(t => {
    parseSegments(t.text).forEach(s => {
      s = s.trim();
      if (s) m.set(s, (m.get(s) || 0) + 1);
    });
  }));
  return m;
}

function suggestFor(q, n) {
  const idx = buildIndex();
  const ql = q.toLowerCase();
  const starts = [], incl = [];
  for (const [v, c] of idx) {
    const lv = v.toLowerCase();
    if (lv === ql) continue;
    if (lv.startsWith(ql)) starts.push({ value: v, count: c });
    else if (lv.includes(ql)) incl.push({ value: v, count: c });
  }
  const byRank = (a, b) => b.count - a.count || a.value.localeCompare(b.value);
  starts.sort(byRank);
  incl.sort(byRank);
  return starts.concat(incl).slice(0, n);
}

/* 光标所在片段(以 '-' 为分隔) */
function segmentSpan(value, caret) {
  let start = 0, end = value.length;
  for (let i = caret - 1; i >= 0; i--) { if (value[i] === '-') { start = i + 1; break; } }
  for (let i = caret; i < value.length; i++) { if (value[i] === '-') { end = i; break; } }
  return [start, end];
}
function currentSegment(input) {
  const v = input.value;
  return v.slice(...segmentSpan(v, input.selectionStart ?? v.length));
}
function replaceSegment(input, val) {
  const v = input.value;
  const [start, end] = segmentSpan(v, input.selectionStart ?? v.length);
  input.value = v.slice(0, start) + val + v.slice(end);
  input.setSelectionRange(start + val.length, start + val.length);
  input.dispatchEvent(new Event('input'));
}

function hi(value, q) {
  const i = value.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return esc(value);
  return esc(value.slice(0, i)) + '<b>' + esc(value.slice(i, i + q.length)) + '</b>'
    + esc(value.slice(i + q.length));
}

/*
 * 通用单行编辑器绑定:
 * - 输入时按光标所在列联想已有内容,Tab 确认,↑↓ 切换
 * - Enter 提交(commit),Esc 先关联想、再取消(cancel)
 */
function bindLineEditor(input, sug, opts) {
  let items = [], active = -1, settled = false;

  const close = () => { items = []; active = -1; sug.innerHTML = ''; sug.classList.remove('open'); };
  const paintActive = () => {
    [...sug.children].forEach((li, i) => li.classList.toggle('on', i === active));
  };

  const refresh = () => {
    const q = currentSegment(input).trim();
    if (!q) { close(); return; }
    items = suggestFor(q, 6);
    if (!items.length) { close(); return; }
    active = 0;
    sug.innerHTML = items.map((it, i) =>
      `<li class="${i === active ? 'on' : ''}">${hi(it.value, q)}</li>`).join('');
    sug.classList.add('open');
  };

  const accept = (idx = active) => {
    if (!items.length) return;
    const it = items[clamp(idx, 0, items.length - 1)];
    replaceSegment(input, it.value);
    close();
  };

  sug.addEventListener('mousedown', (e) => {
    e.preventDefault(); // 防止输入框失焦
    const li = e.target.closest('li');
    if (li) accept([...sug.children].indexOf(li));
  });

  input.addEventListener('input', refresh);

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && items.length) { e.preventDefault(); accept(); return; }
    if (e.key === 'ArrowDown' && items.length) {
      e.preventDefault(); active = (active + 1) % items.length; paintActive(); return;
    }
    if (e.key === 'ArrowUp' && items.length) {
      e.preventDefault(); active = (active - 1 + items.length) % items.length; paintActive(); return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      if (items.length) { close(); return; }
      opts.cancel && opts.cancel();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (settled) return;
      settled = true;
      close();
      opts.commit(input.value);
    }
  });

  input.addEventListener('blur', () => {
    close();
    if (settled || opts.commitOnBlur === false) return;
    settled = true;
    opts.commit(input.value);
  });
}

/* ================= 渲染 ================= */
function render() {
  document.documentElement.dataset.theme = state.theme;
  // 旧数据迁移:分块还没有坐标时,自动平铺成整齐的行
  if (state.boards.some(b => b.x == null || b.y == null)) { autoLayout(); saveState(); }

  let totalTop = 0, doneTop = 0, subs = 0, sum = 0, cnt = 0;
  state.boards.forEach(b => {
    const s = boardStats(b);
    totalTop += s.total;
    doneTop += s.done;
    subs += b.tasks.length - s.total;
    if (s.total) { sum += s.avg * s.total; cnt += s.total; }
  });
  $('#stat-boards').textContent = state.boards.length;
  $('#stat-tasks').textContent = totalTop;
  $('#stat-subs').textContent = subs;
  $('#stat-done').textContent = doneTop;
  $('#stat-progress').textContent = (cnt ? Math.round(sum / cnt) : 0) + '%';

  const root = $('#boards');
  root.innerHTML = '';
  if (!state.boards.length) {
    const tip = document.createElement('div');
    tip.className = 'empty-tip';
    tip.textContent = '还没有分块,点击右上角「＋ 分块」创建一个吧';
    root.appendChild(tip);
    return;
  }
  state.boards.forEach(b => root.appendChild(renderBoard(b)));

  // 白板式布局:容器高度由最靠下的分块决定
  const maxBottom = state.boards.reduce((m, b) => Math.max(m, (b.y || 0) + (b.h || 420)), 0);
  root.style.minHeight = (maxBottom + 24) + 'px';
}

function renderBoard(b) {
  const el = document.createElement('section');
  el.className = 'board';
  el.dataset.id = b.id;
  el.style.setProperty('--accent', PALETTE[((b.color % PALETTE.length) + PALETTE.length) % PALETTE.length]);
  el.style.left = (b.x || 0) + 'px';
  el.style.top = (b.y || 0) + 'px';
  el.style.width = (b.w || 360) + 'px';
  if (b.h) { el.style.height = b.h + 'px'; el.classList.add('fixed-h'); }

  const s = boardStats(b);

  const head = document.createElement('div');
  head.className = 'board-head';
  head.innerHTML = `
    <button class="icon-btn grip" title="拖动自由摆放;双击自动整理">⠿</button>
    <h2 class="board-title" title="点击重命名">${esc(b.title)}</h2>
    <span class="count">${s.done}/${s.total}</span>
    <div class="mini-prog" title="分块平均进度"><div class="mini-fill" style="width:${s.avg}%"></div></div>
    <span class="pct">${s.avg}%</span>
    <button class="icon-btn" data-act="collapse" title="折叠/展开">${b.collapsed ? '▸' : '▾'}</button>
    <button class="icon-btn danger reveal" data-act="del" title="删除分块">✕</button>`;

  const titleEl = $('.board-title', head);
  titleEl.addEventListener('click', () =>
    startInlineEdit(titleEl, b.title, v => { b.title = v; saveState(); }));

  head.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'collapse') { b.collapsed = !b.collapsed; saveState(); render(); }
    else if (act === 'del') {
      if (confirm(`删除分块「${b.title}」及其 ${b.tasks.length} 个任务?`)) {
        state.boards = state.boards.filter(x => x.id !== b.id);
        saveState(); render();
      }
    }
  });
  el.appendChild(head);

  /* 抓手:指针拖动,自由摆放(坐标存在分块上,松手即固定) */
  const grip = $('.grip', head);
  bindBoardDrag(el, b, grip);

  /* 右缘/下缘/右下角拖动调大小,双击还原 */
  const rzE = document.createElement('div');
  rzE.className = 'rz rz-e';
  rzE.title = '左右拖动调宽度;双击还原';
  const rzS = document.createElement('div');
  rzS.className = 'rz rz-s';
  rzS.title = '上下拖动调高度;双击还原';
  const rzSE = document.createElement('div');
  rzSE.className = 'rz rz-se';
  rzSE.title = '拖动调宽高;双击还原';
  bindResize(el, b, rzE, 'e');
  bindResize(el, b, rzS, 's');
  bindResize(el, b, rzSE, 'se');
  el.append(rzE, rzS, rzSE);

  if (!b.collapsed) {
    const cols = document.createElement('div');
    cols.className = 'cols';
    for (let c = 0; c < 3; c++) {
      const h = document.createElement('span');
      h.className = 'col-h';
      h.textContent = b.headers[c] || '';
      h.title = '点击修改列名';
      h.addEventListener('click', () =>
        startInlineEdit(h, b.headers[c], v => { b.headers[c] = v; saveState(); }));
      cols.appendChild(h);
    }
    el.appendChild(cols);

    const list = document.createElement('div');
    list.className = 'task-list';
    appendTaskRows(list, b);
    if (!b.tasks.length) {
      const tip = document.createElement('div');
      tip.className = 'empty';
      tip.textContent = '暂无任务,在下方输入添加';
      list.appendChild(tip);
    }

    list.addEventListener('dragover', (e) => {
      if (!dragData || dragData.type !== 'task') return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      list.classList.add('drop-target');
    });
    list.addEventListener('dragleave', (e) => {
      if (!list.contains(e.relatedTarget)) list.classList.remove('drop-target');
    });
    list.addEventListener('drop', (e) => handleTaskDrop(e, list, b));

    el.appendChild(list);
    el.appendChild(renderAddRow(b));
  }
  return el;
}

/* 按层级顺序渲染任务行,自动编号 1 / 1.1 / 1.1.1,支持折叠跳过子树 */
function appendTaskRows(listEl, board) {
  const tasks = board.tasks;
  const kidsMap = childrenMapOf(tasks);
  const am = aggregateMap(tasks);
  const stack = []; // 每层一个计数帧 {parentId, n}
  let i = 0;
  while (i < tasks.length) {
    const t = tasks[i];
    const pid = t.parentId || null;
    while (stack.length && stack[stack.length - 1].parentId !== pid) stack.pop();
    if (!stack.length) stack.push({ parentId: pid, n: 0 });
    stack[stack.length - 1].n += 1;
    const depth = stack.length - 1;
    const num = stack.map(f => f.n).join('.');
    const agg = am.get(t.id);
    const kids = kidsMap.get(t.id) || [];
    listEl.appendChild(renderTask(board, t, { depth, num, agg, kids }));
    i += 1;
    if (t.collapsed && agg.hasKids) i += agg.size - 1; // 折叠:整棵子树跳过
    stack.push({ parentId: t.id, n: 0 });
  }
}

function renderTask(board, task, meta) {
  const { depth, num, agg, kids } = meta;
  const row = document.createElement('div');
  row.className = 'task' + (agg.done ? ' done' : '');
  row.dataset.id = task.id;
  row.draggable = true;
  row.style.setProperty('--indent', (depth * 16) + 'px');

  const seg = parseSegments(task.text);
  const c1 = seg[0] || '';
  const c2 = seg[1] || '';
  const c3 = seg.length > 3 ? seg.slice(2).join(' - ') : (seg[2] || '');
  const p = agg.progress;

  row.innerHTML = `
    ${kids.length
      ? `<button class="caret" title="${task.collapsed ? '展开' : '折叠'}子任务">${task.collapsed ? '▸' : '▾'}</button>`
      : '<span class="caret-spacer"></span>'}
    <input type="checkbox" class="chk" ${agg.done ? 'checked' : ''}
      title="${agg.hasKids ? '全部完成 / 取消所有子任务' : '标记完成'}">
    <div class="cells" title="${esc(task.text)}">
      <span class="cell c1"><span class="num">${esc(num)}</span>${esc(c1)}</span>
      <span class="cell c2">${esc(c2)}</span>
      <span class="cell c3">${esc(c3)}</span>
    </div>
    <div class="prog${agg.hasKids ? ' readonly' : ''}"
      title="${agg.hasKids ? '由子任务汇总' : p + '%(点击或拖动设置)'}">
      <div class="prog-fill" style="width:${p}%"></div>
    </div>
    <span class="prog-label">${p}%</span>
    <button class="icon-btn act add-sub" title="添加子任务">＋</button>
    <button class="icon-btn danger act del-task" title="删除任务">✕</button>`;

  const caretBtn = $('.caret', row);
  if (caretBtn) caretBtn.addEventListener('click', () => {
    task.collapsed = !task.collapsed;
    saveState(); render();
  });

  $('.cells', row).addEventListener('click', () => startEditTask(board, task, row));

  $('.chk', row).addEventListener('change', (e) => {
    const val = e.target.checked;
    const set = new Set(subtreeIds(board.tasks, task));
    board.tasks.forEach(t => {
      if (set.has(t.id)) { t.done = val; if (val) t.progress = 100; }
    });
    saveState(); render();
  });

  const prog = $('.prog', row);
  if (!agg.hasKids) bindProgress(prog, $('.prog-fill', row), $('.prog-label', row), task);

  $('.add-sub', row).addEventListener('click', () => addSubtask(board, task));

  $('.del-task', row).addEventListener('click', () => {
    const ids = subtreeIds(board.tasks, task);
    if (ids.length > 1
      && !confirm(`删除「${c1 || '该任务'}」及其 ${ids.length - 1} 个子任务?`)) return;
    const set = new Set(ids);
    board.tasks = board.tasks.filter(t => !set.has(t.id));
    saveState(); render();
  });

  row.addEventListener('dragstart', (e) => {
    dragData = { type: 'task', boardId: board.id, taskId: task.id };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', task.id);
    requestAnimationFrame(() => row.classList.add('dragging'));
  });
  row.addEventListener('dragend', () => {
    row.classList.remove('dragging');
    dragData = null;
    document.querySelectorAll('.task-list.drop-target')
      .forEach(l => l.classList.remove('drop-target'));
  });

  return row;
}

function renderAddRow(board) {
  const wrap = document.createElement('div');
  wrap.className = 'add-row';
  const input = document.createElement('input');
  input.className = 'add-input';
  input.placeholder = '添加顶层任务:名称 - 负责人 - 备注,回车保存';
  input.spellcheck = false;
  const sug = document.createElement('ul');
  sug.className = 'suggestions';
  wrap.append(input, sug);

  bindLineEditor(input, sug, {
    commitOnBlur: false,
    commit(v) {
      const text = v.trim();
      if (!text) return;
      board.tasks.push({ id: uid(), parentId: null, text, progress: 0, done: false });
      saveState(); render();
      const again = $(`.board[data-id="${board.id}"] .add-input`);
      if (again) again.focus();
    },
    cancel() { input.value = ''; },
  });
  return wrap;
}

/* ================= 交互 ================= */
/* 在任务下新增子任务(自动展开),并直接进入编辑 */
function addSubtask(board, task) {
  task.collapsed = false;
  const tasks = board.tasks;
  const idx = tasks.findIndex(t => t.id === task.id);
  if (idx < 0) return;
  const size = subtreeIds(tasks, task).length;
  const nt = { id: uid(), parentId: task.id, text: '', progress: 0, done: false };
  tasks.splice(idx + size, 0, nt);
  saveState(); render();
  const row = $(`.board[data-id="${board.id}"] .task[data-id="${nt.id}"]`);
  if (row) startEditTask(board, nt, row, true);
}

/* 任务行编辑:整行变为 "A - B - C" 单行输入,回车保存 */
function startEditTask(board, task, rowEl, isNew = false) {
  if (rowEl.querySelector('.line-editor')) return;
  const wrap = document.createElement('div');
  wrap.className = 'edit-wrap';
  const input = document.createElement('input');
  input.className = 'line-editor';
  input.value = task.text;
  input.spellcheck = false;
  const sug = document.createElement('ul');
  sug.className = 'suggestions';
  wrap.append(input, sug);

  rowEl.classList.add('editing');
  rowEl.draggable = false;
  rowEl.replaceChildren(wrap);
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);

  bindLineEditor(input, sug, {
    commit(v) {
      const text = v.trim();
      const i = board.tasks.indexOf(task);
      if (!text) { if (i >= 0) board.tasks.splice(i, 1); } // 清空 = 删除
      else task.text = text;
      saveState(); render();
    },
    cancel() {
      if (isNew && !task.text.trim()) { // 新建子任务按 Esc = 放弃
        const i = board.tasks.indexOf(task);
        if (i >= 0) board.tasks.splice(i, 1);
      }
      saveState(); render();
    },
  });
}

/* 点击/拖动设置进度(仅叶子任务) */
function bindProgress(el, fillEl, labelEl, task) {
  const apply = (clientX) => {
    const r = el.getBoundingClientRect();
    const p = clamp(Math.round(((clientX - r.left) / r.width) * 100), 0, 100);
    task.progress = p;
    task.done = p >= 100;
    fillEl.style.width = p + '%';
    labelEl.textContent = p + '%';
    el.title = p + '%(点击或拖动设置)';
  };
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
    apply(e.clientX);
    const move = (ev) => apply(ev.clientX);
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      saveState(); render();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  });
}

/* 通用小 inline 编辑(分块标题、列名):回车/失焦保存,Esc 取消 */
function startInlineEdit(spanEl, value, onCommit) {
  const input = document.createElement('input');
  input.className = 'inline-editor';
  input.value = value;
  input.spellcheck = false;
  spanEl.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    const v = input.value.trim();
    if (save && v && v !== value) onCommit(v);
    render();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
}

/*
 * 拖放移动(含整棵子树):
 * - 拖到某行上半部分 → 插到该行前面(同级)
 * - 拖到某行下半部分 → 插到该行整棵子树之后(同级)
 * - 拖到列表空白/底部 → 追加为顶层任务
 */
function handleTaskDrop(e, list, b) {
  if (!dragData || dragData.type !== 'task') return;
  e.preventDefault();
  list.classList.remove('drop-target');
  const { boardId, taskId } = dragData;
  dragData = null;

  const from = state.boards.find(x => x.id === boardId);
  if (!from) return;
  const tasks = from.tasks;
  const srcIdx = tasks.findIndex(t => t.id === taskId);
  if (srcIdx < 0) return;
  const root = tasks[srcIdx];
  const movedSet = new Set(subtreeIds(tasks, root));

  const rows = [...list.querySelectorAll('.task')];
  let refTask = null, mode = 'append';
  for (const r of rows) {
    const rect = r.getBoundingClientRect();
    if (e.clientY >= rect.top && e.clientY < rect.bottom) {
      refTask = tasks.find(t => t.id === r.dataset.id);
      mode = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
      break;
    }
  }
  if (!refTask && rows.length) {
    const firstRect = rows[0].getBoundingClientRect();
    if (e.clientY < firstRect.top) {
      refTask = tasks.find(t => t.id === rows[0].dataset.id);
      mode = 'before';
    }
  }
  if (refTask && movedSet.has(refTask.id)) return; // 不能移动进自己的子树

  const moved = tasks.filter(t => movedSet.has(t.id));
  const remaining = tasks.filter(t => !movedSet.has(t.id));

  let target, parentId;
  if (!refTask) {
    target = remaining.length;
    parentId = null;
  } else {
    const refIdx = remaining.findIndex(t => t.id === refTask.id);
    if (refIdx < 0) return;
    parentId = refTask.parentId || null;
    if (mode === 'before') target = refIdx;
    else target = refIdx + subtreeIds(tasks, refTask).length; // 越过整棵子树
  }

  moved[0].parentId = parentId; // 仅根变更层级,子孙保持不变
  remaining.splice(clamp(target, 0, remaining.length), 0, ...moved);
  from.tasks = remaining;
  saveState(); render();
}

/* ================= 分块自由摆放与缩放 ================= */
/* 自动平铺:按当前顺序贪心装行(用于旧数据迁移与双击抓手整理) */
function autoLayout() {
  const GAP = 16, M = 16;
  const cw = Math.max(360, (boardsRoot.clientWidth || 1200) - M * 2);
  let x = M, y = M, rowH = 0;
  state.boards.forEach(b => {
    if (!b.w) b.w = 360;
    if (!b.h) b.h = 420;
    if (x > M && x + b.w > cw + M) { x = M; y += rowH + GAP; rowH = 0; }
    b.x = x; b.y = y;
    x += b.w + GAP;
    rowH = Math.max(rowH, b.h);
  });
}

/* 抓手拖动:自由摆放,坐标实时跟随,松手保存并固定 */
function bindBoardDrag(el, b, grip) {
  grip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX, startY = e.clientY;
    const origX = b.x || 0, origY = b.y || 0;
    let moved = false;
    try { grip.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
    el.classList.add('dragging');
    const move = (ev) => {
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      b.x = Math.max(0, Math.round(origX + dx));
      b.y = Math.max(0, Math.round(origY + dy));
      el.style.left = b.x + 'px';
      el.style.top = b.y + 'px';
    };
    const up = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      el.classList.remove('dragging');
      if (moved) { saveState(); render(); }
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  });
  grip.addEventListener('dblclick', () => {
    autoLayout(); saveState(); render();
  });
}

/* 分块右缘('e')/下缘('s')/右下角('se')拖动调大小 */
const rzLastTap = new Map(); // 双击还原检测:键=分块+边,跨重渲染保留
function bindResize(el, b, handle, mode) {
  const tapKey = (b.id || '') + ':' + mode;
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const now = Date.now();
    if (now - (rzLastTap.get(tapKey) || 0) < 400) { // 双击(两次原地快速点击)→ 还原大小
      rzLastTap.delete(tapKey);
      b.w = null; b.h = null;
      saveState(); render();
      return;
    }
    const startX = e.clientX, startY = e.clientY;
    const rect = el.getBoundingClientRect();
    const startW = rect.width, startH = rect.height;
    let moved = false;
    try { handle.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
    handle.classList.add('active');
    document.body.classList.add('resizing');
    const move = (ev) => {
      if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) > 3) moved = true;
      if (mode !== 's') { // 调宽度
        b.w = clamp(Math.round(startW + ev.clientX - startX), MIN_W, MAX_W);
        el.style.width = b.w + 'px';
        el.style.flex = '0 0 auto';
        el.style.minWidth = '0';
        el.style.maxWidth = 'none';
      }
      if (mode !== 'e') { // 调高度
        b.h = clamp(Math.round(startH + ev.clientY - startY), MIN_H, MAX_H);
        el.style.height = b.h + 'px';
        el.classList.add('fixed-h');
      }
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      handle.classList.remove('active');
      document.body.classList.remove('resizing');
      rzLastTap.set(tapKey, moved ? 0 : now);
      saveState();
      render(); // 松手后立即按保存的状态重渲染,确保尺寸所见即所得
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  });
}

/* ================= 顶栏 ================= */
function addBoard() {
  const maxBottom = state.boards.reduce((m, x) => Math.max(m, (x.y || 0) + (x.h || 420)), 0);
  const b = {
    id: uid(), title: '新分块', color: state.boards.length,
    collapsed: false, headers: ['任务', '负责人', '备注'], tasks: [],
    x: 16, y: state.boards.length ? maxBottom + 16 : 16, w: 360, h: 420,
  };
  state.boards.push(b);
  saveState(); render();
  const t = $(`.board[data-id="${b.id}"] .board-title`);
  if (t) startInlineEdit(t, b.title, v => { b.title = v; saveState(); });
}

$('#btn-add-board').addEventListener('click', addBoard);

$('#btn-theme').addEventListener('click', () => {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  saveState(); render();
});

$('#btn-export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '任务看板-' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  URL.revokeObjectURL(a.href);
});

$('#btn-import').addEventListener('click', () => $('#file-import').click());

$('#file-import').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const s = JSON.parse(await f.text());
    if (!s || !Array.isArray(s.boards)) throw new Error('bad');
    if (!confirm('导入将覆盖当前全部数据,继续?')) return;
    state = { version: 1, theme: state.theme, boards: normalizeBoards(s.boards) };
    saveState(); render();
  } catch (err) {
    alert('导入失败:文件格式不正确');
  }
  e.target.value = '';
});

const boardsRoot = $('#boards');

/* ================= 启动 ================= */
render();
