import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchAgenda, type AgendaCalendar, type AgendaData, type AgendaEvent } from '../lib/agenda';
import { createWidget, type AgendaWidget as AgendaConfig } from '../lib/model';
import { AgendaWidget } from './agenda-widget';

vi.mock('../lib/agenda', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/agenda')>()),
  fetchAgenda: vi.fn()
}));

// Saturday 3 October 2026, 17:32 (the suite runs in UTC).
const NOW = new Date(2026, 9, 3, 17, 32);

const at = (day: number, hour = 0, minute = 0, month = 10): number =>
  new Date(2026, month - 1, day, hour, minute).getTime();

let counter = 0;

const event = (
  title: string,
  start: number,
  end: number,
  rest: Partial<AgendaEvent> = {}
): AgendaEvent => ({
  id: `e${(counter += 1)}`,
  calendar: 0,
  title,
  allDay: false,
  start,
  end,
  location: '',
  description: '',
  link: '',
  ...rest
});

const allDay = (
  title: string,
  day: number,
  days = 1,
  rest: Partial<AgendaEvent> = {}
): AgendaEvent => event(title, at(day), at(day + days), { allDay: true, ...rest });

const MEET = 'https://meet.google.com/abc-defg-hij';

const events = (): AgendaEvent[] => [
  event('Morning run', at(3, 6, 30), at(3, 7, 15), { location: 'Sea Point Promenade' }),
  event('Design review', at(3, 17), at(3, 18), {
    location: 'Studio B, 2nd floor',
    description: 'Walk through the calendar.\nBring feedback.',
    link: MEET
  }),
  event('Sprint planning', at(3, 18, 15), at(3, 19), { calendar: 1 }),
  event('Dinner with Sam', at(3, 19, 30), at(3, 21), { location: 'Kloof Street House' }),
  allDay('Sam’s birthday', 4),
  allDay('Cape Town trip', 6, 3),
  event('Flight', at(9, 22), at(10, 7, 30)),
  event('Dentist', at(20, 15), at(20, 15, 45), { location: 'https://zoom.us/j/123' })
];

const CALENDARS: AgendaCalendar[] = [
  { slot: 1, name: 'Dan Leitch', ok: true },
  { slot: 2, name: 'Work', ok: true }
];

const data = (rest: Partial<AgendaData> = {}): AgendaData => ({
  events: events(),
  calendars: CALENDARS,
  ...rest
});

const HOME = 'https://calendar.google.com/calendar/ical/sam%40example.com/private-aaa111/basic.ics';
const WORK =
  'https://calendar.google.com/calendar/ical/work%40example.com/private-bbb222/basic.ics';

const widgetOf = (patch: Partial<AgendaConfig> = {}): AgendaConfig => ({
  ...(createWidget('agenda') as AgendaConfig),
  calendars: [HOME],
  ...patch
});

const show = (patch: Partial<AgendaConfig> = {}, clock: '12h' | '24h' = '24h', newTab = false) =>
  render(<AgendaWidget widget={widgetOf(patch)} clock={clock} newTab={newTab} />);

const loaded = async (patch: Partial<AgendaConfig> = {}, answer: AgendaData = data()) => {
  vi.mocked(fetchAgenda).mockResolvedValue(answer);
  const view = show(patch);
  await screen.findByRole('grid', { name: /October 2026/ }).catch(() => undefined);
  return view;
};

/** A day's button, by the start of its name: "Saturday, October 3", not also "…October 31". */
const day = (name: string): HTMLElement =>
  screen.getByRole('button', { name: new RegExp(`^${name}(,|$)`) });

const selectedDay = (): string =>
  within(screen.getByRole('grid'))
    .getAllByRole('gridcell')
    .find((cell) => cell.getAttribute('aria-selected') === 'true')!
    .querySelector('button')!
    .getAttribute('aria-label')!;

const heads = (): string[] =>
  Array.from(document.querySelectorAll('.agenda-group-head')).map((head) =>
    Array.from(head.children)
      .map((part) => part.textContent)
      .join(' ')
  );

const row = (title: string): HTMLElement => screen.getByText(title).closest('li')!;

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, shouldAdvanceTime: true });
  vi.mocked(fetchAgenda).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('AgendaWidget', () => {
  describe('before there is anything to show', () => {
    it('shimmers while the calendars load', () => {
      vi.mocked(fetchAgenda).mockReturnValue(new Promise(() => undefined));
      show();

      expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
    });

    it('says what went wrong, and tries again on request', async () => {
      vi.mocked(fetchAgenda).mockRejectedValueOnce(new Error('Google Calendar didn’t answer.'));
      vi.mocked(fetchAgenda).mockResolvedValueOnce(data());
      show();

      expect(await screen.findByRole('alert')).toHaveTextContent('Google Calendar didn’t answer.');

      await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

      expect(await screen.findByText('Design review')).toBeInTheDocument();
    });

    it('asks for the calendars it has addresses for, as of now', async () => {
      await loaded({ calendars: [HOME, WORK] });

      expect(fetchAgenda).toHaveBeenCalledWith(
        expect.any(Date),
        [HOME, WORK],
        expect.any(AbortSignal)
      );
    });

    it('asks for an address, and asks nobody, when it has none', () => {
      show({ calendars: [] });

      expect(
        screen.getByText('Add a calendar address in this widget’s settings.')
      ).toBeInTheDocument();
      expect(fetchAgenda).not.toHaveBeenCalled();
    });

    it('reads afresh when the addresses change, without spelling them out in its cache', async () => {
      vi.mocked(fetchAgenda).mockResolvedValue(data());
      const view = show({ calendars: [HOME] });
      await screen.findByRole('grid', { name: /October 2026/ });

      view.rerender(
        <AgendaWidget widget={widgetOf({ calendars: [HOME, WORK] })} clock="24h" newTab={false} />
      );
      await screen.findByRole('grid', { name: /October 2026/ });

      expect(fetchAgenda).toHaveBeenCalledTimes(2);
      expect(vi.mocked(fetchAgenda).mock.calls[1]?.[1]).toEqual([HOME, WORK]);

      const keys = Object.keys(window.localStorage).filter((key) => key.includes('agenda'));
      expect(keys).toHaveLength(2);
      expect(keys.join()).not.toMatch(/private|aaa111|bbb222|example/);
    });
  });

  describe('the month', () => {
    it('names the month and year, and circles today', async () => {
      await loaded();

      expect(screen.getByRole('heading', { name: /October\s*2026/ })).toBeInTheDocument();
      expect(screen.getByRole('grid', { name: 'October 2026' })).toBeInTheDocument();
      expect(day('Saturday, October 3')).toHaveAttribute('aria-current', 'date');
      expect(day('Saturday, October 3')).toHaveClass('agenda-cell--today', 'agenda-cell--selected');
      expect(day('Sunday, October 4')).not.toHaveAttribute('aria-current');
    });

    it('lays out six weeks, with the days either side of the month dimmed', async () => {
      await loaded();

      const cells = within(screen.getByRole('grid')).getAllByRole('gridcell');

      expect(cells).toHaveLength(42);
      expect(day('Monday, September 28')).toHaveClass('agenda-cell--out');
      expect(day('Sunday, November 8')).toHaveClass('agenda-cell--out');
      expect(day('Monday, October 12')).not.toHaveClass('agenda-cell--out');
    });

    it('starts its weeks on Monday, or on Sunday when asked', async () => {
      const { unmount } = await loaded();
      expect(screen.getAllByRole('columnheader')[0]).toHaveAccessibleName('Monday');
      expect(screen.getAllByRole('columnheader')[6]).toHaveAccessibleName('Sunday');

      unmount();
      window.localStorage.clear();
      await loaded({ weekStart: 0 });

      expect(screen.getAllByRole('columnheader')[0]).toHaveAccessibleName('Sunday');
      expect(day('Sunday, September 27')).toBeInTheDocument();
    });

    it('puts a dot under each day with events, up to three, in the calendars’ colours', async () => {
      await loaded();

      const dots = (name: string): HTMLElement[] =>
        Array.from(day(name).querySelectorAll<HTMLElement>('.agenda-dots span'));

      expect(dots('Saturday, October 3')).toHaveLength(3);
      expect(dots('Sunday, October 4')).toHaveLength(1);
      expect(dots('Monday, October 5')).toHaveLength(0);
      // Design review is the first calendar's, Sprint planning the second's.
      expect(
        dots('Saturday, October 3').map((dot) => dot.style.getPropertyValue('--tone'))
      ).toEqual(['var(--cal-1)', 'var(--cal-1)', 'var(--cal-2)']);
    });

    it('tells a screen reader how many events a day has', async () => {
      await loaded();

      expect(day('Saturday, October 3')).toHaveAccessibleName('Saturday, October 3, 4 events');
      expect(day('Sunday, October 4')).toHaveAccessibleName('Sunday, October 4, 1 event');
      expect(day('Monday, October 5')).toHaveAccessibleName('Monday, October 5');
    });
  });

  describe('picking a day', () => {
    it('lists from that day, and offers a way back to today', async () => {
      await loaded();
      expect(screen.queryByRole('button', { name: 'Today' })).not.toBeInTheDocument();

      await userEvent.click(day('Sunday, October 4'));

      expect(selectedDay()).toBe('Sunday, October 4, 1 event');
      expect(heads()[0]).toMatch(/Tomorrow\s*Oct 4/);
      expect(screen.getByText('Sam’s birthday')).toBeInTheDocument();
      expect(screen.queryByText('Design review')).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Today' }));

      expect(selectedDay()).toBe('Saturday, October 3, 4 events');
      expect(heads()[0]).toMatch(/Today\s*Oct 3/);
      expect(screen.queryByRole('button', { name: 'Today' })).not.toBeInTheDocument();
    });

    it('shows a day with nothing on, then the days that follow', async () => {
      await loaded();

      await userEvent.click(day('Monday, October 5'));

      expect(heads()).toEqual([
        'Monday Oct 5',
        'Tuesday Oct 6',
        'Wednesday Oct 7',
        'Thursday Oct 8',
        'Friday Oct 9',
        'Saturday Oct 10'
      ]);
      expect(screen.getByText('Nothing planned')).toBeInTheDocument();
    });

    it('says which day of a run an all-day event is on', async () => {
      await loaded();
      await userEvent.click(day('Monday, October 5'));

      const trip = screen.getAllByText('Cape Town trip').map((title) => title.closest('li')!);

      expect(trip.map((item) => item.querySelector('.agenda-time small')?.textContent)).toEqual([
        'Day 1/3',
        'Day 2/3',
        'Day 3/3'
      ]);
    });

    it('carries an overnight event over into the day it ends on', async () => {
      await loaded({ count: 12 });
      await userEvent.click(day('Friday, October 9'));

      const first = screen.getAllByText('Flight')[0].closest('li')!;
      expect(within(first).getByText('22:00')).toBeInTheDocument();
      expect(within(first).getByText('→ Sat')).toBeInTheDocument();

      await userEvent.click(day('Saturday, October 10'));

      expect(within(row('Flight')).getByText('Cont.')).toBeInTheDocument();
      expect(within(row('Flight')).getByText('until 07:30')).toBeInTheDocument();
    });

    it('moves to the month of a dimmed day that is picked', async () => {
      await loaded();

      await userEvent.click(day('Monday, September 28'));

      expect(screen.getByRole('grid', { name: 'September 2026' })).toBeInTheDocument();
      expect(selectedDay()).toMatch(/^Monday, September 28(,|$)/);
    });
  });

  describe('turning the month', () => {
    const next = (): HTMLElement => screen.getByRole('button', { name: 'Next month' });
    const previous = (): HTMLElement => screen.getByRole('button', { name: 'Previous month' });

    it('picks the first of the next month, and lists from it', async () => {
      await loaded();

      await userEvent.click(next());

      expect(screen.getByRole('grid', { name: 'November 2026' })).toBeInTheDocument();
      expect(selectedDay()).toBe('Sunday, November 1');
      expect(screen.getByRole('button', { name: 'Today' })).toBeInTheDocument();
      expect(screen.getByText('Nothing planned, and nothing coming up.')).toBeInTheDocument();
    });

    it('comes back to today, not the first, when it returns to this month', async () => {
      await loaded();

      await userEvent.click(next());
      await userEvent.click(previous());

      expect(selectedDay()).toMatch(/^Saturday, October 3(,|$)/);
      expect(screen.queryByRole('button', { name: 'Today' })).not.toBeInTheDocument();
    });

    it('goes back a month, and no further than that', async () => {
      await loaded();

      await userEvent.click(previous());

      expect(screen.getByRole('grid', { name: 'September 2026' })).toBeInTheDocument();
      expect(selectedDay()).toBe('Tuesday, September 1');
      expect(previous()).toBeDisabled();
      expect(next()).toBeEnabled();
    });

    it('goes ahead four months, and no further than that', async () => {
      await loaded();

      for (let step = 0; step < 4; step += 1) {
        await userEvent.click(next());
      }

      expect(screen.getByRole('grid', { name: 'February 2027' })).toBeInTheDocument();
      expect(next()).toBeDisabled();
    });

    it('shows the year when it turns', async () => {
      await loaded();

      for (let step = 0; step < 3; step += 1) {
        await userEvent.click(next());
      }

      expect(screen.getByRole('heading', { name: /January\s*2027/ })).toBeInTheDocument();
      expect(heads()[0]).toMatch(/Friday\s*Jan 1, 2027/);
    });
  });

  describe('with the keyboard', () => {
    it('moves the selection, and the focus with it, by day and week', async () => {
      await loaded();
      day('Saturday, October 3').focus();

      await userEvent.keyboard('{ArrowRight}');
      expect(selectedDay()).toMatch(/^Sunday, October 4(,|$)/);
      expect(day('Sunday, October 4')).toHaveFocus();
      expect(heads()[0]).toMatch(/Tomorrow/);

      await userEvent.keyboard('{ArrowDown}');
      expect(day('Sunday, October 11')).toHaveFocus();

      await userEvent.keyboard('{ArrowUp}{ArrowLeft}');
      expect(day('Saturday, October 3')).toHaveFocus();
    });

    it('goes to the ends of the week, and a month at a time', async () => {
      await loaded();
      day('Saturday, October 3').focus();

      await userEvent.keyboard('{Home}');
      expect(day('Monday, September 28')).toHaveFocus();

      await userEvent.keyboard('{End}');
      expect(day('Sunday, October 4')).toHaveFocus();

      await userEvent.keyboard('{PageDown}');
      expect(day('Wednesday, November 4')).toHaveFocus();
      expect(screen.getByRole('grid', { name: 'November 2026' })).toBeInTheDocument();

      await userEvent.keyboard('{PageUp}{PageUp}');
      expect(day('Friday, September 4')).toHaveFocus();
    });

    it('stays put at the end of what can be browsed', async () => {
      await loaded();
      await userEvent.click(screen.getByRole('button', { name: 'Previous month' }));
      day('Tuesday, September 1').focus();

      await userEvent.keyboard('{ArrowLeft}');

      expect(selectedDay()).toMatch(/^Tuesday, September 1(,|$)/);
      expect(day('Tuesday, September 1')).toHaveFocus();
    });

    it('does not take the focus when the selection is made with the mouse', async () => {
      await loaded();
      await userEvent.click(day('Sunday, October 4'));
      await userEvent.click(document.body);

      expect(document.body).toHaveFocus();
    });

    it('leaves other keys to the page', async () => {
      await loaded();
      day('Saturday, October 3').focus();
      const prevented = fireEvent.keyDown(day('Saturday, October 3'), { key: 'a' });

      expect(prevented).toBe(true);
      expect(selectedDay()).toMatch(/^Saturday, October 3(,|$)/);
    });

    it('lets only the selected day take a tab stop', async () => {
      await loaded();

      const stops = within(screen.getByRole('grid'))
        .getAllByRole('button')
        .filter((button) => button.tabIndex === 0);

      expect(stops).toHaveLength(1);
      expect(stops[0]).toHaveAccessibleName(/Saturday, October 3/);
    });
  });

  describe('the list', () => {
    it('starts with today, and says what is over, on now and next', async () => {
      await loaded();

      expect(heads()[0]).toMatch(/Today\s*Oct 3/);
      expect(row('Morning run')).toHaveClass('agenda-event--past');
      expect(row('Design review')).toHaveClass('agenda-event--live');
      expect(row('Sprint planning')).toHaveClass('agenda-event--next');
      expect(row('Dinner with Sam')).toHaveClass('agenda-event--later');
      expect(within(row('Design review')).getByText('Now')).toBeInTheDocument();
      expect(within(row('Sprint planning')).getByText('in 43 min')).toBeInTheDocument();
      expect(within(row('Dinner with Sam')).queryByText(/^in /)).not.toBeInTheDocument();
      expect(within(row('Morning run')).queryByText('Now')).not.toBeInTheDocument();
    });

    it('shows how far through the event on now it is', async () => {
      await loaded();

      const progress = row('Design review').querySelector<HTMLElement>('.agenda-progress')!;

      expect(progress.style.getPropertyValue('--progress')).toBe('53%');
      expect(row('Sprint planning').querySelector('.agenda-progress')).toBeNull();
    });

    it('gives each event its time, with its place or how long it is', async () => {
      await loaded();

      expect(within(row('Morning run')).getByText('06:30')).toBeInTheDocument();
      expect(within(row('Morning run')).getByText('07:15')).toBeInTheDocument();
      expect(within(row('Morning run')).getByText('Sea Point Promenade')).toBeInTheDocument();
      expect(within(row('Sprint planning')).getByText('45 min')).toBeInTheDocument();
    });

    it('keeps time in the clock the board uses', async () => {
      vi.mocked(fetchAgenda).mockResolvedValue(data());
      render(<AgendaWidget widget={widgetOf()} clock="12h" newTab={false} />);

      expect(await screen.findByText(/6:30\s?AM/i)).toBeInTheDocument();
    });

    it('does not show a call’s address as its place', async () => {
      await loaded();
      await userEvent.click(day('Tuesday, October 20'));

      expect(within(row('Dentist')).getByText('45 min')).toBeInTheDocument();
      expect(screen.queryByText('https://zoom.us/j/123')).not.toBeInTheDocument();
    });

    it('offers to join a call, in this tab or a new one', async () => {
      const { unmount } = await loaded();

      const join = screen.getByRole('link', { name: 'Join Design review' });
      expect(join).toHaveAttribute('href', MEET);
      expect(join).toHaveAttribute('rel', 'noreferrer noopener');
      expect(join).not.toHaveAttribute('target');
      expect(screen.getAllByRole('link', { name: /^Join / })).toHaveLength(1);

      unmount();
      window.localStorage.clear();
      vi.mocked(fetchAgenda).mockResolvedValue(data());
      show({}, '24h', true);

      expect(await screen.findByRole('link', { name: 'Join Design review' })).toHaveAttribute(
        'target',
        '_blank'
      );
    });

    it('stops at the count, and links to the rest of the day', async () => {
      await loaded({ count: 3 });

      expect(document.querySelectorAll('.agenda-event')).toHaveLength(3);
      expect(screen.queryByText('Dinner with Sam')).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: '+1 more' })).toHaveAttribute(
        'href',
        'https://calendar.google.com/calendar/r/day/2026/10/3'
      );
    });

    it('goes on to the next days when today is short of the count', async () => {
      await loaded({ count: 12 });

      expect(heads()).toEqual([
        'Today Oct 3',
        'Tomorrow Oct 4',
        'Tuesday Oct 6',
        'Wednesday Oct 7',
        'Thursday Oct 8',
        'Friday Oct 9',
        'Saturday Oct 10',
        'Tuesday Oct 20'
      ]);
      expect(screen.queryByRole('link', { name: /more/ })).not.toBeInTheDocument();
    });

    it('says when there is nothing on, and nothing coming', async () => {
      await loaded({}, data({ events: [] }));

      expect(
        await screen.findByText('Nothing planned, and nothing coming up.')
      ).toBeInTheDocument();
    });
  });

  describe('opening an event', () => {
    it('shows when and where, the calendar it is on, and its notes', async () => {
      await loaded();

      const button = within(row('Design review')).getByRole('button', { name: /Design review/ });
      expect(button).toHaveAttribute('aria-expanded', 'false');

      await userEvent.click(button);

      expect(button).toHaveAttribute('aria-expanded', 'true');
      const detail = row('Design review').querySelector<HTMLElement>('.agenda-detail')!;
      expect(detail).toHaveTextContent('Sat, Oct 3 · 17:00 – 18:00');
      expect(detail).toHaveTextContent('Dan Leitch');
      expect(detail).toHaveTextContent('Walk through the calendar.');
      expect(within(detail).getByRole('link', { name: 'Studio B, 2nd floor' })).toHaveAttribute(
        'href',
        'https://www.google.com/maps/search/?api=1&query=Studio%20B%2C%202nd%20floor'
      );
    });

    it('closes again, and only one is open at a time', async () => {
      await loaded();
      const open = (title: string): HTMLElement =>
        within(row(title)).getByRole('button', { name: new RegExp(title) });

      await userEvent.click(open('Design review'));
      await userEvent.click(open('Sprint planning'));

      expect(open('Design review')).toHaveAttribute('aria-expanded', 'false');
      expect(open('Sprint planning')).toHaveAttribute('aria-expanded', 'true');
      expect(document.querySelectorAll('.agenda-detail')).toHaveLength(1);

      await userEvent.click(open('Sprint planning'));

      expect(document.querySelectorAll('.agenda-detail')).toHaveLength(0);
    });

    it('shows the calendar’s name only when there are several', async () => {
      await loaded({}, data({ calendars: [CALENDARS[0]] }));

      await userEvent.click(within(row('Design review')).getByRole('button', { name: /Design/ }));

      expect(row('Design review').querySelector('.agenda-detail')).not.toHaveTextContent(
        'Dan Leitch'
      );
    });

    it('leaves out the place and notes an event does not have', async () => {
      await loaded();

      await userEvent.click(within(row('Sprint planning')).getByRole('button', { name: /Sprint/ }));

      const detail = row('Sprint planning').querySelector<HTMLElement>('.agenda-detail')!;
      expect(detail).toHaveTextContent('Sat, Oct 3 · 18:15 – 19:00');
      expect(within(detail).queryByRole('link')).not.toBeInTheDocument();
    });

    it('closes the event when another day is picked', async () => {
      await loaded();
      await userEvent.click(within(row('Design review')).getByRole('button', { name: /Design/ }));

      await userEvent.click(day('Sunday, October 4'));

      expect(document.querySelectorAll('.agenda-detail')).toHaveLength(0);
    });
  });

  describe('the footer', () => {
    it('keys the calendars by colour when there is more than one', async () => {
      await loaded();

      const legend = screen.getByRole('list', { name: 'Calendars' });

      expect(within(legend).getByText('Dan Leitch')).toBeInTheDocument();
      expect(within(legend).getByText('Work')).toBeInTheDocument();
    });

    it('has no key for a single calendar', async () => {
      await loaded({}, data({ calendars: [CALENDARS[0]] }));

      expect(screen.queryByRole('list', { name: 'Calendars' })).not.toBeInTheDocument();
    });

    it('opens the selected day in Google Calendar', async () => {
      await loaded();
      await userEvent.click(day('Sunday, October 4'));

      const link = screen.getByRole('link', { name: /Open Google Calendar/ });

      expect(link).toHaveAttribute('href', 'https://calendar.google.com/calendar/r/day/2026/10/4');
      expect(link).not.toHaveAttribute('target');
    });

    it('says which calendar did not answer, and tries again', async () => {
      vi.mocked(fetchAgenda).mockResolvedValueOnce(
        data({ calendars: [CALENDARS[0], { slot: 2, name: 'Calendar 2', ok: false }] })
      );
      vi.mocked(fetchAgenda).mockResolvedValueOnce(data());
      show();

      expect(await screen.findByRole('status', { name: '' })).toHaveTextContent(
        'Calendar 2 didn’t answer.'
      );
      expect(screen.queryByRole('list', { name: 'Calendars' })).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

      expect(await screen.findByRole('list', { name: 'Calendars' })).toBeInTheDocument();
      expect(screen.queryByText(/didn’t answer/)).not.toBeInTheDocument();
    });

    it('keeps the last look when a refresh fails, and says so', async () => {
      vi.mocked(fetchAgenda).mockResolvedValueOnce(
        data({ calendars: [CALENDARS[0], { slot: 2, name: 'Work', ok: false }] })
      );
      vi.mocked(fetchAgenda).mockRejectedValueOnce(new Error('Google Calendar didn’t answer.'));
      show();
      await screen.findByText(/Work didn’t answer/);

      await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

      expect(
        await screen.findByText('Couldn’t refresh; showing the last look.')
      ).toBeInTheDocument();
      expect(screen.getByText('Design review')).toBeInTheDocument();
    });
  });

  describe('as a list alone', () => {
    it('leaves the month out and lists from today', async () => {
      await loaded({ month: false });

      expect(screen.queryByRole('grid')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Next month' })).not.toBeInTheDocument();
      expect(heads()[0]).toMatch(/Today\s*Oct 3/);
      expect(screen.getByText('Design review')).toBeInTheDocument();
      expect(document.querySelector('.agenda-layout--split')).toBeNull();
    });
  });

  describe('as time passes', () => {
    it('moves on from an event that has ended', async () => {
      await loaded();
      expect(row('Design review')).toHaveClass('agenda-event--live');

      act(() => {
        vi.setSystemTime(new Date(2026, 9, 3, 18, 20));
        vi.advanceTimersByTime(60_000);
      });

      expect(row('Design review')).toHaveClass('agenda-event--past');
      expect(row('Sprint planning')).toHaveClass('agenda-event--live');
    });

    it('is on the new day after midnight, if it was on today', async () => {
      await loaded();
      expect(heads()[0]).toMatch(/Today\s*Oct 3/);

      act(() => {
        vi.setSystemTime(new Date(2026, 9, 4, 0, 5));
        vi.advanceTimersByTime(60_000);
      });

      expect(heads()[0]).toMatch(/Today\s*Oct 4/);
      expect(selectedDay()).toMatch(/^Sunday, October 4(,|$)/);
    });

    it('stays on a day that was picked, after midnight', async () => {
      await loaded();
      await userEvent.click(day('Tuesday, October 6'));

      act(() => {
        vi.setSystemTime(new Date(2026, 9, 4, 0, 5));
        vi.advanceTimersByTime(60_000);
      });

      expect(selectedDay()).toMatch(/^Tuesday, October 6(,|$)/);
      expect(heads()[0]).toMatch(/Tuesday\s*Oct 6/);
    });
  });
});
