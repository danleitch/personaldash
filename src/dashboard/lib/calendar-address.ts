/**
 * A Google Calendar's "secret address in iCal format", which the Agenda widget
 * reads. The address is the key to the calendar, and the relay that fetches it
 * for the page must never be a way to fetch anything else, so only Google
 * Calendar's own feed addresses pass, and the relay is given the path alone: it
 * adds the host itself. nginx.conf holds the same pattern.
 */
export const CALENDAR_HOST = 'calendar.google.com';

/** /calendar/ical/<calendar id>/private-<key>/basic.ics, or .../public/basic.ics for a public one. */
export const CALENDAR_FEED_PATH =
  /^\/calendar\/ical\/[A-Za-z0-9%_.@-]{1,200}\/(?:private-[A-Za-z0-9]{1,100}|public)\/basic\.ics$/;

/** The header the page names its calendar in, so the address never appears in a URL or a log. */
export const CALENDAR_HEADER = 'X-Calendar-Feed';

/**
 * The path of a calendar's address, or null when what was typed is not one:
 * another host, another kind of address, or anything but the feed itself. A
 * webcal:// address is the same feed, which some calendars hand out.
 */
export const calendarFeedPath = (input: string): string | null => {
  let address: URL;

  try {
    address = new URL(input.trim().replace(/^webcal:/i, 'https:'));
  } catch {
    return null;
  }

  if (
    address.protocol !== 'https:' ||
    address.hostname !== CALENDAR_HOST ||
    address.port ||
    address.username ||
    address.password
  ) {
    return null;
  }

  return CALENDAR_FEED_PATH.test(address.pathname) ? address.pathname : null;
};

/** An address in the one form it is kept in, or null when it isn't one. */
export const normalizeCalendarAddress = (input: string): string | null => {
  const path = calendarFeedPath(input);
  return path ? `https://${CALENDAR_HOST}${path}` : null;
};

/** Up to `max` distinct valid addresses from whatever a hand-edited file holds, in order. */
export const readCalendarAddresses = (value: unknown, max: number): string[] => {
  const given = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  const found: string[] = [];

  for (const item of given) {
    const address = typeof item === 'string' ? normalizeCalendarAddress(item) : null;

    if (address && !found.includes(address)) {
      found.push(address);
    }
  }

  return found.slice(0, max);
};
