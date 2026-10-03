import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FOCUS_KEY,
  clock,
  dayOf,
  finish,
  forToday,
  freshState,
  isDue,
  isRunning,
  lengthsOf,
  pause,
  readFocus,
  remaining,
  reset,
  restoreTitle,
  showInTitle,
  skip,
  spoken,
  start,
  watchFocus,
  writeFocus,
  type FocusState
} from './focus';

const MIN = 60_000;
const lengths = lengthsOf({ focus: 25, rest: 5 });
const noon = new Date(2026, 9, 3, 12, 0, 0);
const NOW = noon.getTime();

const fresh = (): FocusState => freshState(noon);

describe('lengths and days', () => {
  it('turns minutes into milliseconds', () => {
    expect(lengths).toEqual({ focus: 25 * MIN, rest: 5 * MIN });
  });

  it('names the day in local time, with the zeros in', () => {
    expect(dayOf(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(dayOf(new Date(2026, 11, 31, 0, 0))).toBe('2026-12-31');
  });

  it('starts fresh at a full focus stretch, stopped', () => {
    expect(fresh()).toEqual({
      phase: 'focus',
      endsAt: null,
      left: null,
      done: 0,
      day: '2026-10-03'
    });
  });
});

describe('the clock', () => {
  it.each([
    [25 * MIN, '25:00'],
    [24 * MIN + 31_000, '24:31'],
    [59_001, '01:00'],
    [999, '00:01'],
    [1, '00:01'],
    [0, '00:00'],
    [-5000, '00:00'],
    [90 * MIN, '1:30:00'],
    [3600_000 + 5_000, '1:00:05']
  ])('shows %i ms as %s, a part of a second counting as a whole one', (ms, text) => {
    expect(clock(ms)).toBe(text);
  });

  it.each([
    [25 * MIN, '25 minutes'],
    [MIN, '1 minute'],
    [MIN + 1000, '1 minute 1 second'],
    [24 * MIN + 31_000, '24 minutes 31 seconds'],
    [45_000, '45 seconds'],
    [0, '0 seconds'],
    [1, '1 second']
  ])('says %i ms as %s', (ms, words) => {
    expect(spoken(ms)).toBe(words);
  });
});

describe('the timer', () => {
  it('shows a full stretch until it is started', () => {
    expect(remaining(fresh(), NOW, lengths)).toBe(25 * MIN);
    expect(isRunning(fresh())).toBe(false);
  });

  it('starts, counting to a moment', () => {
    const running = start(fresh(), NOW, lengths);

    expect(running.endsAt).toBe(NOW + 25 * MIN);
    expect(isRunning(running)).toBe(true);
    expect(remaining(running, NOW + 10 * MIN, lengths)).toBe(15 * MIN);
    expect(remaining(running, NOW + 99 * MIN, lengths)).toBe(0);
  });

  it('is not started twice', () => {
    const running = start(fresh(), NOW, lengths);
    expect(start(running, NOW + MIN, lengths)).toBe(running);
  });

  it('pauses with the time left, and picks up where it left off', () => {
    const paused = pause(start(fresh(), NOW, lengths), NOW + 10 * MIN);

    expect(paused).toMatchObject({ endsAt: null, left: 15 * MIN });
    expect(remaining(paused, NOW + 50 * MIN, lengths)).toBe(15 * MIN);

    const resumed = start(paused, NOW + 50 * MIN, lengths);
    expect(resumed.endsAt).toBe(NOW + 65 * MIN);
    expect(resumed.left).toBeNull();
  });

  it('has nothing to pause when it is not running', () => {
    const idle = fresh();
    expect(pause(idle, NOW)).toBe(idle);
  });

  it('never pauses on a negative time', () => {
    const running = start(fresh(), NOW, lengths);
    expect(pause(running, NOW + 99 * MIN).left).toBe(0);
  });

  it('starts a full stretch again when nothing was left', () => {
    const empty: FocusState = { ...fresh(), left: 0 };
    expect(start(empty, NOW, lengths).endsAt).toBe(NOW + 25 * MIN);
  });

  it('goes back to a full focus stretch, stopped, on reset, keeping the day’s count', () => {
    const state: FocusState = { ...fresh(), phase: 'rest', endsAt: NOW + MIN, left: null, done: 3 };

    expect(reset(state)).toEqual({ ...state, phase: 'focus', endsAt: null, left: null });
  });

  it('skips to the other kind of stretch, stopped, without counting it', () => {
    const running = start(fresh(), NOW, lengths);
    const resting = skip(running);

    expect(resting).toMatchObject({ phase: 'rest', endsAt: null, left: null, done: 0 });
    expect(skip(resting)).toMatchObject({ phase: 'focus', done: 0 });
  });

  it('counts a finished focus stretch and waits for the break to be started', () => {
    const done = finish(start(fresh(), NOW, lengths));

    expect(done).toMatchObject({ phase: 'rest', endsAt: null, left: null, done: 1 });
    expect(remaining(done, NOW, lengths)).toBe(5 * MIN);
  });

  it('does not count a finished break', () => {
    const resting: FocusState = { ...fresh(), phase: 'rest', done: 2 };
    expect(finish(resting)).toMatchObject({ phase: 'focus', done: 2 });
  });

  it('is due only once its moment has come', () => {
    const running = start(fresh(), NOW, lengths);

    expect(isDue(running, NOW + 25 * MIN - 1)).toBe(false);
    expect(isDue(running, NOW + 25 * MIN)).toBe(true);
    expect(isDue(fresh(), NOW + 99 * MIN)).toBe(false);
  });

  it('starts the day’s count over on a new day, and keeps it on the same one', () => {
    const state: FocusState = { ...fresh(), done: 4 };

    expect(forToday(state, noon)).toBe(state);
    expect(forToday(state, new Date(2026, 9, 4, 8, 0))).toMatchObject({
      done: 0,
      day: '2026-10-04'
    });
  });
});

describe('keeping it', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('reads a fresh timer when nothing is saved', () => {
    expect(readFocus(noon)).toEqual(fresh());
  });

  it('reads back what was written', () => {
    const state: FocusState = {
      phase: 'rest',
      endsAt: NOW + 3 * MIN,
      left: null,
      done: 5,
      day: '2026-10-03'
    };
    writeFocus(state);

    expect(readFocus(noon)).toEqual(state);
    expect(JSON.parse(window.localStorage.getItem(FOCUS_KEY)!)).toEqual(state);
  });

  it.each([
    ['not JSON', '{nope'],
    ['null', 'null'],
    ['a number', '7'],
    ['text', '"focus"']
  ])('starts fresh from a saved value that is %s', (_what, raw) => {
    window.localStorage.setItem(FOCUS_KEY, raw);
    expect(readFocus(noon)).toEqual(fresh());
  });

  it('mends a saved value that is partly wrong', () => {
    window.localStorage.setItem(
      FOCUS_KEY,
      JSON.stringify({
        phase: 'napping',
        endsAt: 'soon',
        left: -3,
        done: 2.5,
        day: 20261003
      })
    );

    expect(readFocus(noon)).toEqual(fresh());
  });

  it('caps the count of finished stretches, and refuses a count that is not a count', () => {
    window.localStorage.setItem(FOCUS_KEY, JSON.stringify({ ...fresh(), done: 5000 }));
    expect(readFocus(noon).done).toBe(99);

    window.localStorage.setItem(FOCUS_KEY, JSON.stringify({ ...fresh(), done: -1 }));
    expect(readFocus(noon).done).toBe(0);
  });

  it('starts the count over for a new day', () => {
    window.localStorage.setItem(FOCUS_KEY, JSON.stringify({ ...fresh(), done: 6 }));

    expect(readFocus(new Date(2026, 9, 4, 9, 0))).toMatchObject({ done: 0, day: '2026-10-04' });
  });

  it('keeps going, and still tells this tab, when there is no room to save', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Full', 'QuotaExceededError');
    });
    const heard = vi.fn();
    const stop = watchFocus(heard);

    expect(() => writeFocus(fresh())).not.toThrow();
    expect(heard).toHaveBeenCalledTimes(1);

    stop();
    setItem.mockRestore();
  });

  it('tells whoever is watching of a change made here, and stops when asked', () => {
    const heard = vi.fn();
    const stop = watchFocus(heard);

    writeFocus(fresh());
    expect(heard).toHaveBeenCalledTimes(1);

    stop();
    writeFocus(fresh());
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('hears of a change made in another tab, and of the whole store being cleared, but not of others', () => {
    const heard = vi.fn();
    const stop = watchFocus(heard);

    window.dispatchEvent(new StorageEvent('storage', { key: FOCUS_KEY }));
    window.dispatchEvent(new StorageEvent('storage', { key: null }));
    expect(heard).toHaveBeenCalledTimes(2);

    window.dispatchEvent(new StorageEvent('storage', { key: 'something-else' }));
    expect(heard).toHaveBeenCalledTimes(2);

    stop();
    window.dispatchEvent(new StorageEvent('storage', { key: FOCUS_KEY }));
    expect(heard).toHaveBeenCalledTimes(2);
  });
});

describe('the tab’s title', () => {
  beforeEach(() => {
    document.title = 'Home';
  });

  afterEach(() => {
    restoreTitle();
    document.title = '';
  });

  it('shows the countdown, and gives the title back', () => {
    showInTitle('24:55 · Focus');
    expect(document.title).toBe('24:55 · Focus');

    showInTitle('24:54 · Focus');
    expect(document.title).toBe('24:54 · Focus');

    restoreTitle();
    expect(document.title).toBe('Home');
  });

  it('leaves a title the page changed in the meantime, and takes it as the new one to return', () => {
    showInTitle('24:55 · Focus');
    document.title = 'My board';

    showInTitle('24:54 · Focus');
    restoreTitle();
    expect(document.title).toBe('My board');

    showInTitle('24:00 · Focus');
    document.title = 'Renamed';
    restoreTitle();
    expect(document.title).toBe('Renamed');
  });

  it('has nothing to give back when it never took the title', () => {
    expect(() => restoreTitle()).not.toThrow();
    expect(document.title).toBe('Home');
  });
});

describe('the chime', () => {
  type Node = {
    type?: string;
    frequency?: { value: number };
    gain?: {
      setValueAtTime: ReturnType<typeof vi.fn>;
      exponentialRampToValueAtTime: ReturnType<typeof vi.fn>;
    };
    connect: ReturnType<typeof vi.fn>;
    start?: ReturnType<typeof vi.fn>;
    stop?: ReturnType<typeof vi.fn>;
  };

  const install = (name: 'AudioContext' | 'webkitAudioContext' = 'AudioContext') => {
    const oscillators: Node[] = [];
    const resume = vi.fn(async () => undefined);

    class FakeContext {
      currentTime = 10;
      destination = {};
      resume = resume;
      createOscillator(): Node {
        const node: Node = {
          type: '',
          frequency: { value: 0 },
          connect: vi.fn(),
          start: vi.fn(),
          stop: vi.fn()
        };
        oscillators.push(node);
        return node;
      }
      createGain(): Node {
        return {
          gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
          connect: vi.fn()
        };
      }
    }

    vi.stubGlobal(name, FakeContext);
    return { oscillators, resume };
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('plays two notes, the second after the first', async () => {
    const { oscillators, resume } = install();
    const { chime } = await import('./focus');

    chime();

    expect(resume).toHaveBeenCalled();
    expect(oscillators.map((node) => node.frequency?.value)).toEqual([660, 880]);
    expect(oscillators.every((node) => node.type === 'sine')).toBe(true);
    expect(oscillators[0]?.start).toHaveBeenCalledWith(10);
    expect(oscillators[1]?.start).toHaveBeenCalledWith(10 + 0.24);
    expect(oscillators[0]?.stop).toHaveBeenCalledWith(10 + 0.55);
  });

  it('uses the one sound context for every chime', async () => {
    const { oscillators } = install();
    const { chime, prepareChime } = await import('./focus');

    prepareChime();
    chime();
    chime();

    expect(oscillators).toHaveLength(4);
  });

  it('works with the prefixed context older Safari has', async () => {
    const { oscillators } = install('webkitAudioContext');
    vi.stubGlobal('AudioContext', undefined);
    const { chime } = await import('./focus');

    chime();

    expect(oscillators).toHaveLength(2);
  });

  it('makes no sound, and no fuss, where there is no audio', async () => {
    vi.stubGlobal('AudioContext', undefined);
    const { chime, prepareChime } = await import('./focus');

    expect(() => prepareChime()).not.toThrow();
    expect(() => chime()).not.toThrow();
  });

  it('makes no fuss when the browser will not make a sound context', async () => {
    vi.stubGlobal(
      'AudioContext',
      class {
        constructor() {
          throw new Error('Not allowed');
        }
      }
    );
    const { chime, prepareChime } = await import('./focus');

    expect(() => prepareChime()).not.toThrow();
    expect(() => chime()).not.toThrow();
  });

  it('makes no fuss when playing a note goes wrong', async () => {
    vi.stubGlobal(
      'AudioContext',
      class {
        currentTime = 0;
        resume = async () => undefined;
        createOscillator(): never {
          throw new Error('Broken');
        }
      }
    );
    const { chime } = await import('./focus');

    expect(() => chime()).not.toThrow();
  });
});
