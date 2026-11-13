import test from 'node:test';
import assert from 'node:assert/strict';
import { schedule, analyze, compare, fixture, validate, toCSV } from '../core.js';
const t = (id, duration, depends = []) => ({ id, label: id, duration, depends });
test('forward and backward passes produce known launch critical routes', () => {
  const r = schedule(fixture());
  assert.equal(r.finish, 14);
  assert.equal(r.criticalPathCount, '2');
  assert.equal(r.work, 25);
  const docs = r.tasks.find((t) => t.id === 'docs');
  assert.equal(docs.earlyStart, 5);
  assert.equal(docs.totalFloat, 7);
  assert.equal(docs.freeFloat, 7);
});
test('parallel critical routes require joint improvements', () => {
  const r = analyze(fixture('diamond'));
  assert.equal(r.criticalPathCount, '2');
  assert.equal(r.finish, 5);
  assert.ok(r.sensitivity.every((t) => t.saved === 0));
  const x = fixture('diamond').map((t) => ({ ...t, duration: t.duration ? 4 : 0 }));
  assert.equal(schedule(x).finish, 4);
});
test('serial work and disconnected components share a project finish', () => {
  const r = schedule([t('a', 4), t('b', 3, ['a']), t('c', 2)]);
  assert.equal(r.finish, 7);
  assert.deepEqual(r.criticalPath, ['a', 'b']);
  assert.equal(r.tasks.find((t) => t.id === 'c').totalFloat, 5);
});
test('zero-duration milestones and empty-time projects are valid', () => {
  const r = schedule([t('a', 0), t('b', 0, ['a']), t('c', 0)]);
  assert.equal(r.finish, 0);
  assert.equal(r.criticalPathCount, '2');
  assert.ok(r.tasks.every((t) => t.critical));
});
test('cycle rejection includes a closed witness', () => {
  assert.throws(
    () => schedule([t('a', 1, ['c']), t('b', 1, ['a']), t('c', 1, ['b'])]),
    /a → c → b → a/,
  );
  assert.throws(() => schedule([t('a', 0, ['a'])]), /a → a/);
});
test('input validation rejects ambiguous or oversized projects', () => {
  for (const x of [
    [],
    [t('a', -1)],
    [t('a', 1.1)],
    [t('a', 10001)],
    [t('a', 1, ['missing'])],
    [t('a', 1), t('a', 2)],
    [t('a', 1), t('b', 2, ['a', 'a'])],
    [{ ...t('a', 1), secret: 1 }],
  ])
    assert.throws(() => schedule(x));
  assert.throws(() => validate(Array.from({ length: 65 }, (_, i) => t('t' + i, 1))));
});
test('hundreds of DAGs match exhaustive source-to-sink path enumeration', () => {
  let seed = 127;
  const rand = (n) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % n;
  };
  for (let sample = 0; sample < 400; sample++) {
    const tasks = Array.from({ length: 2 + rand(7) }, (_, i) =>
      t(
        't' + i,
        rand(6),
        Array.from({ length: i }, (_, j) => 't' + j).filter(() => rand(3) === 0),
      ),
    );
    const paths = [];
    function walk(id, route) {
      const next = tasks.filter((x) => x.depends.includes(id));
      const path = [...route, id];
      if (!next.length) paths.push(path);
      else for (const x of next) walk(x.id, path);
    }
    for (const x of tasks.filter((x) => !x.depends.length)) walk(x.id, []);
    const length = (p) => p.reduce((s, id) => s + tasks.find((x) => x.id === id).duration, 0),
      finish = Math.max(...paths.map(length));
    const critical = paths.filter((p) => length(p) === finish),
      r = schedule(tasks);
    assert.equal(r.finish, finish);
    assert.equal(r.criticalPathCount, String(critical.length));
    for (const x of r.tasks) {
      assert.equal(
        x.critical,
        critical.some((p) => p.includes(x.id)),
      );
      assert.equal(
        x.totalFloat,
        finish - Math.max(...paths.filter((p) => p.includes(x.id)).map(length)),
      );
      assert.ok(x.freeFloat >= 0 && x.freeFloat <= x.totalFloat);
    }
    assert.ok(critical.some((p) => JSON.stringify(p) === JSON.stringify(r.criticalPath)));
  }
});
test('free float differs from total float when downstream work also has slack', () => {
  const r = schedule([t('a', 10), t('b', 1), t('c', 1, ['b']), t('end', 0, ['a', 'c'])]);
  const b = r.tasks.find((t) => t.id === 'b');
  assert.equal(b.totalFloat, 8);
  assert.equal(b.freeFloat, 0);
});
test('sensitivity identifies real one-unit project savings and respects milestones', () => {
  const r = analyze([t('a', 3), t('b', 2, ['a']), t('end', 0, ['b'])]);
  assert.deepEqual(
    r.sensitivity.map((x) => x.saved),
    [1, 1, 0],
  );
});
test('scenario comparison uses stable IDs and does not mutate input', () => {
  const before = fixture(),
    snapshot = JSON.stringify(before),
    after = before.map((t) => ({ ...t, duration: t.id === 'api' ? 9 : t.duration }));
  const c = compare(before, after);
  assert.equal(c.delta, 3);
  assert.equal(c.tasks.find((t) => t.id === 'launch').startDelta, 3);
  assert.equal(JSON.stringify(before), snapshot);
});
test('CSV escaping protects labels while retaining numeric scheduling fields', () => {
  const r = schedule([{ ...t('a', 2), label: '=SUM("x")' }]);
  assert.match(toCSV(r), /"'=SUM\(""x""\)"/);
  assert.match(toCSV(r), /"2","0","2"/);
});
