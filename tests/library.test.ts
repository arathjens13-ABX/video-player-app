/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { DownloadStatus } from '../lib/db';
import { episodeNumber, groupByShow, nextEpisode } from '../lib/library';

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
