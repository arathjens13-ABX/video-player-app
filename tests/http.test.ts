/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { deadline, untilAborted } from '../lib/http';

test('untilAborted settles when the signal aborts even if the work never does', async () => {
  const controller = new AbortController();
  const never = new Promise<string>(() => {});
  const waiting = untilAborted(never, controller.signal);
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(waiting, { name: 'AbortError' });
  await assert.rejects(untilAborted(Promise.resolve(1), controller.signal), { name: 'AbortError' });
});

test('untilAborted passes results and errors through', async () => {
  const signal = new AbortController().signal;
  assert.equal(await untilAborted(Promise.resolve(5), signal), 5);
  await assert.rejects(untilAborted(Promise.reject(new Error('403')), signal), /403/);
});

test('deadline aborts on time-out or with the outer signal, and says which', async () => {
  const slow = deadline(10);
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(slow.signal.aborted && slow.timedOut());
  slow.done();

  const outer = new AbortController();
  const d = deadline(10_000, outer.signal);
  outer.abort();
  assert.ok(d.signal.aborted && !d.timedOut());
  d.done();
});
