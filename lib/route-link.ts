import { router } from 'expo-router';

import { classifyLink } from './links';
import { requestOpenInBrowser } from './open-in-browser';
import { USER_AGENT } from './ua';

/**
 * Sends a link where it belongs: video files and streams to the download form,
 * web pages to the in-app browser so the video inside can be found.
 */
export async function routeLink(url: string, how: 'push' | 'replace' = 'push') {
  const kind = await classifyLink(url, { 'User-Agent': USER_AGENT });
  if (kind === 'page') {
    requestOpenInBrowser(url);
    if (how === 'replace') router.replace('/browser');
    else router.navigate('/browser');
    return;
  }
  const target = { pathname: '/episode-form', params: { url, kind } } as const;
  if (how === 'replace') {
    router.replace('/downloads');
    router.push(target);
  } else {
    router.push(target);
  }
}
