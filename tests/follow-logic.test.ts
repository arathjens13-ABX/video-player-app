/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { describeNew, freshEpisodes } from '../lib/follow-logic';

const ep = (n: number) => ({ url: `https://animexin.dev/todg-s10-episode-${n}/`, num: `${n} [${432 + n}]`, title: `Tales of Demons and Gods Season 10 Episode ${n} Subtitle`, date: '' });

test('only episodes not seen before are new, oldest first', () => {
  const page = [ep(34), ep(33), ep(32), ep(31)];
  const { fresh, seen } = freshEpisodes([ep(31).url, ep(32).url], page);
  assert.deepEqual(fresh.map((e) => e.number), [33, 34]);
  assert.equal(fresh[0].show, 'Tales Of Demons And Gods Season 10');
  assert.equal(seen.length, 4);
  assert.deepEqual(freshEpisodes(seen, page).fresh, []);
});

test('notification text', () => {
  const f = { title: 'Tales of Demons and Gods Season 10' };
  const one = freshEpisodes([], [ep(33)]).fresh;
  assert.deepEqual(describeNew([{ follow: f, fresh: one, queued: 1 }]), {
    title: 'Tales of Demons and Gods Season 10',
    body: 'Episode 33 is out. Downloading when you open VidStash.',
  });
  assert.equal(describeNew([{ follow: f, fresh: [], queued: 0 }]), null);
  const two = freshEpisodes([], [ep(33), ep(34)]).fresh;
  assert.equal(describeNew([{ follow: f, fresh: two, queued: 0 }])?.body, '2 new episodes are out.');
  assert.deepEqual(describeNew([{ follow: f, fresh: two, queued: 2 }, { follow: { title: 'Swallowed Star' }, fresh: one, queued: 1 }]), {
    title: '3 new episodes',
    body: 'Tales of Demons and Gods Season 10 (2), Swallowed Star (1)',
  });
});
