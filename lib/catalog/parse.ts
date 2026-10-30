/**
 * Reads the pages of sites built on the "animestream" WordPress theme
 * (AnimeXin, Donghua Stream, Lucifer Donghua, AnimeKhor): listings, search
 * results, show pages and the release schedule. Pure functions over HTML, so
 * they can be tested against saved pages.
 */
import { parse, type HTMLElement } from 'node-html-parser';

import { URL } from '../url';

/** A show (or episode) as listed in a grid: poster card with a title and a badge. */
export type Card = {
  url: string;
  title: string;
  poster: string | null;
  /** The corner badge: "Ep 164", "Ongoing", "Completed"… */
  badge: string;
  /** "ONA", "Movie"… */
  type: string;
};

export type Section = { title: string; cards: Card[] };

export type OnlineEpisode = { url: string; num: string; title: string; date: string };

export type Series = {
  url: string;
  title: string;
  poster: string | null;
  description: string;
  /** "Status" → "Ongoing", "Type" → "ONA", "Episodes" → "130"… as the site labels them. */
  info: Record<string, string>;
  /** Newest first, as the site lists them. */
  episodes: OnlineEpisode[];
};

export type ScheduleDay = { day: string; shows: { url: string; title: string }[] };

const clean = (s: string | undefined | null) => (s ?? '').replace(/\s+/g, ' ').trim();

function absolute(href: string | undefined, base: string): string | null {
  if (!href) return null;
  try {
    const url = new URL(href, base).toString();
    return /^https?:\/\//i.test(url) ? url : null;
  } catch {
    return null;
  }
}

/** The real image of an <img>, past lazy-loading placeholders (data: URIs). */
function imageOf(img: HTMLElement | null, base: string): string | null {
  if (!img) return null;
  for (const attr of ['data-src', 'data-lazy-src', 'src']) {
    const v = img.getAttribute(attr);
    if (v && !v.startsWith('data:')) return absolute(v, base);
  }
  const srcset = img.getAttribute('data-srcset') ?? img.getAttribute('srcset');
  return srcset ? absolute(srcset.split(',')[0].trim().split(/\s+/)[0], base) : null;
}

function cardOf(article: HTMLElement, base: string): Card | null {
  const a = article.querySelector('a[href]');
  const url = absolute(a?.getAttribute('href'), base);
  if (!a || !url) return null;
  const title =
    clean(a.getAttribute('title')) ||
    clean(article.querySelector('.tt h2, .tt, .eggtitle')?.text) ||
    clean(article.querySelector('img')?.getAttribute('alt'));
  if (!title) return null;
  return {
    url,
    title,
    poster: imageOf(article.querySelector('img'), base),
    badge: clean(article.querySelector('.epx, .eggepisode')?.text),
    type: clean(article.querySelector('.typez, .eggtype')?.text),
  };
}

function cardsIn(scope: HTMLElement, base: string): Card[] {
  const seen = new Set<string>();
  const out: Card[] = [];
  for (const article of scope.querySelectorAll('article.bs, div.bs')) {
    const card = cardOf(article, base);
    if (card && !seen.has(card.url)) {
      seen.add(card.url);
      out.push(card);
    }
  }
  return out;
}

/** The home page's sections ("Latest Release", "Popular Today"…), each with its cards. */
export function parseHome(html: string, base: string): Section[] {
  const root = parse(html);
  const sections: Section[] = [];
  for (const box of root.querySelectorAll('.bixbox')) {
    const title = clean(box.querySelector('.releases h1, .releases h2, .releases h3')?.text);
    const cards = cardsIn(box, base);
    if (title && cards.length) sections.push({ title, cards });
  }
  return sections;
}

/** Search results and show lists (ongoing, completed…): the main grid's cards. */
export function parseList(html: string, base: string): { cards: Card[]; hasMore: boolean } {
  const root = parse(html);
  const main = root.querySelector('.postbody .listupd') ?? root.querySelector('.listupd') ?? root;
  const cards = cardsIn(main, base);
  const hasMore = !!root.querySelector('.hpage a.r, .pagination a.next, a.next.page-numbers');
  return { cards, hasMore };
}

/** A show's page: title, poster, details, description and its episode list. */
export function parseSeries(html: string, url: string): Series {
  const root = parse(html);
  const info: Record<string, string> = {};
  for (const span of root.querySelectorAll('.info-content .spe span, .spe span')) {
    const label = clean(span.querySelector('b')?.text ?? span.text.split(':')[0]).replace(/:$/, '');
    const value = clean(span.text.slice(span.text.indexOf(':') + 1));
    if (label && value && !(label in info) && span.text.includes(':')) info[label] = value;
  }
  const episodes: OnlineEpisode[] = [];
  const seen = new Set<string>();
  for (const a of root.querySelectorAll('.eplister li a[href]')) {
    const href = absolute(a.getAttribute('href'), url);
    if (!href || seen.has(href)) continue;
    seen.add(href);
    episodes.push({
      url: href,
      num: clean(a.querySelector('.epl-num')?.text),
      title: clean(a.querySelector('.epl-title')?.text) || clean(a.text),
      date: clean(a.querySelector('.epl-date')?.text),
    });
  }
  const descriptionEl =
    root.querySelector('.entry-content[itemprop="description"]') ?? root.querySelector('.synp .entry-content') ?? root.querySelector('.desc');
  const ogImage = root.querySelector('meta[property="og:image"]')?.getAttribute('content');
  return {
    url,
    title: clean(root.querySelector('h1.entry-title')?.text) || clean(root.querySelector('title')?.text),
    poster: imageOf(root.querySelector('.bigcontent .thumb img, .thumb img'), url) ?? absolute(ogImage, url),
    description: clean(descriptionEl?.text),
    info,
    episodes,
  };
}

/** The show an episode page belongs to (its "All Episodes" link). */
export function seriesLinkOf(html: string, url: string): string | null {
  const root = parse(html);
  const a = root.querySelector('a[aria-label="All Episodes"], .naveps .nvsc a[href], .ts-breadcrumb li:nth-child(2) a');
  return absolute(a?.getAttribute('href'), url);
}

/** AnimeXin's weekly schedule: shows per weekday. Empty where the site fills it in with scripts. */
export function parseSchedule(html: string, base: string): ScheduleDay[] {
  const root = parse(html);
  const days: ScheduleDay[] = [];
  for (const block of root.querySelectorAll('.listSchh')) {
    const day = clean(block.querySelector('h2, h3')?.text);
    const shows = block
      .querySelectorAll('.subSchh a[href]')
      .map((a) => ({ url: absolute(a.getAttribute('href'), base), title: clean(a.text) }))
      .filter((s): s is { url: string; title: string } => !!s.url && !!s.title);
    if (day && shows.length) days.push({ day, shows });
  }
  return days;
}

/** Whether a fetched page is a bot check ("Just a moment…") instead of the page itself. */
export function isChallenge(html: string): boolean {
  return /<title>\s*Just a moment|cf-browser-verification|challenge-platform/i.test(html.slice(0, 20000));
}

/** A file link from an episode's downloads box: "Subtitle English" · "1080" · "Mediafire". */
export type DownloadLink = { group: string; quality: string; host: string; url: string };

/** The downloads box of an episode page (Terabox, Mirror, MediaFire… per subtitle language and quality). */
export function parseDownloads(html: string, url: string): DownloadLink[] {
  const root = parse(html);
  const out: DownloadLink[] = [];
  for (const block of root.querySelectorAll('.soraddlx, .soraddl')) {
    const group = clean(block.querySelector('.sorattlx h3, .sorattl h3, h3')?.text);
    for (const row of block.querySelectorAll('.soraurlx, .soraurl')) {
      const quality = clean(row.querySelector('strong')?.text);
      for (const a of row.querySelectorAll('a[href]')) {
        const href = absolute(a.getAttribute('href'), url);
        if (href) out.push({ group, quality, host: clean(a.text), url: href });
      }
    }
  }
  return out;
}

/** Whether a download is the English-subtitled one (by its heading, or "_eng" in the file name). */
export function isEnglishDownload(d: DownloadLink): boolean {
  return /\benglish\b|\beng\b/i.test(d.group) || /[_\-.]eng[_\-.]/i.test(d.url);
}
