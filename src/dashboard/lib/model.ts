/**
 * The dashboard's shape: groups of bookmarks, a row of widgets, and the few
 * settings that change how it all behaves.
 *
 * Everything here lives in the browser's local storage as YAML, the same YAML
 * a visitor exports and imports, so every field has a sanitiser: a hand-edited
 * file, an old export or a half-typed value must never break the page.
 */
import { CALENDAR_SLOTS, type AgendaWidget } from './agenda';
import { readCalendarAddresses } from './calendar-address';
import { emptyExtensions, sanitizeExtensions, type ExtensionsConfig } from './extensions-config';
import { BENCH_SURFACES, type BenchmarkWidget } from './benchlm';
import { TRENDING_SINCE, languageSlug, type GithubTrendingWidget } from './github';
import { TRENDING_WINDOWS, type PopularTvWidget } from './tmdb';

export type { AgendaWidget } from './agenda';
export type { AppExtension, ExtensionsConfig } from './extensions-config';
export type { BenchmarkWidget, BenchSurface } from './benchlm';
export type { GithubTrendingWidget, TrendingSince } from './github';
export type { PopularTvWidget, TrendingWindow } from './tmdb';

/** How a group lays out its bookmarks. */
export type BookmarkStyle = 'cards' | 'tiles' | 'list';

export const BOOKMARK_STYLES: readonly BookmarkStyle[] = ['cards', 'tiles', 'list'];

export type Bookmark = {
  /** Runtime only; never written to YAML. */
  id: string;
  name: string;
  url: string;
  description: string;
  /** Empty for the site's own favicon; see `icons.ts` for the other forms. */
  icon: string;
};

/** The board is a 12-column grid; a group or widget spans part of it. */
export const GRID_COLUMNS = 12;
export const MIN_SPAN = 3;
export const DEFAULT_GROUP_SPAN = 4;

export type Group = {
  id: string;
  name: string;
  icon: string;
  /** Columns of the 12-column board, from MIN_SPAN to GRID_COLUMNS. */
  width: number;
  style: BookmarkStyle;
  collapsed: boolean;
  bookmarks: Bookmark[];
};

export type TemperatureUnits = 'metric' | 'imperial';
export type HourFormat = '12h' | '24h';

export type WeatherWidget = {
  id: string;
  type: 'weather';
  width: number;
  /** A place name, e.g. "Cape Town" or "Portland, Oregon, US". */
  location: string;
  units: TemperatureUnits;
};

export type MarketSymbol = { symbol: string; name: string };

export type MarketsWidget = {
  id: string;
  type: 'markets';
  width: number;
  symbols: MarketSymbol[];
};

export type ClockZone = { zone: string; label: string };

export type ClockWidget = {
  id: string;
  type: 'clock';
  width: number;
  zones: ClockZone[];
};

export type HackerNewsWidget = {
  id: string;
  type: 'hackernews';
  width: number;
  count: number;
};

export type CalendarWidget = {
  id: string;
  type: 'calendar';
  width: number;
  /** 0 for Sunday, 1 for Monday. */
  weekStart: 0 | 1;
};

export type Widget =
  | WeatherWidget
  | MarketsWidget
  | ClockWidget
  | HackerNewsWidget
  | CalendarWidget
  | AgendaWidget
  | GithubTrendingWidget
  | BenchmarkWidget
  | PopularTvWidget;
export type WidgetType = Widget['type'];

export const WIDGET_TYPES: readonly WidgetType[] = [
  'weather',
  'markets',
  'clock',
  'calendar',
  'agenda',
  'hackernews',
  'github',
  'benchlm',
  'tv'
];

export const WIDGET_LABELS: Readonly<Record<WidgetType, string>> = {
  weather: 'Weather',
  markets: 'Markets',
  clock: 'World clock',
  calendar: 'Calendar',
  agenda: 'Agenda',
  hackernews: 'Hacker News',
  github: 'GitHub Trending',
  benchlm: 'AI Leaderboard',
  tv: 'Popular TV'
};

export const WIDGET_BLURBS: Readonly<Record<WidgetType, string>> = {
  weather: 'Today at a glance, from Open-Meteo',
  markets: 'Stocks, indices and crypto with a month of trend',
  clock: 'The time where your people are',
  calendar: 'This month, today circled',
  agenda: 'Your Google Calendar: the month, and what is coming up',
  hackernews: 'The top stories right now',
  github: 'The repositories everyone is starring',
  benchlm: 'The strongest AI models right now, from BenchLM',
  tv: 'What everyone is watching, from TMDB'
};

export type SearchEngine = 'google' | 'duckduckgo' | 'bing' | 'brave' | 'kagi' | 'startpage';

export const SEARCH_ENGINES: Readonly<Record<SearchEngine, { label: string; url: string }>> = {
  google: { label: 'Google', url: 'https://www.google.com/search?q=' },
  duckduckgo: { label: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
  bing: { label: 'Bing', url: 'https://www.bing.com/search?q=' },
  brave: { label: 'Brave', url: 'https://search.brave.com/search?q=' },
  kagi: { label: 'Kagi', url: 'https://kagi.com/search?q=' },
  startpage: { label: 'Startpage', url: 'https://www.startpage.com/do/search?q=' }
};

export type Glass = {
  /** Backdrop blur in pixels, 0 to 32. */
  blur: number;
  /** How opaque the glass tint is, 0 to 0.9. */
  tint: number;
};

/** What every page shares: the greeting, search, clock and glass. */
export type DashboardSettings = {
  title: string;
  /** The name in the greeting; empty for a nameless "Good evening". */
  name: string;
  newTab: boolean;
  search: SearchEngine;
  clock: HourFormat;
  glass: Glass;
  /** Whether the side bar stays out, rather than tucking away behind its tab. */
  pinBar: boolean;
  /** Which built-in extensions are off, and which apps are installed. */
  extensions: ExtensionsConfig;
};

/** One page of the board: its own row of widgets and its own groups. */
export type BoardPage = {
  widgets: Widget[];
  groups: Group[];
};

/** The board has this many pages, chosen from the dots along the bottom. */
export const PAGE_COUNT = 3;

export type DashboardConfig = DashboardSettings & {
  /** Always PAGE_COUNT long; a board saved before pages existed becomes the first. */
  pages: BoardPage[];
};

/**
 * One page as the board sees it, with the settings every page shares. Every
 * edit in `edit.ts` works on this, so none of them need to know about pages.
 */
export type PageConfig = DashboardSettings & BoardPage;

export const emptyPage = (): BoardPage => ({ widgets: [], groups: [] });

/** Pads or trims to exactly PAGE_COUNT pages. */
const fillPages = (pages: readonly BoardPage[]): BoardPage[] =>
  Array.from({ length: PAGE_COUNT }, (_unused, index) => pages[index] ?? emptyPage());

export const clampPage = (index: number): number =>
  Number.isInteger(index) ? Math.min(PAGE_COUNT - 1, Math.max(0, index)) : 0;

/** A page with the shared settings, ready for the board and its edits. */
export const pageOf = (config: DashboardConfig, index: number): PageConfig => {
  const { pages, ...settings } = config;
  return { ...settings, ...(pages[clampPage(index)] ?? emptyPage()) };
};

/** Puts an edited page back; a settings change made through it reaches every page. */
export const withPage = (
  config: DashboardConfig,
  index: number,
  page: PageConfig
): DashboardConfig => {
  const { widgets, groups, ...settings } = page;
  const at = clampPage(index);
  return {
    ...settings,
    pages: config.pages.map((current, other) => (other === at ? { widgets, groups } : current))
  };
};

let idCounter = 0;

/** A short id that is unique for this page's lifetime; ids are never stored. */
export const newId = (prefix: string): string => {
  idCounter += 1;
  return `${prefix}${Date.now().toString(36)}${idCounter.toString(36)}`;
};

export const DEFAULT_GLASS: Glass = { blur: 18, tint: 0.32 };

const bookmark = (name: string, url: string, description = '', icon = ''): Bookmark => ({
  id: newId('b'),
  name,
  url,
  description,
  icon
});

/** What a first visit sees: enough to show what the board does, all of it removable. */
export const createStarterConfig = (): DashboardConfig => ({
  title: 'Home',
  name: '',
  newTab: true,
  search: 'google',
  clock: '24h',
  glass: { ...DEFAULT_GLASS },
  pinBar: false,
  extensions: emptyExtensions(),
  pages: fillPages([createStarterPage()])
});

/** The example's first page; the other pages start empty. */
export const createStarterPage = (): BoardPage => ({
  widgets: [
    { id: newId('w'), type: 'weather', width: 4, location: 'London', units: 'metric' },
    {
      id: newId('w'),
      type: 'markets',
      width: 4,
      symbols: [
        { symbol: 'AAPL', name: 'Apple' },
        { symbol: 'NVDA', name: 'NVIDIA' },
        { symbol: 'BTC-USD', name: 'Bitcoin' }
      ]
    },
    { id: newId('w'), type: 'hackernews', width: 4, count: 6 }
  ],
  groups: [
    {
      id: newId('g'),
      name: 'Code',
      icon: '',
      width: 4,
      style: 'cards',
      collapsed: false,
      bookmarks: [
        bookmark('GitHub', 'https://github.com', 'Repositories and pull requests'),
        bookmark('Stack Overflow', 'https://stackoverflow.com', 'Questions and answers'),
        bookmark('MDN', 'https://developer.mozilla.org', 'Web platform docs'),
        bookmark('npm', 'https://www.npmjs.com', 'Package registry')
      ]
    },
    {
      id: newId('g'),
      name: 'Daily',
      icon: '',
      width: 4,
      style: 'tiles',
      collapsed: false,
      bookmarks: [
        bookmark('Gmail', 'https://mail.google.com'),
        bookmark('Calendar', 'https://calendar.google.com'),
        bookmark('Drive', 'https://drive.google.com'),
        bookmark('YouTube', 'https://www.youtube.com'),
        bookmark('Maps', 'https://maps.google.com'),
        bookmark('Photos', 'https://photos.google.com')
      ]
    },
    {
      id: newId('g'),
      name: 'Read',
      icon: '',
      width: 4,
      style: 'list',
      collapsed: false,
      bookmarks: [
        bookmark('Hacker News', 'https://news.ycombinator.com'),
        bookmark('The Verge', 'https://www.theverge.com'),
        bookmark('Lobsters', 'https://lobste.rs'),
        bookmark('Wikipedia', 'https://en.wikipedia.org')
      ]
    }
  ]
});

export const emptyConfig = (): DashboardConfig => ({
  ...createStarterConfig(),
  pages: fillPages([])
});

/* -------------------------------------------------------------------------- */
/* Sanitising                                                                 */
/* -------------------------------------------------------------------------- */

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown, fallback = '', max = 500): string => {
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value).slice(0, max);
  }

  return typeof value === 'string' ? value.trim().slice(0, max) : fallback;
};

const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
  options.includes(value as T) ? (value as T) : fallback;

const clampNumber = (value: unknown, min: number, max: number, fallback: number): number => {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number)
    ? Math.min(max, Math.max(min, number))
    : fallback;
};

export const clampSpan = (value: unknown, fallback = DEFAULT_GROUP_SPAN): number =>
  Math.round(clampNumber(value, MIN_SPAN, GRID_COLUMNS, fallback));

const sanitizeBookmark = (value: unknown): Bookmark | null => {
  if (!isRecord(value)) {
    return null;
  }

  // `href` is what homepage and most other dashboards call it.
  const url = text(value.url ?? value.href, '', 2000);

  if (!url) {
    return null;
  }

  return {
    id: newId('b'),
    name: text(value.name ?? value.title, '', 120) || url,
    url,
    description: text(value.description, '', 240),
    icon: text(value.icon, '', 2000)
  };
};

const sanitizeGroup = (value: unknown): Group | null => {
  if (!isRecord(value)) {
    return null;
  }

  const bookmarks = Array.isArray(value.bookmarks)
    ? value.bookmarks.map(sanitizeBookmark).filter((item): item is Bookmark => item !== null)
    : [];

  return {
    id: newId('g'),
    name: text(value.name, '', 80) || 'Untitled',
    icon: text(value.icon, '', 2000),
    width: clampSpan(value.width),
    style: oneOf(value.style, BOOKMARK_STYLES, 'cards'),
    collapsed: value.collapsed === true,
    bookmarks
  };
};

const sanitizeSymbols = (value: unknown): MarketSymbol[] =>
  (Array.isArray(value) ? value : [])
    .map((item): MarketSymbol | null => {
      if (typeof item === 'string') {
        const symbol = item.trim().toUpperCase().slice(0, 24);
        return symbol ? { symbol, name: '' } : null;
      }

      if (!isRecord(item)) {
        return null;
      }

      const symbol = text(item.symbol, '', 24).toUpperCase();
      return symbol ? { symbol, name: text(item.name, '', 60) } : null;
    })
    .filter((item): item is MarketSymbol => item !== null)
    .slice(0, 12);

const sanitizeZones = (value: unknown): ClockZone[] =>
  (Array.isArray(value) ? value : [])
    .map((item): ClockZone | null => {
      if (typeof item === 'string') {
        const zone = item.trim();
        return zone ? { zone, label: '' } : null;
      }

      if (!isRecord(item)) {
        return null;
      }

      const zone = text(item.zone ?? item.timezone, '', 60);
      return zone ? { zone, label: text(item.label ?? item.name, '', 40) } : null;
    })
    .filter((item): item is ClockZone => item !== null)
    .slice(0, 8);

const sanitizeWidget = (value: unknown): Widget | null => {
  if (!isRecord(value)) {
    return null;
  }

  const id = newId('w');
  const width = clampSpan(value.width, 4);

  switch (value.type) {
    case 'weather':
      return {
        id,
        type: 'weather',
        width,
        location: text(value.location, '', 120),
        units: oneOf(value.units, ['metric', 'imperial'] as const, 'metric')
      };
    case 'markets':
    case 'stocks':
      return {
        id,
        type: 'markets',
        width,
        symbols: sanitizeSymbols(value.symbols ?? value.markets)
      };
    case 'clock':
      return { id, type: 'clock', width, zones: sanitizeZones(value.zones) };
    case 'hackernews':
      return {
        id,
        type: 'hackernews',
        width,
        count: Math.round(clampNumber(value.count, 3, 15, 6))
      };
    case 'calendar':
      return {
        id,
        type: 'calendar',
        width,
        weekStart: value.weekStart === 0 || value.weekStart === 'sunday' ? 0 : 1
      };
    case 'agenda':
      return {
        id,
        type: 'agenda',
        width,
        weekStart: value.weekStart === 0 || value.weekStart === 'sunday' ? 0 : 1,
        count: Math.round(clampNumber(value.count, 3, 12, 5)),
        month: value.month !== false,
        calendars: readCalendarAddresses(value.calendars, CALENDAR_SLOTS)
      };
    case 'github':
      return {
        id,
        type: 'github',
        width,
        language: languageSlug(text(value.language, '', 60)),
        since: oneOf(value.since, TRENDING_SINCE, 'daily'),
        count: Math.round(clampNumber(value.count, 3, 15, 6))
      };
    case 'benchlm':
      return {
        id,
        type: 'benchlm',
        width,
        surface: oneOf(value.surface, BENCH_SURFACES, 'overall'),
        creator: text(value.creator, '', 40),
        count: Math.round(clampNumber(value.count, 3, 15, 5)),
        maxPrice: clampNumber(value.maxPrice, 0, 100, 0)
      };
    case 'tv':
      return {
        id,
        type: 'tv',
        width,
        window: oneOf(value.window, TRENDING_WINDOWS, 'week'),
        count: Math.round(clampNumber(value.count, 3, 12, 5))
      };
    default:
      return null;
  }
};

const sanitizePage = (value: unknown): BoardPage => {
  if (!isRecord(value)) {
    return emptyPage();
  }

  return {
    widgets: (Array.isArray(value.widgets) ? value.widgets : [])
      .map(sanitizeWidget)
      .filter((item): item is Widget => item !== null),
    groups: (Array.isArray(value.groups) ? value.groups : [])
      .map(sanitizeGroup)
      .filter((item): item is Group => item !== null)
  };
};

/** Keeps whatever still makes sense from a stored or imported config, and defaults the rest. */
export const sanitizeConfig = (value: unknown): DashboardConfig => {
  const fallback = emptyConfig();

  if (!isRecord(value)) {
    return fallback;
  }

  const glass = isRecord(value.glass) ? value.glass : {};

  return {
    title: text(value.title, fallback.title, 80) || fallback.title,
    name: text(value.name, '', 60),
    newTab: value.newTab !== false,
    search: oneOf(value.search, Object.keys(SEARCH_ENGINES) as SearchEngine[], 'google'),
    clock: oneOf(value.clock, ['12h', '24h'] as const, '24h'),
    glass: {
      blur: Math.round(clampNumber(glass.blur, 0, 32, DEFAULT_GLASS.blur)),
      tint: Math.round(clampNumber(glass.tint, 0, 0.9, DEFAULT_GLASS.tint) * 100) / 100
    },
    pinBar: value.pinBar === true,
    extensions: sanitizeExtensions(value.extensions),
    // A board saved before it had pages keeps its groups and widgets at the
    // top level; they become the first page.
    pages: fillPages(
      (Array.isArray(value.pages) ? value.pages : [value]).slice(0, PAGE_COUNT).map(sanitizePage)
    )
  };
};

/** Creates a widget of a type with sensible settings. */
export const createWidget = (type: WidgetType): Widget => {
  const id = newId('w');

  switch (type) {
    case 'weather':
      return { id, type, width: 4, location: 'London', units: 'metric' };
    case 'markets':
      return {
        id,
        type,
        width: 4,
        symbols: [
          { symbol: 'SPY', name: 'S&P 500' },
          { symbol: 'AAPL', name: 'Apple' },
          { symbol: 'BTC-USD', name: 'Bitcoin' }
        ]
      };
    case 'clock':
      return {
        id,
        type,
        width: 4,
        zones: [
          { zone: 'America/New_York', label: 'New York' },
          { zone: 'Europe/London', label: 'London' },
          { zone: 'Asia/Tokyo', label: 'Tokyo' }
        ]
      };
    case 'hackernews':
      return { id, type, width: 4, count: 6 };
    case 'calendar':
      return { id, type, width: 3, weekStart: 1 };
    case 'agenda':
      return { id, type, width: 4, weekStart: 1, count: 5, month: true, calendars: [] };
    case 'github':
      return { id, type, width: 4, language: 'all', since: 'daily', count: 6 };
    case 'benchlm':
      return { id, type, width: 4, surface: 'overall', creator: '', count: 5, maxPrice: 0 };
    case 'tv':
      return { id, type, width: 4, window: 'week', count: 5 };
  }
};

export const createGroup = (name: string, style: BookmarkStyle = 'cards'): Group => ({
  id: newId('g'),
  name: name.trim() || 'New group',
  icon: '',
  width: DEFAULT_GROUP_SPAN,
  style,
  collapsed: false,
  bookmarks: []
});

export const createBookmark = (fields: Omit<Bookmark, 'id'>): Bookmark => ({
  id: newId('b'),
  ...fields
});

/** Every page's groups, in page order. */
export const allGroups = (config: DashboardConfig): Group[] =>
  config.pages.flatMap((page) => page.groups);

export const countBookmarks = (config: DashboardConfig): number =>
  allGroups(config).reduce((total, group) => total + group.bookmarks.length, 0);
