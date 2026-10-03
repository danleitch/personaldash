import { describe, expect, it } from 'vitest';
import {
  calendarFeedPath,
  normalizeCalendarAddress,
  readCalendarAddresses
} from './calendar-address';

const SECRET =
  'https://calendar.google.com/calendar/ical/sam%40example.com/private-a1b2c3d4e5f6/basic.ics';
const SECRET_PATH = '/calendar/ical/sam%40example.com/private-a1b2c3d4e5f6/basic.ics';

describe('calendarFeedPath', () => {
  it('gives the path of a secret address, keeping its encoding', () => {
    expect(calendarFeedPath(SECRET)).toBe(SECRET_PATH);
  });

  it('takes a public address, a group calendar and a holiday calendar', () => {
    expect(
      calendarFeedPath('https://calendar.google.com/calendar/ical/abc123/public/basic.ics')
    ).toBe('/calendar/ical/abc123/public/basic.ics');
    expect(
      calendarFeedPath(
        'https://calendar.google.com/calendar/ical/c_x1y2%40group.calendar.google.com/private-0f0f/basic.ics'
      )
    ).toBe('/calendar/ical/c_x1y2%40group.calendar.google.com/private-0f0f/basic.ics');
    expect(
      calendarFeedPath(
        'https://calendar.google.com/calendar/ical/en.usa%23holiday%40group.v.calendar.google.com/public/basic.ics'
      )
    ).toBe('/calendar/ical/en.usa%23holiday%40group.v.calendar.google.com/public/basic.ics');
  });

  it('forgives spaces round it, a webcal:// scheme and a query', () => {
    expect(calendarFeedPath(`  ${SECRET}\n`)).toBe(SECRET_PATH);
    expect(calendarFeedPath(SECRET.replace('https:', 'webcal:'))).toBe(SECRET_PATH);
    expect(calendarFeedPath(`${SECRET}?hl=en`)).toBe(SECRET_PATH);
  });

  it.each([
    ['nothing', ''],
    ['words', 'my calendar'],
    ['a path with no host', '/calendar/ical/sam/public/basic.ics'],
    ['plain http', SECRET.replace('https:', 'http:')],
    ['another host', SECRET.replace('calendar.google.com', 'example.com')],
    [
      'a host that only starts with Google’s',
      SECRET.replace('calendar.google.com', 'calendar.google.com.evil.test')
    ],
    ['a host Google’s is only a prefix of', SECRET.replace('https://', 'https://evil.test/')],
    ['a port', SECRET.replace('google.com', 'google.com:8443')],
    ['a login in front', SECRET.replace('https://', 'https://user:pass@')],
    [
      'an address for the calendar page, not the feed',
      'https://calendar.google.com/calendar/u/0/r'
    ],
    [
      'an .ics that is not a feed',
      'https://calendar.google.com/calendar/ical/sam/private-ab/other.ics'
    ],
    [
      'a key with a slash in it',
      'https://calendar.google.com/calendar/ical/sam/private-a/b/basic.ics'
    ],
    [
      'a calendar id with a slash in it',
      'https://calendar.google.com/calendar/ical/a/b/public/basic.ics'
    ],
    ['no key', 'https://calendar.google.com/calendar/ical/sam/private-/basic.ics'],
    [
      'a private feed with no key word',
      'https://calendar.google.com/calendar/ical/sam/secret-ab/basic.ics'
    ]
  ])('turns away %s', (_what, input) => {
    expect(calendarFeedPath(input)).toBeNull();
  });
});

describe('normalizeCalendarAddress', () => {
  it('keeps an address in one form, whatever it was typed as', () => {
    expect(normalizeCalendarAddress(`  ${SECRET.replace('https:', 'webcal:')}?x=1 `)).toBe(SECRET);
    expect(normalizeCalendarAddress('https://example.com')).toBeNull();
  });
});

describe('readCalendarAddresses', () => {
  const other = SECRET.replace('private-a1b2c3d4e5f6', 'private-ffff');

  it('reads a list, dropping what is not an address, repeats and anything past the limit', () => {
    expect(
      readCalendarAddresses([SECRET, 'nonsense', 42, null, SECRET, other, `${other}?x`, SECRET], 3)
    ).toEqual([SECRET, other]);
    expect(readCalendarAddresses([SECRET, other], 1)).toEqual([SECRET]);
  });

  it('reads a single address written as a string', () => {
    expect(readCalendarAddresses(SECRET, 3)).toEqual([SECRET]);
  });

  it('reads nothing from anything else', () => {
    expect(readCalendarAddresses(undefined, 3)).toEqual([]);
    expect(readCalendarAddresses({ url: SECRET }, 3)).toEqual([]);
    expect(readCalendarAddresses('', 3)).toEqual([]);
  });
});
