/**
 * The Agenda widget's data: up to three Google Calendars, read from the
 * "secret address in iCal format" each one offers. Google's feeds can't be read
 * from a page on another site, so the page asks this site's /api/calendar relay,
 * naming the feed's path in a header; the relay fetches it from Google Calendar
 * alone and keeps it for a few minutes.
 *
 * The feed holds a calendar's whole history, so it is read once, expanded into
 * the months the widget can show, and only that is kept in the page's cache.
 * The iCal parser is a sizeable library and loads the first time it is needed.
 */
import type ICAL from 'ical.js';
import { CALENDAR_HEADER, calendarFeedPath } from './calendar-address';

export type AgendaWidget = {
  id: string;
  type: 'agenda';
  width: number;
  /** 0 for Sunday, 1 for Monday. */
  weekStart: 0 | 1;
  /** How many events the list shows. */
  count: number;
  /** Whether the month shows above the list. */
  month: boolean;
  /** Each calendar's secret address in iCal format; up to CALENDAR_SLOTS, none until one is given. */
  calendars: string[];
};

/** How many calendars the widget can show; the relay serves /api/calendar/1 up to this number. */
export const CALENDAR_SLOTS = 3;

/** The widget browses from this many months back to this many ahead. */
export const MONTHS_BACK = 1;
export const MONTHS_AHEAD = 4;

export type AgendaEvent = {
  /** Unique to this occurrence, so a repeating event has one per day it happens. */
  id: string;
  /** Which calendar it came from, counting from 0; each has its own colour. */
  calendar: number;
  title: string;
  allDay: boolean;
  /** Milliseconds. An all-day event starts at local midnight. */
  start: number;
  /** Milliseconds, exclusive: an all-day event ends at the midnight after its last day. */
  end: number;
  location: string;
  /** Plain text; calendar descriptions often arrive as HTML. */
  description: string;
  /** A video call to join, or empty. */
  link: string;
};

export type AgendaCalendar = {
  slot: number;
  name: string;
  /** False when the calendar is set up but didn't answer this time. */
  ok: boolean;
};

export type AgendaData = {
  events: AgendaEvent[];
  /** The calendars the widget has an address for, in slot order. */
  calendars: AgendaCalendar[];
};

const RELAY = '/api/calendar';
const MAX_EVENTS_PER_CALENDAR = 600;
/** Stops a rule that repeats every second, or never ends, from spinning forever. */
const MAX_OCCURRENCES = 4000;

/** The span the widget reads: from the first of last month to the end of the month four ahead. */
export const agendaWindow = (now: Date): { from: number; to: number } => ({
  from: new Date(now.getFullYear(), now.getMonth() - MONTHS_BACK, 1).getTime(),
  to: new Date(now.getFullYear(), now.getMonth() + MONTHS_AHEAD + 1, 1).getTime()
});

/* -------------------------------------------------------------------------- */
/* Text                                                                       */
/* -------------------------------------------------------------------------- */

const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  '#39': "'"
};

/** A calendar description as plain text: Google writes them as HTML. */
export const plainText = (raw: string, max = 400): string => {
  const text = raw
    .replace(/<\s*br\s*\/?>|<\/?(?:p|div|li|ul|ol|h[1-6])\b[^>]*>/gi, '\n')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(
      /&(amp|lt|gt|quot|apos|nbsp|#39);/gi,
      (_match, name: string) => ENTITIES[name.toLowerCase()]
    )
    .replace(/[ \t\f\v\u00a0]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
};

const MEETING_HOST =
  /^(?:meet\.google\.com|(?:[\w-]+\.)?zoom\.us|teams\.microsoft\.com|teams\.live\.com|(?:[\w-]+\.)?webex\.com|whereby\.com|meet\.jit\.si|gotomeet\.me)$/i;

/** The first video-call address among some text, or empty. */
export const findMeetingLink = (...sources: string[]): string => {
  for (const source of sources) {
    for (const found of source.match(/https?:\/\/[^\s"'<>\\]+/gi) ?? []) {
      const address = found.replace(/[.,;:!?)\]]+$/, '');

      try {
        if (MEETING_HOST.test(new URL(address).hostname)) {
          return address;
        }
      } catch {
        /* not an address after all */
      }
    }
  }

  return '';
};

/** Whether a location is really a web address, as it is for a call. */
export const isAddress = (text: string): boolean => /^https?:\/\/\S+$/i.test(text);

/* -------------------------------------------------------------------------- */
/* Reading a feed                                                             */
/* -------------------------------------------------------------------------- */

type Ical = typeof ICAL;
type IcalEvent = InstanceType<Ical['Event']>;
type IcalTime = InstanceType<Ical['Time']>;

const clip = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

/** One occurrence of an event, or null when it is cancelled, outside the window or has no usable time. */
const occurrence = (
  item: IcalEvent,
  start: IcalTime,
  end: IcalTime,
  slot: number,
  from: number,
  to: number
): AgendaEvent | null => {
  if (String(item.component.getFirstPropertyValue('status')).toUpperCase() === 'CANCELLED') {
    return null;
  }

  const startsAt = start.toJSDate().getTime();
  const endsAt = Math.max(end.toJSDate().getTime(), startsAt);

  // An event with no length is on at its start; one that ends exactly at `from` is already over.
  if (Number.isNaN(startsAt) || Number.isNaN(endsAt) || startsAt >= to) {
    return null;
  }

  if (endsAt <= from && startsAt < from) {
    return null;
  }

  const location = clip(item.location, 200);
  const description = clip(item.description, 4000);
  const conference = clip(item.component.getFirstPropertyValue('x-google-conference'), 500);

  return {
    id: `${slot}:${item.uid}:${startsAt}`,
    calendar: slot - 1,
    title: clip(item.summary, 200) || '(No title)',
    allDay: start.isDate,
    start: startsAt,
    end: endsAt,
    location,
    description: plainText(description),
    link: /^https?:\/\//i.test(conference)
      ? conference
      : findMeetingLink(
          location,
          description,
          clip(item.component.getFirstPropertyValue('url'), 500)
        )
  };
};

/** Expands a feed into the events that fall in a window, with repeats and changes applied. */
export const readCalendar = (
  library: Ical,
  text: string,
  slot: number,
  from: number,
  to: number
): { name: string; events: AgendaEvent[] } => {
  const root = new library.Component(library.parse(text));

  for (const zone of root.getAllSubcomponents('vtimezone')) {
    library.TimezoneService.register(zone);
  }

  // An empty list of exceptions stops each event from searching the whole feed for its own.
  const events = root
    .getAllSubcomponents('vevent')
    .map((component) => new library.Event(component, { exceptions: [] }));
  const masters = new Map<string, IcalEvent>();

  for (const event of events) {
    if (!event.isRecurrenceException()) {
      masters.set(event.uid, event);
    }
  }

  const loose: IcalEvent[] = [];

  for (const event of events) {
    if (!event.isRecurrenceException()) {
      continue;
    }

    // A change to one day of a series; when the series isn't in this feed it stands alone.
    const master = masters.get(event.uid);

    if (master) {
      master.relateException(event);
    } else {
      loose.push(event);
    }
  }

  const found: AgendaEvent[] = [];
  const keep = (item: AgendaEvent | null): void => {
    if (item) {
      found.push(item);
    }
  };

  for (const event of [...masters.values(), ...loose]) {
    if (!event.isRecurring()) {
      keep(occurrence(event, event.startDate, event.endDate, slot, from, to));
      continue;
    }

    const iterator = event.iterator();

    for (
      let step = 0, next = iterator.next();
      next && step < MAX_OCCURRENCES;
      next = iterator.next(), step += 1
    ) {
      if (next.toJSDate().getTime() >= to) {
        break;
      }

      const details = event.getOccurrenceDetails(next);
      keep(occurrence(details.item, details.startDate, details.endDate, slot, from, to));
    }
  }

  found.sort((a, b) => a.start - b.start || a.title.localeCompare(b.title));

  return {
    name: clip(root.getFirstPropertyValue('x-wr-calname'), 80),
    events: found.slice(0, MAX_EVENTS_PER_CALENDAR)
  };
};

/* -------------------------------------------------------------------------- */
/* Fetching                                                                   */
/* -------------------------------------------------------------------------- */

type SlotResult =
  | { kind: 'ok'; name: string; events: AgendaEvent[] }
  | { kind: 'no-relay' | 'rejected' | 'failed' };

const fetchSlot = async (
  library: Ical,
  slot: number,
  address: string,
  window: { from: number; to: number },
  signal: AbortSignal
): Promise<SlotResult> => {
  const path = calendarFeedPath(address);

  // Settings only keep addresses that pass, but a hand-edited file can hold anything.
  if (!path) {
    return { kind: 'rejected' };
  }

  let response: Response;

  try {
    // The feed is private and the address is in a header, which a cache doesn't tell apart.
    response = await fetch(`${RELAY}/${slot}`, {
      signal,
      cache: 'no-store',
      headers: { [CALENDAR_HEADER]: path }
    });
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }

    return { kind: 'failed' };
  }

  // The relay turns away an address that isn't Google Calendar's (400), and Google says it doesn't
  // know one that was reset (404) or that isn't shared with the page (401 or 403).
  if ([400, 401, 403, 404].includes(response.status)) {
    return { kind: 'rejected' };
  }

  if (!response.ok) {
    return { kind: 'failed' };
  }

  const text = await response.text();

  // A host without the relay answers every address with the dashboard's own page.
  if (!/^\s*BEGIN:VCALENDAR/i.test(text)) {
    return {
      kind: (response.headers.get('content-type') ?? '').includes('html') ? 'no-relay' : 'failed'
    };
  }

  try {
    return { kind: 'ok', ...readCalendar(library, text, slot, window.from, window.to) };
  } catch {
    return { kind: 'failed' };
  }
};

export const fetchAgenda = async (
  now: Date,
  addresses: readonly string[],
  signal: AbortSignal
): Promise<AgendaData> => {
  const library = (await import('ical.js')).default;
  const window = agendaWindow(now);
  const results = await Promise.all(
    addresses
      .slice(0, CALENDAR_SLOTS)
      .map((address, index) => fetchSlot(library, index + 1, address, window, signal))
  );
  const answered = results.filter((result) => result.kind === 'ok');

  if (answered.length === 0) {
    const kinds = results.map((result) => result.kind);

    if (kinds.includes('no-relay')) {
      throw new Error(
        'The Agenda goes through this dashboard’s server, which this host doesn’t provide.'
      );
    }

    if (kinds.includes('rejected')) {
      throw new Error(
        'Google Calendar didn’t accept the address. If you reset the secret address, paste the new one in this widget’s settings.'
      );
    }

    if (kinds.includes('failed')) {
      throw new Error('Google Calendar didn’t answer.');
    }

    throw new Error('Add a calendar address in this widget’s settings.');
  }

  const calendars: AgendaCalendar[] = [];
  const events: AgendaEvent[] = [];

  results.forEach((result, index) => {
    const slot = index + 1;
    calendars.push({
      slot,
      name: result.kind === 'ok' ? result.name || `Calendar ${slot}` : `Calendar ${slot}`,
      ok: result.kind === 'ok'
    });

    if (result.kind === 'ok') {
      events.push(...result.events);
    }
  });

  return { events, calendars };
};
