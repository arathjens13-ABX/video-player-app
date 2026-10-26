/// <reference types="node" />
/** The site parsers against saved pages from the live sites (tests/fixtures/sites, October 2026). */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { isChallenge, parseHome, parseList, parseSchedule, parseSeries, seriesLinkOf } from '../lib/catalog/parse';

const page = (f: string) => fs.readFileSync(path.join(__dirname, 'fixtures', 'sites', f), 'utf8');
const AX = 'https://animexin.dev/';

test('home page: sections with episode cards', () => {
  const sections = parseHome(page('animexin-home.html'), AX);
  const latest = sections.find((s) => s.title === 'Latest Release')!;
  assert.ok(latest.cards.length >= 10);
  assert.match(latest.cards[0].url, /^https:\/\/animexin\.dev\/.+episode-\d+/);
  assert.match(latest.cards[0].badge, /\d/);
  assert.ok(latest.cards.every((c) => c.poster?.startsWith('https://')));
});

test('search and show lists, including lazy-loaded posters', () => {
  const search = parseList(page('animexin-search.html'), AX);
  assert.ok(search.cards.length > 0 && search.cards.every((c) => /soul land/i.test(c.title)));
  const ongoing = parseList(page('animexin-ongoing.html'), AX);
  assert.equal(ongoing.cards.length, 30);
  assert.equal(ongoing.hasMore, true);
  const dh = parseList(page('donghuastream-ongoing.html'), 'https://donghuastream.org/');
  assert.ok(dh.cards.length > 0);
  assert.ok(dh.cards.every((c) => c.poster && !c.poster.startsWith('data:')), 'real images, not placeholders');
});

test('show page: details, description and episodes', () => {
  const s = parseSeries(page('animexin-series.html'), `${AX}tales-of-demons-and-gods-season-10/`);
  assert.equal(s.title, 'Tales of Demons and Gods Season 10');
  assert.equal(s.poster, 'https://animexin.dev/wp-content/uploads/2026/07/TODG-S10-New.jpg');
  assert.equal(s.info.Type, 'ONA');
  assert.ok(s.info.Status);
  assert.ok(s.episodes.length >= 30);
  assert.match(s.episodes[0].num, /^\d+/);
  assert.equal(new Set(s.episodes.map((e) => e.url)).size, s.episodes.length);
  const dh = parseSeries(page('donghuastream-series.html'), 'https://donghuastream.org/anime/swallowed-star-season-4th/');
  assert.equal(dh.title, 'Swallowed Star Season 4');
  assert.ok(dh.poster && !dh.poster.startsWith('data:'));
  assert.ok(dh.episodes.length > 100);
});

test('episode page links to its show; schedule by weekday', () => {
  assert.equal(seriesLinkOf(page('animexin-episode.html'), `${AX}x/`), `${AX}tales-of-demons-and-gods-season-10/`);
  const days = parseSchedule(page('animexin-schedule.html'), AX);
  assert.equal(days.length, 7);
  assert.ok(days.every((d) => d.shows.length > 0 && d.shows.every((s) => s.url.startsWith(AX))));
});

test('bot-check pages are recognised', () => {
  assert.ok(isChallenge('<!DOCTYPE html><html><head><title>Just a moment...</title>'));
  assert.ok(!isChallenge(page('animexin-home.html')));
});
