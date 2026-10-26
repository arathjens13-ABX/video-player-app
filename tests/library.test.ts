/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { DownloadStatus } from '../lib/db';
import { continueWatching, episodeNumber, findShows, groupBySeries, groupByShow, isNew, nextEpisode, renamedShow, seriesOf, showBytes, showSummaries } from '../lib/library';

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

test('show list: next episode per show, search and sort', () => {
  const e = (id: number, show: string, n: number, o: { pos?: number; watched?: number; at?: number; added?: number } = {}) => ({
    ...ep(id, show, `Episode ${n}`, o.added ?? id),
    positionSec: o.pos ?? 0,
    watched: o.watched ?? 0,
    lastPlayedAt: o.at ?? null,
    bytesWritten: 100,
  });
  const shows = showSummaries([
    e(1, 'Soul Land 2', 1, { watched: 1, at: 50 }),
    e(2, 'Soul Land 2', 2),
    e(3, 'Battle Through the Heavens', 4, { pos: 120, at: 90 }),
    e(4, 'Battle Through the Heavens', 3, { watched: 1, at: 80 }),
    e(5, 'Renegade Immortal', 1, { added: 500 }),
    e(6, 'Renegade Immortal', 2, { added: 501 }),
  ]);
  const btth = shows.find((s) => s.title.startsWith('Battle'))!;
  assert.equal(btth.next?.title, 'Episode 4');
  assert.equal(btth.resume, true);
  assert.equal(btth.unwatched, 1);
  assert.equal(btth.bytes, 200);
  assert.equal(shows.find((s) => s.title === 'Soul Land 2')!.next?.title, 'Episode 2');
  assert.equal(shows.find((s) => s.title === 'Renegade Immortal')!.next?.title, 'Episode 1'); // never played: from the start

  assert.deepEqual(findShows(shows, '', 'recent').map((s) => s.title), ['Battle Through the Heavens', 'Soul Land 2', 'Renegade Immortal']);
  assert.deepEqual(findShows(shows, '', 'az').map((s) => s.title), ['Battle Through the Heavens', 'Renegade Immortal', 'Soul Land 2']);
  assert.deepEqual(findShows(shows, '', 'added').map((s) => s.title), ['Renegade Immortal', 'Battle Through the Heavens', 'Soul Land 2']);
  assert.deepEqual(findShows(shows, 'land soul', 'az').map((s) => s.title), ['Soul Land 2']);
  assert.deepEqual(findShows(shows, 'HEAVENS', 'az').map((s) => s.title), ['Battle Through the Heavens']);
  assert.deepEqual(findShows(shows, 'zzz', 'az'), []);
});

test('season markers split a show name into series and season', () => {
  assert.deepEqual(seriesOf('Tales Of Demons And Gods Season 10'), { series: 'Tales Of Demons And Gods', season: 10 });
  assert.deepEqual(seriesOf('Swallowed Star Season 5'), { series: 'Swallowed Star', season: 5 });
  assert.deepEqual(seriesOf('Perfect World 2nd Season'), { series: 'Perfect World', season: 2 });
  assert.deepEqual(seriesOf('Link Click Second Season'), { series: 'Link Click', season: 2 });
  assert.deepEqual(seriesOf('Mortal Journey S3'), { series: 'Mortal Journey', season: 3 });
  assert.deepEqual(seriesOf('Throne of Seal (Season 2) Remastered'), { series: 'Throne of Seal Remastered', season: 2 });
  assert.deepEqual(seriesOf('Soul Land 2'), { series: 'Soul Land 2', season: null });
  assert.deepEqual(seriesOf('Season 3'), { series: 'Season 3', season: null }); // nothing left for a series name
  assert.deepEqual(seriesOf('Shrouding the Heavens'), { series: 'Shrouding the Heavens', season: null });
});

test('seasons group into one series; up next carries on into the next season', () => {
  const list = [
    ep(1, 'Tales Of Demons And Gods Season 10', 'Episode 1'),
    ep(2, 'Tales Of Demons And Gods Season 9', 'Episode 52'),
    ep(3, 'Tales of demons and gods season 9', 'Episode 51'),
    ep(4, 'Swallowed Star Season 5', 'Episode 1'),
  ];
  const series = groupBySeries(list);
  assert.deepEqual(series.map((s) => s.title), ['Swallowed Star', 'Tales Of Demons And Gods']);
  const todg = series[1];
  assert.deepEqual(todg.seasons.map((s) => s.season), [9, 10]);
  assert.deepEqual(todg.episodes.map((e) => e.id), [3, 2, 1]);
  assert.equal(nextEpisode(list, list[1])?.id, 1); // S9 E52 -> S10 E1
  assert.equal(nextEpisode(list, list[0]), null);
});

test('new means downloaded and never opened', () => {
  const base = { status: 'done' as const, watched: 0, lastPlayedAt: null, positionSec: 0 };
  assert.ok(isNew(base));
  assert.ok(!isNew({ ...base, lastPlayedAt: 5 }));
  assert.ok(!isNew({ ...base, watched: 1 }));
  assert.ok(!isNew({ ...base, status: 'downloading' }));
});

test('renaming a series keeps each season number', () => {
  assert.equal(renamedShow(9, ' Tales of Demons  and Gods '), 'Tales of Demons and Gods Season 9');
  assert.equal(renamedShow(null, 'Soul Land 2'), 'Soul Land 2');
  // Renamed seasons still group back into one series.
  assert.deepEqual(seriesOf(renamedShow(10, 'Tales of Demons and Gods')), { series: 'Tales of Demons and Gods', season: 10 });
});
