import { describe, expect, it, vi } from 'vitest';
import {
  agendaWindow,
  fetchAgenda,
  findMeetingLink,
  isAddress,
  plainText,
  readCalendar,
  type AgendaEvent
} from './agenda';

const signal = new AbortController().signal;

/** The suite runs in UTC, so 8:00 below is 8:00 on the clock too. */
const at = (day: number, hour = 0, minute = 0): number =>
  new Date(2026, 9, day, hour, minute).getTime();

const WINDOW = { from: new Date(2026, 8, 1).getTime(), to: new Date(2027, 2, 1).getTime() };

const ZONE = `BEGIN:VTIMEZONE
TZID:Africa/Johannesburg
BEGIN:STANDARD
TZOFFSETFROM:+0200
TZOFFSETTO:+0200
TZNAME:SAST
DTSTART:19700101T000000
END:STANDARD
END:VTIMEZONE`;

const event = (...lines: string[]): string => ['BEGIN:VEVENT', ...lines, 'END:VEVENT'].join('\n');

const feed = (name: string, ...events: string[]): string =>
  [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    ...(name ? [`X-WR-CALNAME:${name}`] : []),
    ZONE,
    ...events,
    'END:VCALENDAR'
  ]
    .join('\n')
    .replace(/\n/g, '\r\n');

const read = async (
  text: string,
  slot = 1,
  window = WINDOW
): Promise<{ name: string; events: AgendaEvent[] }> => {
  const library = (await import('ical.js')).default;
  return readCalendar(library, text, slot, window.from, window.to);
};

const titles = (events: AgendaEvent[]): string[] => events.map((item) => item.title);

describe('plainText', () => {
  it('turns the HTML calendars send into plain lines', () => {
    expect(
      plainText(
        'Agenda:<br>1. Plan<br/>2. Ship &amp; celebrate<p>Bring <b>notes</b></p><p>Thanks</p>'
      )
    ).toBe('Agenda:\n1. Plan\n2. Ship & celebrate\nBring notes\n\nThanks');
  });

  it('decodes the usual entities once, and leaves a bare angle bracket alone', () => {
    expect(plainText('5 &lt; 6 &amp;lt; 7 &quot;ok&quot; it&#39;s&nbsp;fine, 1 < 2')).toBe(
      '5 < 6 &lt; 7 "ok" it\'s fine, 1 < 2'
    );
  });

  it('tidies runs of spaces and blank lines', () => {
    expect(plainText('  a   b \n\n\n\n c  ')).toBe('a b\n\nc');
  });

  it('shortens a long text with an ellipsis', () => {
    const shortened = plainText('word '.repeat(200), 20);
    expect(shortened).toHaveLength(20);
    expect(shortened.endsWith('…')).toBe(true);
  });
});

describe('findMeetingLink', () => {
  it('finds a video call among other links', () => {
    expect(
      findMeetingLink(
        'Notes: https://docs.google.com/document/d/1',
        'Join: <a href="https://meet.google.com/abc-defg-hij">here</a>'
      )
    ).toBe('https://meet.google.com/abc-defg-hij');
  });

  it.each([
    'https://acme.zoom.us/j/123?pwd=x',
    'https://teams.microsoft.com/l/meetup-join/abc',
    'https://whereby.com/room',
    'https://meet.jit.si/Standup',
    'https://acme.webex.com/meet/dan'
  ])('knows %s', (link) => {
    expect(findMeetingLink(`Call ${link}.`)).toBe(link);
  });

  it('drops the punctuation a sentence puts after an address', () => {
    expect(findMeetingLink('(https://meet.google.com/abc-defg-hij).')).toBe(
      'https://meet.google.com/abc-defg-hij'
    );
  });

  it('is empty when there is no call, or the address is not one', () => {
    expect(findMeetingLink('', 'https://example.com/zoom.us', 'https://[broken')).toBe('');
  });
});

describe('isAddress', () => {
  it('is true only for a whole web address', () => {
    expect(isAddress('https://zoom.us/j/1')).toBe(true);
    expect(isAddress('Room 4, https://zoom.us/j/1')).toBe(false);
    expect(isAddress('Cape Town')).toBe(false);
  });
});

describe('agendaWindow', () => {
  it('runs from the first of last month to the end of the month four ahead', () => {
    const { from, to } = agendaWindow(new Date(2026, 9, 17, 14, 30));
    expect(new Date(from)).toEqual(new Date(2026, 8, 1));
    expect(new Date(to)).toEqual(new Date(2027, 2, 1));
  });

  it('crosses the new year', () => {
    const { from, to } = agendaWindow(new Date(2026, 0, 5));
    expect(new Date(from)).toEqual(new Date(2025, 11, 1));
    expect(new Date(to)).toEqual(new Date(2026, 5, 1));
  });
});

describe('readCalendar', () => {
  it('names the calendar and reads a timed event with its details', async () => {
    const { name, events } = await read(
      feed(
        'Dan Leitch',
        event(
          'UID:one@google.com',
          'DTSTART:20261003T080000Z',
          'DTEND:20261003T093000Z',
          'SUMMARY:Planning',
          'LOCATION:Room 4\\, Cape Town',
          'DESCRIPTION:Bring notes<br>and &amp; coffee',
          'X-GOOGLE-CONFERENCE:https://meet.google.com/abc-defg-hij'
        )
      )
    );

    expect(name).toBe('Dan Leitch');
    expect(events).toEqual([
      {
        id: `1:one@google.com:${at(3, 8)}`,
        calendar: 0,
        title: 'Planning',
        allDay: false,
        start: at(3, 8),
        end: at(3, 9, 30),
        location: 'Room 4, Cape Town',
        description: 'Bring notes\nand & coffee',
        link: 'https://meet.google.com/abc-defg-hij'
      }
    ]);
  });

  it('reads the zone an event names from the feed', async () => {
    const { events } = await read(
      feed(
        '',
        event(
          'UID:zoned@google.com',
          'DTSTART;TZID=Africa/Johannesburg:20261003T100000',
          'DTEND;TZID=Africa/Johannesburg:20261003T110000',
          'SUMMARY:Local'
        )
      )
    );

    expect(events[0].start).toBe(at(3, 8));
  });

  it('puts an all-day event on local midnights, the end being the day after its last', async () => {
    const { events } = await read(
      feed(
        '',
        event(
          'UID:trip@google.com',
          'DTSTART;VALUE=DATE:20261005',
          'DTEND;VALUE=DATE:20261008',
          'SUMMARY:Trip'
        ),
        event('UID:lone@google.com', 'DTSTART;VALUE=DATE:20261009', 'SUMMARY:Holiday')
      )
    );

    expect(events).toMatchObject([
      { title: 'Trip', allDay: true, start: at(5), end: at(8) },
      { title: 'Holiday', allDay: true, start: at(9), end: at(10) }
    ]);
  });

  it('gives an event with no end no length, and no title a placeholder', async () => {
    const { events } = await read(
      feed('', event('UID:bare@google.com', 'DTSTART:20261004T120000Z'))
    );

    expect(events).toMatchObject([{ title: '(No title)', start: at(4, 12), end: at(4, 12) }]);
  });

  it('repeats a series, skipping the dates taken out of it', async () => {
    const { events } = await read(
      feed(
        '',
        event(
          'UID:standup@google.com',
          'DTSTART;TZID=Africa/Johannesburg:20260921T093000',
          'DTEND;TZID=Africa/Johannesburg:20260921T100000',
          'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261012T000000Z',
          'EXDATE;TZID=Africa/Johannesburg:20261005T093000',
          'SUMMARY:Standup'
        )
      )
    );

    expect(events.map((item) => item.start)).toEqual([
      new Date(2026, 8, 21, 7, 30).getTime(),
      new Date(2026, 8, 23, 7, 30).getTime(),
      new Date(2026, 8, 28, 7, 30).getTime(),
      new Date(2026, 8, 30, 7, 30).getTime(),
      at(7, 7, 30)
    ]);
  });

  it('applies a change to one day of a series, and keeps ids apart', async () => {
    const { events } = await read(
      feed(
        '',
        event(
          'UID:standup@google.com',
          'DTSTART:20261005T073000Z',
          'DTEND:20261005T080000Z',
          'RRULE:FREQ=WEEKLY;COUNT=3',
          'SUMMARY:Standup'
        ),
        event(
          'UID:standup@google.com',
          'RECURRENCE-ID:20261012T073000Z',
          'DTSTART:20261012T110000Z',
          'DTEND:20261012T113000Z',
          'SUMMARY:Standup (moved)'
        ),
        event(
          'UID:standup@google.com',
          'RECURRENCE-ID:20261019T073000Z',
          'DTSTART:20261019T073000Z',
          'DTEND:20261019T080000Z',
          'STATUS:CANCELLED',
          'SUMMARY:Standup'
        )
      )
    );

    expect(events.map((item) => [item.title, item.start])).toEqual([
      ['Standup', at(5, 7, 30)],
      ['Standup (moved)', at(12, 11)]
    ]);
    expect(new Set(events.map((item) => item.id)).size).toBe(2);
  });

  it('shows a change to a series that is not in the feed as an event of its own', async () => {
    const { events } = await read(
      feed(
        '',
        event(
          'UID:theirs@google.com',
          'RECURRENCE-ID:20261008T073000Z',
          'DTSTART:20261008T090000Z',
          'DTEND:20261008T100000Z',
          'SUMMARY:Their review'
        )
      )
    );

    expect(titles(events)).toEqual(['Their review']);
  });

  it('repeats a birthday every year', async () => {
    const { events } = await read(
      feed(
        '',
        event(
          'UID:bday@google.com',
          'DTSTART;VALUE=DATE:20151012',
          'DTEND;VALUE=DATE:20151013',
          'RRULE:FREQ=YEARLY',
          'SUMMARY:Sam’s birthday'
        )
      )
    );

    expect(events).toMatchObject([{ allDay: true, start: at(12) }]);
  });

  it('leaves out cancelled events and everything outside the window', async () => {
    const { events } = await read(
      feed(
        '',
        event('UID:a@x', 'DTSTART:20261004T100000Z', 'STATUS:CANCELLED', 'SUMMARY:Cancelled'),
        event('UID:b@x', 'DTSTART:20250101T100000Z', 'DTEND:20250101T110000Z', 'SUMMARY:Long ago'),
        event('UID:c@x', 'DTSTART:20290101T100000Z', 'DTEND:20290101T110000Z', 'SUMMARY:Far off'),
        event('UID:d@x', 'DTSTART:20260831T230000Z', 'DTEND:20260901T000000Z', 'SUMMARY:Just over'),
        event(
          'UID:e@x',
          'DTSTART:20260831T230000Z',
          'DTEND:20260901T010000Z',
          'SUMMARY:Runs into it'
        ),
        event('UID:f@x', 'DTSTART:20260901T000000Z', 'SUMMARY:On the dot'),
        event('UID:g@x', 'DTSTART:20261003T080000Z', 'DTEND:20261003T090000Z', 'SUMMARY:Kept')
      )
    );

    expect(titles(events)).toEqual(['Runs into it', 'On the dot', 'Kept']);
  });

  it('orders events by start, then by title, and ignores events with unreadable times', async () => {
    const { events } = await read(
      feed(
        '',
        event('UID:b@x', 'DTSTART:20261003T080000Z', 'SUMMARY:Beta'),
        event('UID:a@x', 'DTSTART:20261003T080000Z', 'SUMMARY:Alpha'),
        event('UID:c@x', 'DTSTART:20261002T080000Z', 'SUMMARY:Earlier')
      )
    );

    expect(titles(events)).toEqual(['Earlier', 'Alpha', 'Beta']);
  });

  it('finds a call in the description or location when the feed names none', async () => {
    const { events } = await read(
      feed(
        '',
        event(
          'UID:a@x',
          'DTSTART:20261003T080000Z',
          'SUMMARY:Zoom',
          'DESCRIPTION:Join <a href="https://acme.zoom.us/j/9">here</a>'
        ),
        event(
          'UID:b@x',
          'DTSTART:20261003T090000Z',
          'SUMMARY:Teams',
          'LOCATION:https://teams.microsoft.com/l/meetup-join/xyz'
        ),
        event(
          'UID:c@x',
          'DTSTART:20261003T100000Z',
          'SUMMARY:Linked',
          'URL:https://whereby.com/dan',
          'X-GOOGLE-CONFERENCE:not an address'
        ),
        event('UID:d@x', 'DTSTART:20261003T110000Z', 'SUMMARY:Plain')
      )
    );

    expect(events.map((item) => item.link)).toEqual([
      'https://acme.zoom.us/j/9',
      'https://teams.microsoft.com/l/meetup-join/xyz',
      'https://whereby.com/dan',
      ''
    ]);
  });

  it('stops a rule that never ends from running away', async () => {
    const started = Date.now();
    const { events } = await read(
      feed(
        '',
        event(
          'UID:busy@x',
          'DTSTART:20260101T000000Z',
          'DTEND:20260101T000100Z',
          'RRULE:FREQ=MINUTELY',
          'SUMMARY:Busy'
        )
      )
    );

    expect(events).toHaveLength(0);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('keeps no more than six hundred events a calendar', async () => {
    const { events } = await read(
      feed(
        '',
        event(
          'UID:daily@x',
          'DTSTART:20260901T080000Z',
          'DTEND:20260901T090000Z',
          'RRULE:FREQ=HOURLY;COUNT=900',
          'SUMMARY:Hourly'
        )
      )
    );

    expect(events).toHaveLength(600);
  });

  it('numbers the calendar by its slot', async () => {
    const { events } = await read(feed('', event('UID:a@x', 'DTSTART:20261003T080000Z')), 3);
    expect(events[0].calendar).toBe(2);
    expect(events[0].id.startsWith('3:')).toBe(true);
  });
});

describe('fetchAgenda', () => {
  const now = new Date(2026, 9, 3, 12);

  const home =
    'https://calendar.google.com/calendar/ical/sam%40example.com/private-aaa111/basic.ics';
  const work =
    'https://calendar.google.com/calendar/ical/work%40example.com/private-bbb222/basic.ics';
  const club = 'https://calendar.google.com/calendar/ical/club%40example.com/public/basic.ics';

  const reply = (body: string, init: ResponseInit = {}): Response =>
    new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/calendar; charset=utf-8' },
      ...init
    });

  /** Answers /api/calendar/1, /2 and /3 in turn; a function answer can throw. */
  const serve = (...answers: Array<Response | (() => Response)>): ReturnType<typeof vi.fn> => {
    const fetchMock = vi.fn((url: string) => {
      const answer = answers[Number(url.split('/').pop()) - 1];
      return typeof answer === 'function'
        ? Promise.resolve().then(answer)
        : Promise.resolve(answer ?? reply('', { status: 500 }));
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };

  const planning = feed(
    'Home',
    event('UID:a@x', 'DTSTART:20261003T150000Z', 'DTEND:20261003T160000Z', 'SUMMARY:Planning')
  );
  const review = feed(
    '',
    event('UID:b@x', 'DTSTART:20261004T150000Z', 'DTEND:20261004T160000Z', 'SUMMARY:Review')
  );

  it('asks the relay for each address it is given, naming the feed by its path in a header', async () => {
    const fetchMock = serve(reply(planning), reply(review));
    await fetchAgenda(now, [home, work], signal);

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/calendar/1',
      '/api/calendar/2'
    ]);
    expect(fetchMock.mock.calls.map(([, init]) => init.headers)).toEqual([
      { 'X-Calendar-Feed': '/calendar/ical/sam%40example.com/private-aaa111/basic.ics' },
      { 'X-Calendar-Feed': '/calendar/ical/work%40example.com/private-bbb222/basic.ics' }
    ]);
  });

  it('never puts an address in the URL it asks for, or lets a cache keep the answer', async () => {
    const fetchMock = serve(reply(planning));
    await fetchAgenda(now, [home], signal);

    expect(fetchMock.mock.calls[0]![0]).not.toContain('private');
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ cache: 'no-store', signal });
  });

  it('asks for no more than three calendars', async () => {
    const fetchMock = serve(reply(planning), reply(review), reply(planning), reply(review));
    await fetchAgenda(now, [home, work, club, home], signal);

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('reads one calendar', async () => {
    serve(reply(planning));

    await expect(fetchAgenda(now, [home], signal)).resolves.toMatchObject({
      calendars: [{ slot: 1, name: 'Home', ok: true }],
      events: [{ title: 'Planning', calendar: 0 }]
    });
  });

  it('merges several calendars, naming an unnamed one by its slot', async () => {
    serve(reply(planning), reply(review));
    const data = await fetchAgenda(now, [home, work], signal);

    expect(data.calendars).toEqual([
      { slot: 1, name: 'Home', ok: true },
      { slot: 2, name: 'Calendar 2', ok: true }
    ]);
    expect(data.events.map((item) => [item.title, item.calendar])).toEqual([
      ['Planning', 0],
      ['Review', 1]
    ]);
  });

  it.each([400, 401, 403, 404])(
    'keeps the calendars that answered when Google or the relay refuses another with %i',
    async (status) => {
      serve(reply(planning), reply('', { status }));
      const data = await fetchAgenda(now, [home, work], signal);

      expect(data.calendars).toEqual([
        { slot: 1, name: 'Home', ok: true },
        { slot: 2, name: 'Calendar 2', ok: false }
      ]);
      expect(titles(data.events)).toEqual(['Planning']);
    }
  );

  it('keeps the calendars that answered when another does not', async () => {
    serve(reply(planning), reply('', { status: 502 }), () => {
      throw new TypeError('Failed to fetch');
    });
    const data = await fetchAgenda(now, [home, work, club], signal);

    expect(data.calendars).toEqual([
      { slot: 1, name: 'Home', ok: true },
      { slot: 2, name: 'Calendar 2', ok: false },
      { slot: 3, name: 'Calendar 3', ok: false }
    ]);
    expect(titles(data.events)).toEqual(['Planning']);
  });

  it('counts a feed it cannot read as one that did not answer', async () => {
    serve(
      reply(planning),
      reply('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nEND:VCALENDAR'),
      reply('<html>an error page</html>', { headers: { 'content-type': 'text/plain' } })
    );
    const data = await fetchAgenda(now, [home, work, club], signal);

    expect(data.calendars.map((calendar) => calendar.ok)).toEqual([true, false, false]);
  });

  it('turns away an address that is not Google Calendar’s without asking the relay', async () => {
    const fetchMock = serve(reply(planning));

    await expect(
      fetchAgenda(now, ['https://example.com/calendar/ical/a/public/basic.ics'], signal)
    ).rejects.toThrow('Google Calendar didn’t accept the address.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks for an address when there are none', async () => {
    const fetchMock = serve();

    await expect(fetchAgenda(now, [], signal)).rejects.toThrow(
      'Add a calendar address in this widget’s settings.'
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('says the host has no relay when it answers with its own page', async () => {
    serve(reply('<!doctype html>', { headers: { 'content-type': 'text/html' } }));

    await expect(fetchAgenda(now, [home], signal)).rejects.toThrow(
      'The Agenda goes through this dashboard’s server, which this host doesn’t provide.'
    );
  });

  it('says when Google does not know the address, as after a reset', async () => {
    serve(reply('', { status: 404 }));

    await expect(fetchAgenda(now, [home], signal)).rejects.toThrow(
      'Google Calendar didn’t accept the address. If you reset the secret address, paste the new one in this widget’s settings.'
    );
  });

  it('says when Google does not answer at all', async () => {
    serve(reply('', { status: 500 }));

    await expect(fetchAgenda(now, [home], signal)).rejects.toThrow(
      'Google Calendar didn’t answer.'
    );
  });

  it('passes an abort on rather than calling it a failure', async () => {
    const controller = new AbortController();
    controller.abort();
    serve(() => {
      throw new DOMException('Aborted', 'AbortError');
    });

    await expect(fetchAgenda(now, [home], controller.signal)).rejects.toThrow('Aborted');
  });
});
