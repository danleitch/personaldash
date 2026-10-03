/**
 * The dashboard as YAML: what local storage holds, what the editor shows, and
 * what an export downloads.
 *
 * Ids exist only while the page is open, and fields left at their defaults
 * are left out, so the file reads like something a person wrote.
 */
import { CORE_SCHEMA, dump, load, mergeTag, YAMLException } from 'js-yaml';
import { extensionsToYaml } from './extensions-config';
import {
  allGroups,
  createBookmark,
  createGroup,
  isRecord,
  sanitizeConfig,
  type Bookmark,
  type BoardPage,
  type DashboardConfig,
  type Group,
  type Widget
} from './model';

export const YAML_HEADER = `# Your dashboard: bookmarks, widgets and settings.
# It lives only in this browser's local storage. Export it to keep a copy,
# and import it anywhere to bring everything back.
#
# Bookmark icons: leave "icon" out for the site's own favicon, or use
#   si-github (Simple Icons), mdi-home (Material Design Icons),
#   sh-jellyfin (selfh.st icons), plex.png (dashboard-icons),
#   an emoji like 🚀, or the address of any image.
# Each of the three pages has its own widgets and groups, in order.
# Widths are columns of a 12-column board, from 3 to 12.
#
# An Agenda widget keeps its Google Calendar addresses here. Anyone with an
# address can read that calendar, so keep this file private.
`;

const bookmarkToYaml = (bookmark: Bookmark): Record<string, unknown> => ({
  name: bookmark.name,
  url: bookmark.url,
  ...(bookmark.description ? { description: bookmark.description } : {}),
  ...(bookmark.icon ? { icon: bookmark.icon } : {})
});

const groupToYaml = (group: Group): Record<string, unknown> => ({
  name: group.name,
  ...(group.icon ? { icon: group.icon } : {}),
  width: group.width,
  style: group.style,
  ...(group.collapsed ? { collapsed: true } : {}),
  bookmarks: group.bookmarks.map(bookmarkToYaml)
});

const widgetToYaml = (widget: Widget): Record<string, unknown> => {
  // The id is the page's own; everything else is the widget's settings.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id, ...rest } = widget;
  return rest;
};

const pageToYaml = (page: BoardPage): Record<string, unknown> => ({
  widgets: page.widgets.map(widgetToYaml),
  groups: page.groups.map(groupToYaml)
});

/** The plain object the YAML is written from. */
export const configToObject = (config: DashboardConfig): Record<string, unknown> => ({
  title: config.title,
  ...(config.name ? { name: config.name } : {}),
  newTab: config.newTab,
  search: config.search,
  clock: config.clock,
  glass: { blur: config.glass.blur, tint: config.glass.tint },
  ...(config.pinBar ? { pinBar: true } : {}),
  ...(extensionsToYaml(config.extensions)
    ? { extensions: extensionsToYaml(config.extensions) }
    : {}),
  pages: config.pages.map(pageToYaml)
});

const dumpYaml = (value: unknown): string =>
  dump(value, { indent: 2, lineWidth: 120, noRefs: true, quoteStyle: 'double' });

/**
 * What a file may use: the YAML core types, plus `<<` merge keys, which
 * homepage files lean on and js-yaml 5 no longer reads unless asked.
 */
const READ_SCHEMA = CORE_SCHEMA.withTags(mergeTag);

export const configToYaml = (config: DashboardConfig): string =>
  `${YAML_HEADER}\n${dumpYaml(configToObject(config))}`;

export type YamlProblem = { message: string; line: number | null };

export type ParseResult<T> = { ok: true; value: T } | { ok: false; problem: YamlProblem };

/** Reads YAML (or JSON, which is YAML too), reporting where it went wrong. */
export const readYaml = (text: string): ParseResult<unknown> => {
  try {
    return { ok: true, value: load(text, { schema: READ_SCHEMA }) };
  } catch (error) {
    if (error instanceof YAMLException) {
      return {
        ok: false,
        problem: {
          message: error.reason || 'This is not valid YAML.',
          line: typeof error.mark?.line === 'number' ? error.mark.line + 1 : null
        }
      };
    }

    return { ok: false, problem: { message: 'This is not valid YAML.', line: null } };
  }
};

/** Parses the dashboard's own YAML into a config, insisting it at least looks like one. */
export const yamlToConfig = (text: string): ParseResult<DashboardConfig> => {
  const parsed = readYaml(text);

  if (!parsed.ok) {
    return parsed;
  }

  if (!isRecord(parsed.value)) {
    return {
      ok: false,
      problem: { message: 'Expected settings like "title:" and "pages:" at the top.', line: 1 }
    };
  }

  return { ok: true, value: sanitizeConfig(parsed.value) };
};

/* -------------------------------------------------------------------------- */
/* Backups and imports                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Everything else the app keeps, saved alongside the dashboard in an export so
 * a visitor moving browsers keeps their Branchify settings, pond and koi too.
 * Values are whatever the app stored; each is re-checked by its own parser
 * when the app next reads it.
 */
export type SavedState = Record<string, unknown>;

export type ImportPlan = {
  /** What kind of file this was, for the confirmation. */
  source: 'dashboard' | 'homepage' | 'browser';
  /** The groups the file brings, from every page of a dashboard export. */
  groups: Group[];
  /** A full dashboard export brings its settings and widgets too. */
  config: DashboardConfig | null;
  saved: SavedState | null;
};

export const exportYaml = (config: DashboardConfig, saved: SavedState): string => {
  const savedPart = Object.keys(saved).length
    ? `\n# Branchify, background, pond and koi market state. Safe to delete if you only\n# want to share your bookmarks.\n${dumpYaml({ saved })}`
    : '';

  return `${YAML_HEADER}# Exported ${new Date().toISOString()}\n\n${dumpYaml(configToObject(config))}${savedPart}`;
};

const pickString = (record: Record<string, unknown>, ...keys: string[]): string => {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return '';
};

/**
 * homepage's bookmarks.yaml and services.yaml: a list of one-key maps, group
 * name to a list of one-key maps, item name to its settings (a list holding
 * one map for bookmarks, a map for services).
 */
const homepageGroups = (value: unknown): Group[] | null => {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  const groups: Group[] = [];

  for (const entry of value) {
    if (!isRecord(entry) || Object.keys(entry).length !== 1) {
      return null;
    }

    const [groupName, items] = Object.entries(entry)[0];

    if (!Array.isArray(items)) {
      return null;
    }

    const group = createGroup(groupName);

    for (const item of items) {
      if (!isRecord(item) || Object.keys(item).length !== 1) {
        continue;
      }

      const [name, settings] = Object.entries(item)[0];
      const fields = Array.isArray(settings) ? settings[0] : settings;

      if (!isRecord(fields)) {
        continue;
      }

      const url = pickString(fields, 'href', 'url');

      if (url) {
        group.bookmarks.push(
          createBookmark({
            name,
            url,
            description: pickString(fields, 'description'),
            icon: pickString(fields, 'icon')
          })
        );
      }
    }

    if (group.bookmarks.length > 0) {
      groups.push(group);
    }
  }

  return groups.length > 0 ? groups : null;
};

/** Folders a browser always has, which say nothing about what is in them. */
const BROWSER_ROOTS = new Set([
  'bookmarks bar',
  'bookmarks toolbar',
  'bookmarks menu',
  'other bookmarks',
  'mobile bookmarks',
  'favorites bar',
  'favourites bar',
  'favorites',
  'bookmarks'
]);

/** The folder names an exported link sits in, outermost first. */
const folderPath = (link: Element): string[] => {
  const path: string[] = [];
  let node: Element | null = link.parentElement;

  while (node) {
    if (node.tagName === 'DL') {
      const before = node.previousElementSibling;
      const heading =
        before?.tagName === 'H3'
          ? before
          : node.parentElement?.tagName === 'DT'
            ? node.parentElement.querySelector(':scope > h3')
            : null;

      if (heading?.textContent?.trim()) {
        path.unshift(heading.textContent.trim());
      }
    }

    node = node.parentElement;
  }

  return path;
};

/** The "Netscape" bookmarks.html every browser exports. */
export const browserBookmarkGroups = (html: string): Group[] => {
  const document = new DOMParser().parseFromString(html, 'text/html');
  const groups = new Map<string, Group>();

  for (const link of Array.from(document.querySelectorAll('a[href]'))) {
    const url = link.getAttribute('href') ?? '';

    if (!/^https?:\/\//i.test(url)) {
      continue;
    }

    const path = folderPath(link);
    const meaningful =
      path.length > 1 && BROWSER_ROOTS.has(path[0].toLowerCase()) ? path.slice(1) : path;
    const name = meaningful.join(' / ') || 'Imported';
    const group = groups.get(name) ?? createGroup(name);
    groups.set(name, group);
    group.bookmarks.push(
      createBookmark({
        name: link.textContent?.trim() || url,
        url,
        description: '',
        icon: ''
      })
    );
  }

  return [...groups.values()];
};

const looksLikeBrowserExport = (text: string): boolean =>
  /<!DOCTYPE\s+NETSCAPE-Bookmark-file/i.test(text) || /<DL>\s*<p>/i.test(text);

/** Works out what a dropped or chosen file holds, and what importing it would do. */
export const planImport = (text: string): ParseResult<ImportPlan> => {
  if (looksLikeBrowserExport(text)) {
    const groups = browserBookmarkGroups(text);

    return groups.length > 0
      ? { ok: true, value: { source: 'browser', groups, config: null, saved: null } }
      : { ok: false, problem: { message: 'No bookmarks were found in that file.', line: null } };
  }

  const parsed = readYaml(text);

  if (!parsed.ok) {
    return parsed;
  }

  const homepage = homepageGroups(parsed.value);

  if (homepage) {
    return { ok: true, value: { source: 'homepage', groups: homepage, config: null, saved: null } };
  }

  if (
    isRecord(parsed.value) &&
    ('pages' in parsed.value || 'groups' in parsed.value || 'widgets' in parsed.value)
  ) {
    const config = sanitizeConfig(parsed.value);
    const saved = isRecord(parsed.value.saved) ? parsed.value.saved : null;

    return {
      ok: true,
      value: { source: 'dashboard', groups: allGroups(config), config, saved }
    };
  }

  return {
    ok: false,
    problem: {
      message:
        'That file isn’t a dashboard export, a homepage bookmarks.yaml, or a browser bookmarks file.',
      line: null
    }
  };
};
