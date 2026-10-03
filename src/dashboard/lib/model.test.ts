import { describe, expect, it } from 'vitest';
import {
  GRID_COLUMNS,
  MIN_SPAN,
  PAGE_COUNT,
  countBookmarks,
  createWidget,
  emptyPage,
  pageOf,
  sanitizeConfig,
  withPage
} from './model';

describe('sanitizeConfig', () => {
  it('turns anything that is not a board into an empty one', () => {
    for (const value of [null, 'nope', 42, ['a']]) {
      const config = sanitizeConfig(value);
      expect(config.pages[0].groups).toEqual([]);
      expect(config.pages[0].widgets).toEqual([]);
      expect(config.title).toBe('Home');
    }
  });

  it('accepts href for url, as other dashboards write it, and drops bookmarks with neither', () => {
    const config = sanitizeConfig({
      groups: [
        {
          name: 'Links',
          bookmarks: [{ name: 'A', href: 'https://a.example' }, { name: 'No address' }, 'junk']
        }
      ]
    });

    expect(config.pages[0].groups[0].bookmarks).toHaveLength(1);
    expect(config.pages[0].groups[0].bookmarks[0].url).toBe('https://a.example');
  });

  it('keeps widths on the board and styles it knows', () => {
    const config = sanitizeConfig({
      groups: [
        { name: 'Wide', width: 40, style: 'carousel' },
        { name: 'Narrow', width: 1 },
        { name: 'Text', width: '6', style: 'tiles' }
      ]
    });

    expect(config.pages[0].groups.map((group) => group.width)).toEqual([GRID_COLUMNS, MIN_SPAN, 6]);
    expect(config.pages[0].groups.map((group) => group.style)).toEqual(['cards', 'cards', 'tiles']);
  });

  it('reads each kind of widget, and glance’s word for markets', () => {
    const config = sanitizeConfig({
      widgets: [
        { type: 'weather', location: 'Cape Town', units: 'imperial' },
        { type: 'stocks', symbols: ['aapl', { symbol: 'btc-usd', name: 'Bitcoin' }] },
        { type: 'clock', zones: ['Europe/Paris', { timezone: 'Asia/Tokyo', name: 'Tokyo' }] },
        { type: 'hackernews', count: 99 },
        { type: 'calendar', weekStart: 'sunday' },
        { type: 'rss' }
      ]
    });

    expect(config.pages[0].widgets.map((widget) => widget.type)).toEqual([
      'weather',
      'markets',
      'clock',
      'hackernews',
      'calendar'
    ]);
    expect(config.pages[0].widgets[1]).toMatchObject({
      symbols: [
        { symbol: 'AAPL', name: '' },
        { symbol: 'BTC-USD', name: 'Bitcoin' }
      ]
    });
    expect(config.pages[0].widgets[2]).toMatchObject({
      zones: [
        { zone: 'Europe/Paris', label: '' },
        { zone: 'Asia/Tokyo', label: 'Tokyo' }
      ]
    });
    expect(config.pages[0].widgets[3]).toMatchObject({ count: 15 });
    expect(config.pages[0].widgets[4]).toMatchObject({ weekStart: 0 });
  });

  it('reads the Agenda, keeping its settings within range', () => {
    const [plain, tuned, sunday, bounded] = sanitizeConfig({
      widgets: [
        { type: 'agenda' },
        { type: 'agenda', width: 8, weekStart: 'sunday', count: '9', month: false },
        { type: 'agenda', weekStart: 0 },
        { type: 'agenda', count: 99, month: 'no' }
      ]
    }).pages[0].widgets;

    expect(plain).toMatchObject({ type: 'agenda', width: 4, weekStart: 1, count: 5, month: true });
    expect(tuned).toMatchObject({ width: 8, weekStart: 0, count: 9, month: false });
    expect(sunday).toMatchObject({ weekStart: 0 });
    expect(bounded).toMatchObject({ count: 12, month: true });
    expect(
      sanitizeConfig({ widgets: [{ type: 'agenda', count: 1 }] }).pages[0].widgets[0]
    ).toMatchObject({
      count: 3
    });
  });

  it('reads the AI Leaderboard’s price limit, keeping it to a sensible range', () => {
    const [given, huge, negative, missing, text] = sanitizeConfig({
      widgets: [
        { type: 'benchlm', maxPrice: 0.5 },
        { type: 'benchlm', maxPrice: 5000 },
        { type: 'benchlm', maxPrice: -3 },
        { type: 'benchlm' },
        { type: 'benchlm', maxPrice: 'cheap' }
      ]
    }).pages[0].widgets;

    expect(given).toMatchObject({ maxPrice: 0.5 });
    expect(huge).toMatchObject({ maxPrice: 100 });
    expect(negative).toMatchObject({ maxPrice: 0 });
    expect(missing).toMatchObject({ maxPrice: 0 });
    expect(text).toMatchObject({ maxPrice: 0 });
    expect(createWidget('benchlm')).toMatchObject({ maxPrice: 0 });
  });

  it('reads which services the status bar watches, and whether it tells of slow service', () => {
    const watched = sanitizeConfig({
      status: ['npm', 'nonsense', 'github', 'npm', 5],
      statusDegraded: true
    });

    expect(watched.status).toEqual(['github', 'npm']);
    expect(watched.statusDegraded).toBe(true);
    expect(sanitizeConfig({ status: 'vercel' }).status).toEqual(['vercel']);
    expect(sanitizeConfig({ statusDegraded: 'yes' }).statusDegraded).toBe(false);

    const none = sanitizeConfig({});
    expect(none.status).toEqual([]);
    expect(none.statusDegraded).toBe(false);
  });

  it('reads My PRs, keeping its settings within range and anything but a token out', () => {
    const token = 'github_pat_11ABCDEFG0abcdefghijklmnopqrstuvwxyz';
    const [plain, tuned, junk, bounded, low] = sanitizeConfig({
      widgets: [
        { type: 'prs' },
        { type: 'prs', token: `  ${token} `, show: 'review', count: '8', width: 6 },
        { type: 'prs', token: 'not a token at all', show: 'everything' },
        { type: 'prs', count: 99 },
        { type: 'prs', count: 1 }
      ]
    }).pages[0].widgets;

    expect(plain).toMatchObject({ type: 'prs', width: 4, token: '', show: 'both', count: 5 });
    expect(tuned).toMatchObject({ token, show: 'review', count: 8, width: 6 });
    expect(junk).toMatchObject({ token: '', show: 'both' });
    expect(bounded).toMatchObject({ count: 10 });
    expect(low).toMatchObject({ count: 3 });
    expect(createWidget('prs')).toMatchObject({ type: 'prs', token: '', show: 'both', count: 5 });
  });

  it('reads the Focus timer, keeping its lengths in range and its chime on unless turned off', () => {
    const [plain, tuned, long, short, text, quiet] = sanitizeConfig({
      widgets: [
        { type: 'focus' },
        { type: 'focus', focus: 50, rest: 10, sound: false, width: 6 },
        { type: 'focus', focus: 500, rest: 500 },
        { type: 'focus', focus: 1, rest: 0 },
        { type: 'focus', focus: '40', rest: 'long' },
        { type: 'focus', sound: 'no' }
      ]
    }).pages[0].widgets;

    expect(plain).toMatchObject({ type: 'focus', width: 4, focus: 25, rest: 5, sound: true });
    expect(tuned).toMatchObject({ focus: 50, rest: 10, sound: false, width: 6 });
    expect(long).toMatchObject({ focus: 90, rest: 30 });
    expect(short).toMatchObject({ focus: 5, rest: 1 });
    expect(text).toMatchObject({ focus: 40, rest: 5 });
    expect(quiet).toMatchObject({ sound: true });
    expect(createWidget('focus')).toMatchObject({ type: 'focus', focus: 25, rest: 5, sound: true });
  });

  it('keeps the glass within its range', () => {
    expect(sanitizeConfig({ glass: { blur: 400, tint: -1 } }).glass).toEqual({ blur: 32, tint: 0 });
  });

  it('gives every new widget something sensible to show', () => {
    expect(createWidget('weather')).toMatchObject({ location: 'London' });
    expect(createWidget('markets')).toMatchObject({ type: 'markets' });
    expect(createWidget('agenda')).toMatchObject({
      type: 'agenda',
      width: 4,
      weekStart: 1,
      count: 5,
      month: true
    });
  });

  it('counts bookmarks across groups', () => {
    const config = sanitizeConfig({
      groups: [
        { name: 'A', bookmarks: [{ url: 'https://a.example' }] },
        { name: 'B', bookmarks: [{ url: 'https://b.example' }, { url: 'https://c.example' }] }
      ]
    });

    expect(countBookmarks(config)).toBe(3);
  });
});

describe('pages', () => {
  it('turns a board saved before pages into the first of three', () => {
    const config = sanitizeConfig({
      widgets: [{ type: 'calendar' }],
      groups: [{ name: 'Code', bookmarks: [{ url: 'https://a.example' }] }]
    });

    expect(config.pages).toHaveLength(PAGE_COUNT);
    expect(config.pages[0].groups.map((group) => group.name)).toEqual(['Code']);
    expect(config.pages[0].widgets).toHaveLength(1);
    expect(config.pages.slice(1)).toEqual([emptyPage(), emptyPage()]);
  });

  it('always keeps exactly three pages', () => {
    const many = sanitizeConfig({
      pages: [1, 2, 3, 4].map((n) => ({ groups: [{ name: `P${n}` }] }))
    });
    const few = sanitizeConfig({ pages: [{ groups: [{ name: 'Only' }] }] });

    expect(many.pages.map((page) => page.groups[0].name)).toEqual(['P1', 'P2', 'P3']);
    expect(few.pages).toHaveLength(PAGE_COUNT);
    expect(countBookmarks(few)).toBe(0);
  });

  it('edits one page through its view, and shares settings across all of them', () => {
    const config = sanitizeConfig({
      pages: [{ groups: [{ name: 'One' }] }, { groups: [{ name: 'Two' }] }]
    });
    const view = pageOf(config, 1);

    expect(view.groups.map((group) => group.name)).toEqual(['Two']);

    const next = withPage(config, 1, { ...view, name: 'Sam', groups: [] });
    expect(next.name).toBe('Sam');
    expect(next.pages[0]).toBe(config.pages[0]);
    expect(next.pages[1].groups).toEqual([]);
  });
});
