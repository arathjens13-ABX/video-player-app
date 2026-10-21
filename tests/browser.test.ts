/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { addressToUrl, baseDomain, sameSite, shouldBlockNavigation } from '../lib/browser';

const page = 'https://animexin.dev/soul-land-episode-1/';

test('baseDomain and sameSite', () => {
  assert.equal(baseDomain('www.animexin.dev'), 'animexin.dev');
  assert.equal(baseDomain('ANIMEXIN.DEV.'), 'animexin.dev');
  assert.ok(sameSite('https://www.animexin.dev/a', page));
  assert.ok(!sameSite('https://ads.example.com/x', page));
  assert.ok(!sameSite('not a url', page));
});

test('blocks scripted cross-site redirects of the whole page', () => {
  assert.equal(
    shouldBlockNavigation({ url: 'https://casino.example/win', currentUrl: page, isTopFrame: true, navigationType: 'other', userTyped: false }),
    true
  );
});

test('blocks taps that leave the site (invisible ad links over the player)', () => {
  const base = { currentUrl: page, isTopFrame: true, userTyped: false };
  assert.equal(shouldBlockNavigation({ ...base, url: 'https://digital.americascardroom.eu/lp/', navigationType: 'click' }), true);
  assert.equal(shouldBlockNavigation({ ...base, url: 'https://animexin.dev/episode-2/', navigationType: 'click' }), false);
});

test('allows search results, back/forward and reloads to other sites', () => {
  const base = { isTopFrame: true, userTyped: false, url: 'https://animexin.dev/' };
  assert.equal(shouldBlockNavigation({ ...base, currentUrl: 'https://duckduckgo.com/?q=animexin', navigationType: 'click' }), false);
  assert.equal(shouldBlockNavigation({ ...base, currentUrl: 'https://www.google.com/search?q=x', navigationType: 'click' }), false);
  assert.equal(shouldBlockNavigation({ ...base, currentUrl: 'https://other.example/', navigationType: 'backforward' }), false);
  assert.equal(shouldBlockNavigation({ ...base, currentUrl: 'https://other.example/', navigationType: 'reload' }), false);
});

test('allows same-site redirects, iframes and typed addresses', () => {
  const base = { currentUrl: page, isTopFrame: true, userTyped: false };
  assert.equal(shouldBlockNavigation({ ...base, url: 'https://animexin.dev/next/', navigationType: 'other' }), false);
  assert.equal(shouldBlockNavigation({ ...base, url: 'https://player.example/embed', navigationType: 'other', isTopFrame: false }), false);
  assert.equal(shouldBlockNavigation({ ...base, url: 'https://other.example/', navigationType: 'other', userTyped: true }), false);
  assert.equal(shouldBlockNavigation({ ...base, url: 'https://other.example/', navigationType: 'other', currentUrl: null }), false);
});

test('blocks jumps to app-store and other app schemes', () => {
  const base = { currentUrl: page, isTopFrame: true, userTyped: false, navigationType: 'click' };
  assert.equal(shouldBlockNavigation({ ...base, url: 'itms-apps://apps.apple.com/app/id1' }), true);
  assert.equal(shouldBlockNavigation({ ...base, url: 'about:blank' }), false);
});

test('address bar turns words into a search', () => {
  assert.equal(addressToUrl('animexin.dev'), 'https://animexin.dev/');
  assert.equal(addressToUrl('soul land episode 1'), 'https://duckduckgo.com/?q=soul%20land%20episode%201');
  assert.equal(addressToUrl('animexin'), 'https://duckduckgo.com/?q=animexin');
  assert.equal(addressToUrl('  '), null);
});
