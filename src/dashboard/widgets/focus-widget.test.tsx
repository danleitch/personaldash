import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FOCUS_KEY,
  chime,
  dayOf,
  freshState,
  prepareChime,
  type FocusState,
  type FocusWidget as FocusConfig
} from '../lib/focus';
import { createWidget } from '../lib/model';
import { FocusWidget } from './focus-widget';

vi.mock('../lib/focus', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/focus')>()),
  chime: vi.fn(),
  prepareChime: vi.fn()
}));

const MIN = 60_000;
const NOON = new Date(2026, 9, 3, 12, 0, 0);

const widgetOf = (patch: Partial<FocusConfig> = {}): FocusConfig => ({
  ...(createWidget('focus') as FocusConfig),
  ...patch
});

const show = (patch: Partial<FocusConfig> = {}) => render(<FocusWidget widget={widgetOf(patch)} />);

const saved = (): FocusState => JSON.parse(window.localStorage.getItem(FOCUS_KEY)!) as FocusState;

const seed = (patch: Partial<FocusState>): void => {
  window.localStorage.setItem(FOCUS_KEY, JSON.stringify({ ...freshState(new Date()), ...patch }));
};

const user = () => userEvent.setup();

const pass = async (ms: number): Promise<void> => {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
};

const time = (): string => screen.getByRole('timer').textContent!;

beforeEach(() => {
  // Only the clock and the interval: Testing Library waits on a real setTimeout of its own.
  vi.useFakeTimers({ now: NOON, toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.mocked(chime).mockReset();
  vi.mocked(prepareChime).mockReset();
  document.title = 'Home';
});

afterEach(() => {
  vi.useRealTimers();
});

describe('FocusWidget', () => {
  describe('before it is started', () => {
    it('shows a full focus stretch, ready', () => {
      show();

      expect(time()).toBe('25:00');
      expect(screen.getByText('Focus')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Start/ })).toBeInTheDocument();
      expect(screen.getByText('No focus sessions yet today')).toBeInTheDocument();
    });

    it('uses the lengths it is set to, and says the time in words for a screen reader', () => {
      show({ focus: 50, rest: 10 });

      expect(time()).toBe('50:00');
      expect(screen.getByRole('timer')).toHaveAccessibleName('50 minutes');
    });

    it('does not touch the tab’s title', () => {
      show();
      expect(document.title).toBe('Home');
    });
  });

  describe('running', () => {
    it('counts down, in the widget and in the tab’s title', async () => {
      show();
      await user().click(screen.getByRole('button', { name: /Start/ }));

      expect(prepareChime).toHaveBeenCalledTimes(1);
      expect(time()).toBe('25:00');
      expect(document.title).toBe('25:00 · Focus');

      await pass(5_000);

      expect(time()).toBe('24:55');
      expect(document.title).toBe('24:55 · Focus');
      expect(screen.getByRole('timer')).toHaveAccessibleName('24 minutes 55 seconds');
      expect(screen.getByRole('button', { name: /Pause/ })).toBeInTheDocument();
    });

    it('saves the moment it ends, so a reload carries on', async () => {
      show();
      await user().click(screen.getByRole('button', { name: /Start/ }));

      expect(saved()).toMatchObject({
        phase: 'focus',
        endsAt: NOON.getTime() + 25 * MIN,
        left: null
      });
    });

    it('pauses, holds its time, gives the title back, and resumes', async () => {
      show();
      const click = user();
      await click.click(screen.getByRole('button', { name: /Start/ }));
      await pass(60_000);
      await click.click(screen.getByRole('button', { name: /Pause/ }));

      expect(time()).toBe('24:00');
      expect(document.title).toBe('Home');
      expect(saved()).toMatchObject({ endsAt: null, left: 24 * MIN });

      await pass(10 * MIN);
      expect(time()).toBe('24:00');

      await click.click(screen.getByRole('button', { name: /Resume/ }));
      await pass(30_000);

      expect(time()).toBe('23:30');
      expect(document.title).toBe('23:30 · Focus');
    });

    it('goes back to the start on reset, and gives the title back', async () => {
      show();
      const click = user();
      await click.click(screen.getByRole('button', { name: /Start/ }));
      await pass(90_000);
      await click.click(screen.getByRole('button', { name: 'Reset' }));

      expect(time()).toBe('25:00');
      expect(document.title).toBe('Home');
      expect(screen.getByRole('button', { name: /Start/ })).toBeInTheDocument();
    });

    it('skips to the break, and back, without counting anything', async () => {
      show();
      const click = user();
      await click.click(screen.getByRole('button', { name: 'Skip to the break' }));

      expect(screen.getByText('Break')).toBeInTheDocument();
      expect(time()).toBe('05:00');

      await click.click(screen.getByRole('button', { name: 'Skip the break' }));

      expect(screen.getByText('Focus')).toBeInTheDocument();
      expect(time()).toBe('25:00');
      expect(screen.getByText('No focus sessions yet today')).toBeInTheDocument();
    });

    it('gives the title back when the widget goes away', async () => {
      const view = show();
      await user().click(screen.getByRole('button', { name: /Start/ }));
      expect(document.title).toBe('25:00 · Focus');

      view.unmount();

      expect(document.title).toBe('Home');
    });
  });

  describe('when the time is up', () => {
    const runOut = async () => {
      show();
      await user().click(screen.getByRole('button', { name: /Start/ }));
      await pass(25 * MIN);
    };

    it('counts the stretch, chimes, and waits with the break ready', async () => {
      await runOut();

      expect(chime).toHaveBeenCalledTimes(1);
      expect(screen.getByText('Break')).toBeInTheDocument();
      expect(time()).toBe('05:00');
      expect(screen.getByText('1 focus session today')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Start/ })).toBeInTheDocument();
      expect(document.title).toBe('Home');
      expect(saved()).toMatchObject({ phase: 'rest', endsAt: null, done: 1 });
    });

    it('does not chime if the chime is turned off', async () => {
      show({ sound: false });
      await user().click(screen.getByRole('button', { name: /Start/ }));
      await pass(25 * MIN);

      expect(chime).not.toHaveBeenCalled();
      expect(screen.getByText('Break')).toBeInTheDocument();
    });

    it('runs the break, then waits for the next focus stretch without counting the break', async () => {
      await runOut();
      const click = user();
      await click.click(screen.getByRole('button', { name: /Start/ }));
      await pass(5 * MIN);

      expect(chime).toHaveBeenCalledTimes(2);
      expect(screen.getByText('Focus')).toBeInTheDocument();
      expect(time()).toBe('25:00');
      expect(screen.getByText('1 focus session today')).toBeInTheDocument();
    });

    it('says how many stretches, with a dot for each up to eight', async () => {
      seed({ done: 3 });
      const view = show();
      expect(screen.getByText('3 focus sessions today')).toBeInTheDocument();
      expect(view.container.querySelectorAll('.focus-dots span')).toHaveLength(3);
      view.unmount();

      seed({ done: 12 });
      const more = show();
      expect(screen.getByText('12 focus sessions today')).toBeInTheDocument();
      expect(more.container.querySelectorAll('.focus-dots span')).toHaveLength(8);
    });
  });

  describe('across reloads, widgets and tabs', () => {
    it('picks a running timer up where it was, after a reload', () => {
      seed({ phase: 'focus', endsAt: NOON.getTime() + 10 * MIN });
      show();

      expect(time()).toBe('10:00');
      expect(screen.getByRole('button', { name: /Pause/ })).toBeInTheDocument();
      expect(document.title).toBe('10:00 · Focus');
    });

    it('picks a paused timer up too', () => {
      seed({ phase: 'rest', endsAt: null, left: 3 * MIN });
      show();

      expect(time()).toBe('03:00');
      expect(screen.getByText('Break')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Resume/ })).toBeInTheDocument();
    });

    it('finishes a stretch that ran out while the page was closed, with a chime if it was only just now', async () => {
      seed({ phase: 'focus', endsAt: NOON.getTime() - 30_000 });
      show();
      await pass(300);

      expect(chime).toHaveBeenCalledTimes(1);
      expect(screen.getByText('1 focus session today')).toBeInTheDocument();
      expect(screen.getByText('Break')).toBeInTheDocument();
    });

    it('lets one that ran out long ago go, without counting it or chiming', async () => {
      seed({ phase: 'focus', endsAt: NOON.getTime() - 3 * 60 * MIN, done: 2 });
      show();
      await pass(300);

      expect(chime).not.toHaveBeenCalled();
      expect(screen.getByText('2 focus sessions today')).toBeInTheDocument();
      expect(screen.getByText('Focus')).toBeInTheDocument();
      expect(time()).toBe('25:00');
      expect(saved()).toMatchObject({ endsAt: null, left: null, phase: 'focus' });
    });

    it('starts the day’s count over on a new day', () => {
      seed({ done: 5, day: dayOf(new Date(2026, 9, 2)) });
      show();

      expect(screen.getByText('No focus sessions yet today')).toBeInTheDocument();
    });

    it('shows one timer in every Focus widget, and ends it, and chimes, once', async () => {
      render(
        <>
          <FocusWidget widget={widgetOf()} />
          <FocusWidget widget={widgetOf()} />
        </>
      );
      const timers = () => screen.getAllByRole('timer').map((node) => node.textContent);

      await user().click(screen.getAllByRole('button', { name: /Start/ })[0]!);
      await pass(60_000);

      expect(timers()).toEqual(['24:00', '24:00']);
      expect(screen.getAllByRole('button', { name: /Pause/ })).toHaveLength(2);

      await pass(24 * MIN);

      expect(chime).toHaveBeenCalledTimes(1);
      expect(screen.getAllByText('1 focus session today')).toHaveLength(2);
      expect(timers()).toEqual(['05:00', '05:00']);
    });

    it('follows a change made in another tab', async () => {
      show();
      expect(time()).toBe('25:00');

      await act(async () => {
        seed({ phase: 'focus', endsAt: Date.now() + 7 * MIN });
        window.dispatchEvent(new StorageEvent('storage', { key: FOCUS_KEY }));
      });

      expect(time()).toBe('07:00');
      expect(screen.getByRole('button', { name: /Pause/ })).toBeInTheDocument();
    });
  });

  it('stops looking when the timer is not running', async () => {
    const view = show();
    const setTimers = vi.spyOn(window, 'setInterval');
    await pass(5_000);

    expect(setTimers).not.toHaveBeenCalled();
    view.unmount();
    setTimers.mockRestore();
  });
});
