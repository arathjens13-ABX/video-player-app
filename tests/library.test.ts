/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { DownloadStatus } from '../lib/db';
import { continueWatching, episodeNumber, groupByShow, nextEpisode, showBytes } from '../lib/library';

const ep = (id: number, show: string, title: string, createdAt = id, status: DownloadStatus = 'done') => ({ id, show, title, createdAt, status });

test('episodeNumber', () => {
  assert.equal(episodeNumber('Episode 12'), 12);
  assert.equal(episodeNumber('Ep 12.5'), 12.5);
  assert.equal(episodeNumber('Season 5 E140'), 140);
  assert.equal(episodeNumber('Finale'), null);
  assert.equal(episodeNumber('Part 2'), 2);
});

test('groups by show and orders episodes by number, not download time', () => {
  const groups = groupByShow([
    ep(1, 'Soul Land', 'Episode 12'),
    ep(2, 'Btth', 'Episode 3'),
    ep(3, 'Soul Land', 'Episode 2'),
    ep(4, 'Soul Land', 'Episode 10'),
    ep(5, 'Soul Land', 'Special'),
    ep(6, 'Soul Land', 'Episode 11', 6, 'downloading'),
  ]);
  assert.deepEqual(groups.map((g) => g.title), ['Btth', 'Soul Land']);
  assert.deepEqual(groups[1].data.map((e) => e.title), ['Episode 2', 'Episode 10', 'Episode 12', 'Special']);
});

test('nextEpisode follows the show order and skips unfinished downloads', () => {
  const all = [ep(1, 'A', 'Episode 2'), ep(2, 'A', 'Episode 1'), ep(3, 'A', 'Episode 3', 3, 'queued'), ep(4, 'B', 'Episode 1')];
  assert.equal(nextEpisode(all, all[1])?.id, 1);
  assert.equal(nextEpisode(all, all[0]), null);
  assert.equal(nextEpisode(all, all[3]), null);
});

test('shows differing only in case or spacing are one show', () => {
  const groups = groupByShow([ep(1, 'Renegade Immortal', 'Episode 1'), ep(2, 'renegade  immortal ', 'Episode 2')]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].title, 'Renegade Immortal');
  assert.equal(nextEpisode([ep(1, 'Renegade Immortal', 'Episode 1'), ep(2, 'renegade immortal', 'Episode 2')], ep(1, 'Renegade Immortal', 'Episode 1'))?.id, 2);
});

test('continue watching: resume where you stopped, else the next unwatched, newest first', () => {
  const e = (id: number, show: string, n: number, o: { pos?: number; watched?: number; at?: number } = {}) => ({
    ...ep(id, show, `Episode ${n}`),
    positionSec: o.pos ?? 0,
    watched: o.watched ?? 0,
    lastPlayedAt: o.at ?? null,
  });
  const rows = continueWatching([
    // Soul Land: finished 1, next is 2.
    e(1, 'Soul Land', 1, { watched: 1, at: 100 }),
    e(2, 'Soul Land', 2),
    e(3, 'Soul Land', 3),
    // Btth: stopped partway through 5, played more recently.
    e(4, 'Btth', 4, { watched: 1, at: 150 }),
    e(5, 'Btth', 5, { pos: 300, at: 200 }),
    // Caught up: nothing after the last played.
    e(6, 'Done Show', 9, { watched: 1, at: 300 }),
    // Never played.
    e(7, 'New Show', 1),
  ]);
  assert.deepEqual(
    rows.map((r) => [r.episode.show, r.episode.title, r.resume]),
    [
      ['Btth', 'Episode 5', true],
      ['Soul Land', 'Episode 2', false],
    ]
  );
});

test('show size counts finished downloads only', () => {
  assert.equal(
    showBytes([
      { bytesWritten: 100, status: 'done' },
      { bytesWritten: 50, status: 'downloading' },
      { bytesWritten: 25, status: 'done' },
    ]),
    125
  );
});
