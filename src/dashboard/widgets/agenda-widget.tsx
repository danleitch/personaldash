import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type KeyboardEvent
} from 'react';
import {
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  MapPin,
  Video
} from 'lucide-react';
import { useNow } from '../hooks/use-now';
import { useRemote } from '../hooks/use-remote';
import {
  fetchAgenda,
  isAddress,
  type AgendaCalendar,
  type AgendaEvent,
  type AgendaWidget as AgendaWidgetConfig
} from '../lib/agenda';
import {
  addMonths,
  browseRange,
  calendarDayUrl,
  clampDay,
  dayFromKey,
  dayHeading,
  dayKey,
  durationLabel,
  groupByDay,
  longDay,
  mapsUrl,
  monthGrid,
  monthStart,
  moveDay,
  phasesOf,
  progressOf,
  rowTimes,
  spanLabel,
  untilLabel,
  upcoming,
  type DayGroup,
  type Phase
} from '../lib/agenda-days';
import type { HourFormat } from '../lib/model';
import { WidgetSkeleton, WidgetState } from './widget-frame';
import '../agenda.css';

/** The relay keeps a feed for five minutes; the page looks twice as seldom. */
const AGENDA_TTL_MS = 10 * 60 * 1000;

/** Each calendar has its own colour, set in agenda.css. */
const toneOf = (calendar: number): CSSProperties =>
  ({ '--tone': `var(--cal-${(calendar % 3) + 1})` }) as CSSProperties;

const AgendaRow = ({
  event,
  day,
  phase,
  now,
  clock,
  calendarName,
  open,
  target,
  onToggle
}: {
  event: AgendaEvent;
  day: string;
  phase: Phase;
  now: number;
  clock: HourFormat;
  /** Shown in the details when there is more than one calendar. */
  calendarName: string;
  open: boolean;
  target: string | undefined;
  onToggle: () => void;
}): JSX.Element => {
  const times = rowTimes(event, day, clock);
  const place = event.location && !isAddress(event.location) ? event.location : '';
  const subtitle = place || (event.allDay ? '' : durationLabel(event.end - event.start));
  const chip = phase === 'live' ? 'Now' : phase === 'next' ? untilLabel(event.start, now) : '';

  return (
    <li className={`agenda-event agenda-event--${phase}`} style={toneOf(event.calendar)}>
      <div className="agenda-event-row">
        <button type="button" className="agenda-event-main" aria-expanded={open} onClick={onToggle}>
          <span className="agenda-time">
            <b>{times.primary}</b>
            {times.secondary && <small>{times.secondary}</small>}
          </span>
          <span className="agenda-bar" aria-hidden="true" />
          <span className="agenda-what">
            <span className="agenda-title">{event.title}</span>
            {subtitle && <span className="agenda-sub">{subtitle}</span>}
          </span>
          {chip && <span className="agenda-chip">{chip}</span>}
          {phase === 'live' && (
            <span
              className="agenda-progress"
              style={
                { '--progress': `${Math.round(progressOf(event, now) * 100)}%` } as CSSProperties
              }
              aria-hidden="true"
            />
          )}
        </button>
        {event.link && (
          <a
            className="agenda-join"
            href={event.link}
            target={target}
            rel="noreferrer noopener"
            title="Join the call"
            aria-label={`Join ${event.title}`}
          >
            <Video size={14} aria-hidden="true" />
          </a>
        )}
      </div>
      {open && (
        <div className="agenda-detail">
          <p className="agenda-detail-when">
            {spanLabel(event, clock)}
            {calendarName && <span className="agenda-detail-calendar"> · {calendarName}</span>}
          </p>
          {place && (
            <a
              className="agenda-detail-line"
              href={mapsUrl(place)}
              target={target}
              rel="noreferrer noopener"
            >
              <MapPin size={13} aria-hidden="true" />
              {place}
            </a>
          )}
          {event.description && <p className="agenda-detail-text">{event.description}</p>}
        </div>
      )}
    </li>
  );
};

/** A short stand-in for the addresses in a cache key, so the secrets aren't spelled out in it. */
const fingerprint = (text: string): string => {
  let hash = 5381;

  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash * 33) ^ text.charCodeAt(index)) >>> 0;
  }

  return hash.toString(36);
};

export const AgendaWidget = ({
  widget,
  clock,
  newTab
}: {
  widget: AgendaWidgetConfig;
  clock: HourFormat;
  newTab: boolean;
}): JSX.Element =>
  widget.calendars.length === 0 ? (
    <WidgetState>Add a calendar address in this widget’s settings.</WidgetState>
  ) : (
    <AgendaBoard widget={widget} clock={clock} newTab={newTab} />
  );

const AgendaBoard = ({
  widget,
  clock,
  newTab
}: {
  widget: AgendaWidgetConfig;
  clock: HourFormat;
  newTab: boolean;
}): JSX.Element => {
  const { weekStart, count, month, calendars } = widget;
  const now = useNow();
  // The addresses are the reading's identity: other addresses are another reading altogether.
  const addresses = calendars.join('\n');
  const load = useCallback(
    (signal: AbortSignal) => fetchAgenda(new Date(), addresses.split('\n'), signal),
    [addresses]
  );
  const { data, error, refresh } = useRemote(
    `agenda:${fingerprint(addresses)}`,
    AGENDA_TTL_MS,
    load
  );
  // Null follows today, so the widget is on the right day after midnight too.
  const [picked, setPicked] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const refocus = useRef(false);
  const days = useMemo(() => groupByDay(data?.events ?? []), [data]);
  const today = dayKey(now);
  const range = browseRange(today);
  const selected = month ? clampDay(picked ?? today, range) : today;
  const target = newTab ? '_blank' : undefined;

  // Moving the selection with the keyboard takes focus to the new day once it has rendered.
  useEffect(() => {
    if (refocus.current) {
      refocus.current = false;
      gridRef.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
    }
  }, [selected]);

  if (!data) {
    return error ? (
      <WidgetState
        tone="error"
        action={
          <button type="button" className="link-btn" onClick={refresh}>
            Try again
          </button>
        }
      >
        {error}
      </WidgetState>
    ) : (
      <WidgetSkeleton rows={5} />
    );
  }

  const choose = (key: string, fromKeyboard = false): void => {
    const next = clampDay(key, range);
    refocus.current = fromKeyboard && next !== selected;
    setPicked(next === today ? null : next);
    setOpenId(null);
  };

  const stepMonth = (delta: number): void => {
    const landing = addMonths(monthStart(selected), delta);
    choose(monthStart(landing) === monthStart(today) ? today : landing);
  };

  const handleKey = (event: KeyboardEvent): void => {
    const next = moveDay(selected, event.key, weekStart);

    if (next) {
      event.preventDefault();
      choose(next, true);
    }
  };

  const names = new Map<number, AgendaCalendar>(
    data.calendars.map((calendar) => [calendar.slot - 1, calendar])
  );
  const answered = data.calendars.filter((calendar) => calendar.ok);
  const several = answered.length > 1;
  const groups = upcoming(days, selected, count);
  const nowMs = now.getTime();
  const shown = dayFromKey(selected);
  const weekdays = Array.from({ length: 7 }, (_unused, index) => {
    const date = new Date(2024, 0, 7 + weekStart + index);
    return {
      narrow: date.toLocaleDateString(undefined, { weekday: 'narrow' }),
      long: date.toLocaleDateString(undefined, { weekday: 'long' })
    };
  });
  const monthName = shown.toLocaleDateString(undefined, { month: 'long' });
  const atStart = monthStart(selected) <= monthStart(range.min);
  const atEnd = monthStart(selected) >= monthStart(range.max);
  const unanswered = data.calendars.filter((calendar) => !calendar.ok);

  const list = (
    <div className="agenda-list">
      {groups.map((group: DayGroup) => {
        const heading = dayHeading(group.key, today);
        const phases = group.key === today ? phasesOf(group.events, nowMs) : [];

        return (
          <section
            key={group.key}
            className={`agenda-group${group.key === today ? ' agenda-group--today' : ''}`}
            aria-label={longDay(group.key)}
          >
            <h4 className="agenda-group-head">
              <span className="agenda-lead">{heading.lead}</span>
              <span className="agenda-date">{heading.date}</span>
            </h4>
            {group.events.length === 0 ? (
              <p className="agenda-none">
                {groups.length > 1 ? (
                  'Nothing planned'
                ) : (
                  <>
                    <CalendarCheck size={14} aria-hidden="true" /> Nothing planned, and nothing
                    coming up.
                  </>
                )}
              </p>
            ) : (
              <ul className="agenda-events">
                {group.events.map((event, index) => (
                  <AgendaRow
                    key={`${group.key}:${event.id}`}
                    event={event}
                    day={group.key}
                    phase={phases[index] ?? 'later'}
                    now={nowMs}
                    clock={clock}
                    calendarName={several ? (names.get(event.calendar)?.name ?? '') : ''}
                    open={openId === `${group.key}:${event.id}`}
                    target={target}
                    onToggle={() =>
                      setOpenId(
                        openId === `${group.key}:${event.id}` ? null : `${group.key}:${event.id}`
                      )
                    }
                  />
                ))}
              </ul>
            )}
            {group.more > 0 && (
              <a
                className="agenda-more"
                href={calendarDayUrl(group.key)}
                target={target}
                rel="noreferrer noopener"
              >
                +{group.more} more
              </a>
            )}
          </section>
        );
      })}
    </div>
  );

  return (
    <div className="agenda">
      <div className={`agenda-layout${month ? ' agenda-layout--split' : ''}`}>
        {month && (
          <div className="agenda-month">
            <div className="agenda-head">
              <h3 className="agenda-name">
                {monthName}
                <span className="agenda-year">{shown.getFullYear()}</span>
              </h3>
              <div className="agenda-nav">
                {selected !== today && (
                  <button type="button" className="agenda-today" onClick={() => choose(today)}>
                    Today
                  </button>
                )}
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Previous month"
                  disabled={atStart}
                  onClick={() => stepMonth(-1)}
                >
                  <ChevronLeft size={16} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Next month"
                  disabled={atEnd}
                  onClick={() => stepMonth(1)}
                >
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              </div>
            </div>
            <div
              className="agenda-grid"
              role="grid"
              aria-label={`${monthName} ${shown.getFullYear()}`}
              ref={gridRef}
              onKeyDown={handleKey}
            >
              <div className="agenda-weekdays" role="row">
                {weekdays.map((day, index) => (
                  <span key={index} role="columnheader" aria-label={day.long} title={day.long}>
                    {day.narrow}
                  </span>
                ))}
              </div>
              {monthGrid(selected, weekStart).map((week) => (
                <div key={week[0]} className="agenda-week" role="row">
                  {week.map((key) => {
                    const events = days.get(key) ?? [];
                    const classes = [
                      'agenda-cell',
                      key.slice(0, 7) !== selected.slice(0, 7) && 'agenda-cell--out',
                      key === today && 'agenda-cell--today',
                      key === selected && 'agenda-cell--selected'
                    ]
                      .filter(Boolean)
                      .join(' ');

                    return (
                      <div key={key} role="gridcell" aria-selected={key === selected}>
                        <button
                          type="button"
                          className={classes}
                          tabIndex={key === selected ? 0 : -1}
                          aria-current={key === today ? 'date' : undefined}
                          aria-label={`${longDay(key)}${
                            events.length
                              ? `, ${events.length} ${events.length === 1 ? 'event' : 'events'}`
                              : ''
                          }`}
                          onClick={() => choose(key)}
                        >
                          <span className="agenda-num">{Number(key.slice(8))}</span>
                          <span className="agenda-dots" aria-hidden="true">
                            {events.slice(0, 3).map((event) => (
                              <span key={event.id} style={toneOf(event.calendar)} />
                            ))}
                          </span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        )}
        {list}
      </div>
      <div className="agenda-foot">
        {several && (
          <ul className="agenda-legend" aria-label="Calendars">
            {answered.map((calendar) => (
              <li key={calendar.slot} style={toneOf(calendar.slot - 1)}>
                <i aria-hidden="true" />
                {calendar.name}
              </li>
            ))}
          </ul>
        )}
        {(error || unanswered.length > 0) && (
          <span className="agenda-warn" role="status">
            {error
              ? 'Couldn’t refresh; showing the last look.'
              : `${unanswered.map((calendar) => calendar.name).join(' and ')} didn’t answer.`}{' '}
            <button type="button" className="link-btn" onClick={refresh}>
              Try again
            </button>
          </span>
        )}
        <a
          className="agenda-open"
          href={calendarDayUrl(selected)}
          target={target}
          rel="noreferrer noopener"
        >
          Open Google Calendar <ExternalLink size={11} aria-hidden="true" />
        </a>
      </div>
    </div>
  );
};
