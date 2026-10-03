import { useCallback, useState, type JSX } from 'react';
import { ChevronDown, ExternalLink, OctagonAlert, TriangleAlert, X } from 'lucide-react';
import { useNow } from '../hooks/use-now';
import { useRemote } from '../hooks/use-remote';
import { alertsOf, fetchStatuses, type StatusAlert } from '../lib/status';
import '../status.css';

/** The services' pages are cached for two minutes by the server; the page looks a little less often. */
const STATUS_TTL_MS = 3 * 60 * 1000;

/** A reading older than this is from another visit, and says nothing about now. */
const STALE_MS = 4 * STATUS_TTL_MS;

const DISMISSED_KEY = 'dashboard-status-dismissed';
const MAX_DISMISSED = 40;

const readDismissed = (): string[] => {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(DISMISSED_KEY) ?? '[]');
    return Array.isArray(parsed)
      ? parsed.filter((key): key is string => typeof key === 'string')
      : [];
  } catch {
    return [];
  }
};

const writeDismissed = (keys: string[]): void => {
  try {
    window.localStorage.setItem(DISMISSED_KEY, JSON.stringify(keys.slice(-MAX_DISMISSED)));
  } catch {
    /* a full store only means the bar comes back after a reload */
  }
};

const AlertLine = ({ alert }: { alert: StatusAlert }): JSX.Element => {
  const Icon = alert.severity === 'outage' ? OctagonAlert : TriangleAlert;
  const parts = alert.affected.slice(0, 3);
  const more = alert.affected.length - parts.length;

  return (
    <li className="statusbar-line" data-severity={alert.severity}>
      <Icon size={16} aria-hidden="true" />
      <span className="statusbar-text">
        <strong>{alert.name}</strong>
        <span className="statusbar-kind">
          {alert.severity === 'outage' ? ' is down' : ' is having problems'}
        </span>
        <span className="statusbar-headline"> · {alert.headline}</span>
        {parts.length > 0 && (
          <span className="statusbar-affected">
            {' '}
            · {parts.join(', ')}
            {more > 0 && ` and ${more} more`}
          </span>
        )}
      </span>
      <a className="statusbar-link" href={alert.url} target="_blank" rel="noreferrer noopener">
        Status page <ExternalLink size={12} aria-hidden="true" />
      </a>
    </li>
  );
};

const StatusWatch = ({
  watched,
  includeDegraded
}: {
  watched: readonly string[];
  includeDegraded: boolean;
}): JSX.Element | null => {
  const ids = watched.join(',');
  const key = `status:${ids}`;
  const load = useCallback((signal: AbortSignal) => fetchStatuses(ids.split(','), signal), [ids]);
  const { data, fetchedAt } = useRemote(key, STATUS_TTL_MS, load);
  const now = useNow();
  const [dismissed, setDismissed] = useState<string[]>(readDismissed);
  const [expanded, setExpanded] = useState(false);

  const fresh = fetchedAt !== null && now.getTime() - fetchedAt < STALE_MS;
  const alerts = data && fresh ? alertsOf(data, watched, includeDegraded) : [];
  const showing = alerts.filter((alert) => !dismissed.includes(alert.key));

  if (showing.length === 0) {
    return null;
  }

  const [first, ...rest] = showing;
  const worst = first.severity;

  const dismiss = (): void => {
    // Only what is still going on needs remembering; a resolved incident's key can go.
    const next = [
      ...dismissed.filter((key) => alerts.some((alert) => alert.key === key)),
      ...showing.map((alert) => alert.key)
    ];
    setDismissed(next);
    writeDismissed(next);
    setExpanded(false);
  };

  return (
    <div className="statusbar" data-severity={worst} role="status" aria-live="polite">
      <ul className="statusbar-lines">
        <AlertLine alert={first} />
        {expanded && rest.map((alert) => <AlertLine key={alert.key} alert={alert} />)}
      </ul>
      <div className="statusbar-actions">
        {rest.length > 0 && (
          <button
            type="button"
            className="statusbar-more"
            aria-expanded={expanded}
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? 'Show less' : `${rest.length} more`}
            <ChevronDown size={14} aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          className="statusbar-dismiss"
          aria-label="Dismiss"
          title="Dismiss until something changes"
          onClick={dismiss}
        >
          <X size={15} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
};

/**
 * A strip across the top of the page that appears only while a service you
 * watch is down (or having problems, if you ask for that too), and goes away
 * when it recovers. With nothing watched it does nothing, not even ask.
 */
export const StatusBar = ({
  watched,
  includeDegraded
}: {
  watched: readonly string[];
  includeDegraded: boolean;
}): JSX.Element | null =>
  watched.length === 0 ? null : <StatusWatch watched={watched} includeDegraded={includeDegraded} />;
