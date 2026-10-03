/**
 * The Focus widget: a focus timer with breaks. The timer is the browser's, not
 * the widget's: a widget's id is made afresh on every load, so the running
 * timer lives in its own storage entry. It survives a reload, is shared by
 * every Focus widget and every open tab, and counts down to a moment (not by
 * ticks), so a sleeping tab still gets it right.
 */
export type FocusWidget = {
  id: string;
  type: 'focus';
  width: number;
  /** Minutes of focus. */
  focus: number;
  /** Minutes of break. */
  rest: number;
  /** Whether a chime marks the end of each stretch. */
  sound: boolean;
};

export const FOCUS_LIMITS = {
  focus: { min: 5, max: 90, fallback: 25 },
  rest: { min: 1, max: 30, fallback: 5 }
} as const;

export type Phase = 'focus' | 'rest';

export type FocusState = {
  phase: Phase;
  /** When it is running, the moment it ends (milliseconds since 1970); otherwise null. */
  endsAt: number | null;
  /** When it is paused, how long is left; null when it is on a stretch's full length. */
  left: number | null;
  /** Focus stretches finished today. */
  done: number;
  /** The day `done` counts, as YYYY-MM-DD. */
  day: string;
};

/** How long each stretch is, in milliseconds. */
export type Lengths = { focus: number; rest: number };

export const lengthsOf = (widget: Pick<FocusWidget, 'focus' | 'rest'>): Lengths => ({
  focus: widget.focus * 60_000,
  rest: widget.rest * 60_000
});

/** A timer that was due this long ago was left behind, not finished: it is not counted or chimed for. */
export const ABANDONED_MS = 10 * 60 * 1000;

/** Local date as YYYY-MM-DD. */
export const dayOf = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export const freshState = (now: Date): FocusState => ({
  phase: 'focus',
  endsAt: null,
  left: null,
  done: 0,
  day: dayOf(now)
});

const other = (phase: Phase): Phase => (phase === 'focus' ? 'rest' : 'focus');

export const isRunning = (state: FocusState): boolean => state.endsAt !== null;

/** Milliseconds left on the stretch in hand. */
export const remaining = (state: FocusState, now: number, lengths: Lengths): number =>
  state.endsAt !== null ? Math.max(0, state.endsAt - now) : (state.left ?? lengths[state.phase]);

export const start = (state: FocusState, now: number, lengths: Lengths): FocusState => {
  if (state.endsAt !== null) {
    return state;
  }

  const left = remaining(state, now, lengths);
  return { ...state, endsAt: now + (left > 0 ? left : lengths[state.phase]), left: null };
};

export const pause = (state: FocusState, now: number): FocusState =>
  state.endsAt === null ? state : { ...state, left: Math.max(0, state.endsAt - now), endsAt: null };

/** Back to a full focus stretch, stopped. */
export const reset = (state: FocusState): FocusState => ({
  ...state,
  phase: 'focus',
  endsAt: null,
  left: null
});

/** To the other kind of stretch, stopped, without counting this one. */
export const skip = (state: FocusState): FocusState => ({
  ...state,
  phase: other(state.phase),
  endsAt: null,
  left: null
});

/** The stretch is over: a focus one is counted, and the other kind waits to be started. */
export const finish = (state: FocusState): FocusState => ({
  ...state,
  done: state.phase === 'focus' ? state.done + 1 : state.done,
  phase: other(state.phase),
  endsAt: null,
  left: null
});

export const isDue = (state: FocusState, now: number): boolean =>
  state.endsAt !== null && now >= state.endsAt;

/** The count is for today; a new day starts it over. */
export const forToday = (state: FocusState, now: Date): FocusState =>
  state.day === dayOf(now) ? state : { ...state, done: 0, day: dayOf(now) };

/** "24:31", or "1:05:00" for an hour or more; a part of a second counts as the whole. */
export const clock = (ms: number): string => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number): string => String(value).padStart(2, '0');

  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
};

/** What a screen reader says for the time left: "24 minutes 31 seconds". */
export const spoken = (ms: number): string => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  const part = (value: number, word: string): string => `${value} ${word}${value === 1 ? '' : 's'}`;

  return [
    minutes > 0 && part(minutes, 'minute'),
    (seconds > 0 || minutes === 0) && part(seconds, 'second')
  ]
    .filter(Boolean)
    .join(' ');
};

/* -------------------------------------------------------------------------- */
/* Keeping it                                                                 */
/* -------------------------------------------------------------------------- */

export const FOCUS_KEY = 'dashboard-focus';
const CHANGED = 'dashboard-focus-changed';

const finiteOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

/** The saved timer, or a fresh one when there is none or it can't be trusted. */
export const readFocus = (now: Date): FocusState => {
  try {
    const raw = JSON.parse(window.localStorage.getItem(FOCUS_KEY) ?? 'null') as Record<
      string,
      unknown
    > | null;

    if (raw && typeof raw === 'object') {
      return forToday(
        {
          phase: raw.phase === 'rest' ? 'rest' : 'focus',
          endsAt: finiteOrNull(raw.endsAt),
          left: finiteOrNull(raw.left),
          done:
            typeof raw.done === 'number' && Number.isInteger(raw.done) && raw.done >= 0
              ? Math.min(raw.done, 99)
              : 0,
          day: typeof raw.day === 'string' ? raw.day : dayOf(now)
        },
        now
      );
    }
  } catch {
    /* an unreadable entry is the same as none */
  }

  return freshState(now);
};

/** Saves the timer and tells this tab's widgets (other tabs hear of it from the browser). */
export const writeFocus = (state: FocusState): void => {
  try {
    window.localStorage.setItem(FOCUS_KEY, JSON.stringify(state));
  } catch {
    /* with no room to save it, the timer still runs in this tab */
  }

  window.dispatchEvent(new CustomEvent<FocusState>(CHANGED, { detail: state }));
};

/** Calls back whenever the timer changes, here or in another tab; returns how to stop. */
export const watchFocus = (callback: () => void): (() => void) => {
  const onStorage = (event: StorageEvent): void => {
    if (event.key === FOCUS_KEY || event.key === null) {
      callback();
    }
  };

  window.addEventListener(CHANGED, callback);
  window.addEventListener('storage', onStorage);

  return () => {
    window.removeEventListener(CHANGED, callback);
    window.removeEventListener('storage', onStorage);
  };
};

/* -------------------------------------------------------------------------- */
/* The page's title, borrowed for the countdown                               */
/* -------------------------------------------------------------------------- */

let borrowed: { base: string; shown: string } | null = null;

/** Puts text in the tab's title, remembering what was there. */
export const showInTitle = (text: string): void => {
  // A title that isn't the one set here has been changed by the page since: it is the new base.
  const base = borrowed && document.title === borrowed.shown ? borrowed.base : document.title;
  document.title = text;
  borrowed = { base, shown: text };
};

/** Gives the title back, unless the page has changed it meanwhile. */
export const restoreTitle = (): void => {
  if (borrowed && document.title === borrowed.shown) {
    document.title = borrowed.base;
  }

  borrowed = null;
};

/* -------------------------------------------------------------------------- */
/* The chime                                                                  */
/* -------------------------------------------------------------------------- */

type AudioWindow = Window & { webkitAudioContext?: typeof AudioContext };

let audio: AudioContext | null = null;

/** Gets the sound ready. Browsers only allow it after a click, so this is called from one. */
export const prepareChime = (): void => {
  try {
    const Context = window.AudioContext ?? (window as AudioWindow).webkitAudioContext;

    if (Context) {
      audio ??= new Context();
      void audio.resume();
    }
  } catch {
    /* no sound is only no sound */
  }
};

/** Two soft notes. */
export const chime = (): void => {
  try {
    prepareChime();

    if (!audio) {
      return;
    }

    const context = audio;
    const begin = context.currentTime;

    [660, 880].forEach((frequency, index) => {
      const at = begin + index * 0.24;
      const oscillator = context.createOscillator();
      const gain = context.createGain();

      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.16, at + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.5);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(at);
      oscillator.stop(at + 0.55);
    });
  } catch {
    /* no sound is only no sound */
  }
};
