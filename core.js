export function validate(input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 64)
    throw Error('Use 1–64 tasks.');
  const ids = new Set();
  const tasks = input.map((t) => {
    if (
      !t ||
      typeof t !== 'object' ||
      Array.isArray(t) ||
      Object.keys(t).sort().join(',') !== 'depends,duration,id,label'
    )
      throw Error('Each task needs id, label, duration, and depends only.');
    if (typeof t.id !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,23}$/.test(t.id) || ids.has(t.id))
      throw Error('Task IDs must be unique simple names (24 characters maximum).');
    ids.add(t.id);
    if (
      typeof t.label !== 'string' ||
      !t.label.trim() ||
      t.label.length > 80 ||
      /[\x00-\x1f]/.test(t.label)
    )
      throw Error('Task labels need 1–80 printable characters.');
    if (!Number.isSafeInteger(t.duration) || t.duration < 0 || t.duration > 10000)
      throw Error('Durations must be whole units from 0 to 10,000.');
    if (
      !Array.isArray(t.depends) ||
      t.depends.length > 63 ||
      t.depends.some((x) => typeof x !== 'string') ||
      new Set(t.depends).size !== t.depends.length
    )
      throw Error('Dependencies must be distinct task IDs.');
    return { ...t, depends: [...t.depends] };
  });
  for (const t of tasks)
    for (const d of t.depends)
      if (!ids.has(d)) throw Error(`${t.id} depends on missing task ${d}.`);
  return tasks;
}
export function schedule(input) {
  const tasks = validate(input),
    byId = new Map(tasks.map((t) => [t.id, t])),
    marks = new Map(),
    stack = [],
    order = [];
  function visit(id) {
    if (marks.get(id) === 2) return;
    if (marks.get(id) === 1)
      throw Error('Dependency cycle: ' + [...stack.slice(stack.indexOf(id)), id].join(' → '));
    marks.set(id, 1);
    stack.push(id);
    for (const d of byId.get(id).depends) visit(d);
    stack.pop();
    marks.set(id, 2);
    order.push(id);
  }
  for (const t of tasks) visit(t.id);
  const next = new Map(tasks.map((t) => [t.id, []])),
    records = new Map();
  for (const t of tasks) for (const d of t.depends) next.get(d).push(t.id);
  for (const id of order) {
    const t = byId.get(id),
      earlyStart = Math.max(0, ...t.depends.map((d) => records.get(d).earlyFinish));
    records.set(id, { ...t, earlyStart, earlyFinish: earlyStart + t.duration });
  }
  const finish = Math.max(...[...records.values()].map((t) => t.earlyFinish));
  for (const id of [...order].reverse()) {
    const t = records.get(id),
      successors = next.get(id);
    t.lateFinish = successors.length
      ? Math.min(...successors.map((d) => records.get(d).lateStart))
      : finish;
    t.lateStart = t.lateFinish - t.duration;
    t.totalFloat = t.lateStart - t.earlyStart;
    t.freeFloat =
      (successors.length ? Math.min(...successors.map((d) => records.get(d).earlyStart)) : finish) -
      t.earlyFinish;
    t.critical = t.totalFloat === 0;
  }
  const edges = [];
  for (const t of tasks)
    for (const d of t.depends)
      edges.push({
        from: d,
        to: t.id,
        critical:
          records.get(d).critical &&
          records.get(t.id).critical &&
          records.get(d).earlyFinish === records.get(t.id).earlyStart,
      });
  const counts = new Map();
  for (const id of order) {
    const t = records.get(id);
    counts.set(
      id,
      !t.critical
        ? 0n
        : t.depends.length === 0
          ? 1n
          : edges
              .filter((e) => e.to === id && e.critical)
              .reduce((sum, e) => sum + counts.get(e.from), 0n),
    );
  }
  const ends = order.filter((id) => next.get(id).length === 0 && records.get(id).critical),
    pathCount = ends.reduce((sum, id) => sum + counts.get(id), 0n);
  const path = [];
  let cursor = ends[0];
  while (cursor) {
    path.unshift(cursor);
    cursor = edges.find((e) => e.to === cursor && e.critical)?.from;
  }
  return {
    finish,
    order,
    tasks: order.map((id) => records.get(id)),
    edges,
    criticalPath: path,
    criticalPathCount: String(pathCount),
    work: tasks.reduce((sum, t) => sum + t.duration, 0),
  };
}
export function analyze(input) {
  const base = schedule(input);
  const sensitivity = base.tasks.map((t) => {
    const amount = Math.min(1, t.duration),
      changed = input.map((x) => ({
        ...x,
        duration: x.id === t.id ? x.duration - amount : x.duration,
      }));
    const finish = schedule(changed).finish;
    return { id: t.id, reduction: amount, finish, saved: base.finish - finish };
  });
  return { ...base, sensitivity };
}
export function compare(before, after) {
  const a = schedule(before),
    b = schedule(after),
    old = new Map(a.tasks.map((t) => [t.id, t]));
  return {
    before: a.finish,
    after: b.finish,
    delta: b.finish - a.finish,
    tasks: b.tasks.map((t) => ({
      id: t.id,
      startDelta: old.has(t.id) ? t.earlyStart - old.get(t.id).earlyStart : null,
      finishDelta: old.has(t.id) ? t.earlyFinish - old.get(t.id).earlyFinish : null,
    })),
  };
}
export function toCSV(result) {
  const fields = [
    'id',
    'label',
    'duration',
    'earlyStart',
    'earlyFinish',
    'lateStart',
    'lateFinish',
    'totalFloat',
    'freeFloat',
    'critical',
  ];
  const q = (x) => '"' + String(x).replaceAll('"', '""') + '"';
  return (
    [
      fields.join(','),
      ...result.tasks.map((t) =>
        fields.map((f) => q(f === 'label' && /^[=+@-]/.test(t[f]) ? "'" + t[f] : t[f])).join(','),
      ),
    ].join('\r\n') + '\r\n'
  );
}
export function fixture(kind = 'launch') {
  const t = (id, label, duration, depends = []) => ({ id, label, duration, depends });
  if (kind === 'diamond')
    return [
      t('start', 'Start milestone', 0),
      t('a', 'Parallel route A', 5, ['start']),
      t('b', 'Parallel route B', 5, ['start']),
      t('end', 'Delivery milestone', 0, ['a', 'b']),
    ];
  if (kind === 'launch')
    return [
      t('brief', 'Agree on scope', 2),
      t('design', 'Design the interface', 4, ['brief']),
      t('schema', 'Define data contracts', 3, ['brief']),
      t('api', 'Implement API', 6, ['schema']),
      t('ui', 'Build the interface', 5, ['design', 'schema']),
      t('integrate', 'Integrate & verify', 3, ['api', 'ui']),
      t('docs', 'Write operator guide', 2, ['schema']),
      t('launch', 'Release milestone', 0, ['integrate', 'docs']),
    ];
  throw Error('Unknown example.');
}
