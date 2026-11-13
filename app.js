import { fixture, validate, schedule, compare, toCSV } from './core.js';
const $ = (id) => document.getElementById(id),
  ns = 'http://www.w3.org/2000/svg';
let tasks = fixture(),
  baseline = null,
  result = null,
  worker = null,
  revision = 0;
const el = (name, text) => {
  const n = document.createElement(name);
  if (text !== undefined) n.textContent = text;
  return n;
};
function status(text) {
  $('status').textContent = text;
}
function invalidate() {
  revision++;
  worker?.terminate();
  worker = null;
  result = null;
  $('results').hidden = true;
  $('finish').textContent = '—';
  $('paths').textContent = '—';
  $('delta').textContent = '—';
  $('report').disabled = true;
}
function compute() {
  invalidate();
  const ticket = revision;
  try {
    validate(tasks);
    const w = new Worker('worker.js', { type: 'module' });
    worker = w;
    status('Tracing dependencies and testing one-unit reductions…');
    w.onmessage = ({ data }) => {
      if (ticket !== revision) return;
      w.terminate();
      worker = null;
      if (data.error) {
        status(data.error);
        return;
      }
      result = data.result;
      render();
      status(
        `${tasks.length} tasks · ${result.work} total work units · unlimited parallel resources.`,
      );
    };
    w.onerror = () => {
      if (ticket === revision) {
        status('The calculation worker failed. Edit a task to retry.');
        w.terminate();
        worker = null;
      }
    };
    w.postMessage(tasks);
  } catch (e) {
    status(e.message);
  }
}
function field(label, value, type = 'text') {
  const wrap = el('label', label),
    input = el('input');
  input.type = type;
  input.value = value;
  wrap.append(input);
  return [wrap, input];
}
function cards() {
  $('cards').replaceChildren();
  for (const task of tasks) {
    const card = el('article');
    card.className = 'card';
    const head = el('div');
    head.className = 'card-head';
    head.append(el('code', task.id));
    const remove = el('button', 'Remove');
    remove.setAttribute('aria-label', `Remove ${task.id}`);
    remove.disabled = tasks.length === 1;
    remove.addEventListener('click', () => {
      const users = tasks.filter((t) => t.depends.includes(task.id));
      if (users.length) {
        status(
          `Remove dependencies on ${task.id} from ${users.map((t) => t.id).join(', ')} first.`,
        );
        return;
      }
      tasks = tasks.filter((t) => t !== task);
      cards();
      compute();
    });
    head.append(remove);
    card.append(head);
    const [lw, li] = field('Task name', task.label);
    li.maxLength = 80;
    li.setAttribute('aria-label', `${task.id} name`);
    li.addEventListener('input', () => {
      task.label = li.value;
      compute();
    });
    card.append(lw);
    const pair = el('div');
    pair.className = 'pair';
    const [dw, di] = field('Duration', task.duration, 'number');
    di.min = '0';
    di.max = '10000';
    di.step = '1';
    di.setAttribute('aria-label', `${task.id} duration`);
    di.addEventListener('input', () => {
      task.duration = di.value.trim() === '' ? NaN : Number(di.value);
      compute();
    });
    const [pw, pi] = field('Depends on', task.depends.join(', '));
    pi.setAttribute('aria-label', `${task.id} dependencies`);
    pi.addEventListener('input', () => {
      task.depends = pi.value.trim() ? pi.value.split(',').map((s) => s.trim()) : [];
      compute();
    });
    pair.append(dw, pw);
    card.append(pair);
    $('cards').append(card);
  }
  $('add').disabled = tasks.length >= 64;
}
function svg(name, attrs, text) {
  const n = document.createElementNS(ns, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  if (text !== undefined) n.textContent = text;
  return n;
}
function render() {
  $('results').hidden = false;
  $('report').disabled = false;
  $('finish').textContent = result.finish;
  $('paths').textContent = result.criticalPathCount;
  $('delta').textContent = baseline
    ? (result.finish - schedule(baseline).finish > 0 ? '+' : '') +
      (result.finish - schedule(baseline).finish)
    : '—';
  $('baseline-note').textContent = baseline
    ? `Baseline finish: ${schedule(baseline).finish}`
    : 'Keep a baseline to compare';
  const root = $('timeline'),
    height = 44 + result.tasks.length * 37;
  root.replaceChildren();
  root.setAttribute('viewBox', `0 0 1100 ${height}`);
  root.setAttribute('height', height);
  const x = (v) => 220 + (v / Math.max(1, result.finish)) * 810;
  for (let i = 0; i <= 5; i++) {
    const value = (result.finish * i) / 5;
    root.append(
      svg('line', { x1: x(value), x2: x(value), y1: 25, y2: height, stroke: '#e6e1d7' }),
      svg(
        'text',
        { x: x(value), y: 14, 'font-size': 11, fill: '#6d7072', 'text-anchor': 'middle' },
        Number(value.toFixed(1)),
      ),
    );
  }
  result.tasks.forEach((t, i) => {
    const y = 44 + i * 37,
      color = t.critical ? '#a34d35' : '#5d7781';
    root.append(
      svg(
        'text',
        { x: 4, y: y + 4, 'font-size': 12, fill: '#34393c' },
        `${t.id} · ${t.label.slice(0, 21)}`,
      ),
    );
    root.append(
      svg('line', {
        x1: x(t.earlyFinish),
        x2: x(t.lateFinish),
        y1: y,
        y2: y,
        stroke: '#a8a193',
        'stroke-dasharray': '3 4',
        'stroke-width': 3,
      }),
    );
    const bar =
      t.duration === 0
        ? svg('path', { d: `M${x(t.earlyStart)} ${y - 6} l6 6 -6 6 -6 -6 Z`, fill: color })
        : svg('rect', {
            x: x(t.earlyStart),
            y: y - 8,
            width: Math.max(0.6, x(t.earlyFinish) - x(t.earlyStart)),
            height: 16,
            rx: 2,
            fill: color,
          });
    bar.append(
      svg('title', {}, `${t.label}: ${t.earlyStart}–${t.earlyFinish}; total float ${t.totalFloat}`),
    );
    root.append(bar);
  });
  $('route').textContent =
    `One critical route: ${result.criticalPath.join(' → ')}. ${result.criticalPathCount} critical route(s) in total.`;
  $('ledger').replaceChildren();
  for (const t of result.tasks) {
    const tr = el('tr');
    if (t.critical) tr.className = 'critical';
    for (const value of [
      t.id,
      `${t.earlyStart} → ${t.earlyFinish}`,
      `${t.lateStart} → ${t.lateFinish}`,
      t.totalFloat,
      t.freeFloat,
      result.sensitivity.find((x) => x.id === t.id).saved,
    ])
      tr.append(el('td', value));
    $('ledger').append(tr);
  }
}
function download(name, data, type = 'application/json') {
  const u = URL.createObjectURL(new Blob([data], { type })),
    a = el('a');
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}
function validProject() {
  try {
    schedule(tasks);
    return true;
  } catch (e) {
    status(e.message);
    return false;
  }
}
$('example').addEventListener('change', () => {
  tasks = fixture($('example').value);
  baseline = null;
  $('reset').disabled = true;
  cards();
  compute();
});
$('add').addEventListener('click', () => {
  if (tasks.length >= 64) return;
  let i = 1;
  while (tasks.some((t) => t.id === `task${i}`)) i++;
  tasks.push({ id: `task${i}`, label: 'New task', duration: 1, depends: [] });
  cards();
  compute();
});
$('baseline').addEventListener('click', () => {
  if (!validProject()) return;
  baseline = structuredClone(tasks);
  $('reset').disabled = false;
  if (result) render();
  status('Comparison baseline saved in this browser session.');
});
$('reset').addEventListener('click', () => {
  if (!baseline) return;
  tasks = structuredClone(baseline);
  cards();
  compute();
});
$('save').addEventListener('click', () => {
  if (validProject()) download('dependency-project.json', JSON.stringify({ tasks }, null, 2));
});
$('csv').addEventListener('click', () => {
  if (result) download('dependency-schedule.csv', toCSV(result), 'text/csv;charset=utf-8');
});
$('report').addEventListener('click', () => {
  if (result)
    download(
      'dependency-analysis.json',
      JSON.stringify({ result, comparison: baseline ? compare(baseline, tasks) : null }, null, 2),
    );
});
$('file').addEventListener('change', async () => {
  const f = $('file').files[0];
  if (!f) return;
  const ticket = ++revision;
  worker?.terminate();
  worker = null;
  try {
    if (f.size > 100000) throw Error('Project files must be at most 100 KB.');
    const value = JSON.parse(await f.text());
    if (!value || Array.isArray(value) || Object.keys(value).join(',') !== 'tasks')
      throw Error('JSON needs a tasks array only.');
    schedule(value.tasks);
    if (ticket !== revision) return;
    tasks = validate(value.tasks);
    baseline = null;
    $('reset').disabled = true;
    cards();
    compute();
  } catch (e) {
    if (ticket === revision) status(`Project rejected: ${e.message}`);
  } finally {
    $('file').value = '';
  }
});
cards();
compute();
