/**
 * What the status bar knows about the services it watches. Each one's
 * Statuspage summary comes through this site's /api/status relay, which keeps
 * it for a couple of minutes, so a failed read only means "no news": it never
 * raises an alarm of its own.
 */
import { STATUS_SERVICES, type StatusService } from './status-services';

/** Degraded is a slow or partly broken service; an outage is one that is down. */
export type Severity = 'degraded' | 'outage';

export type ServiceStatus = {
  id: string;
  name: string;
  /** Statuspage's own word for how things are: none, minor, major, critical or maintenance. */
  indicator: string;
  /** Null when all is well, or the only news is planned maintenance. */
  severity: Severity | null;
  /** Statuspage's summary, like "Partial System Outage". */
  description: string;
  /** The unresolved incidents, most recent first. */
  incidents: { id: string; name: string }[];
  /** The parts that are not working, like "Git Operations". */
  affected: string[];
};

export type StatusReport = { services: ServiceStatus[] };

export type StatusAlert = {
  /** Changes when an incident starts, ends or gets worse, so a dismissal only covers what it was for. */
  key: string;
  id: string;
  name: string;
  severity: Severity;
  headline: string;
  affected: string[];
  /** The service's own status page. */
  url: string;
};

const RELAY = '/api/status';

const clip = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

const severityOf = (indicator: string): Severity | null =>
  indicator === 'minor'
    ? 'degraded'
    : indicator === 'major' || indicator === 'critical'
      ? 'outage'
      : null;

const records = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          typeof item === 'object' && item !== null && !Array.isArray(item)
      )
    : [];

/** A service's state from its Statuspage summary, or null when the answer isn't one. */
export const readSummary = (service: StatusService, body: unknown): ServiceStatus | null => {
  const summary = (body ?? {}) as { status?: unknown; components?: unknown; incidents?: unknown };
  const status = (summary.status ?? {}) as { indicator?: unknown; description?: unknown };
  const indicator = clip(status.indicator, 20).toLowerCase();

  if (!indicator) {
    return null;
  }

  return {
    id: service.id,
    name: service.name,
    indicator,
    severity: severityOf(indicator),
    description: clip(status.description, 120),
    incidents: records(summary.incidents)
      .map((incident) => ({ id: clip(incident.id, 40), name: clip(incident.name, 160) }))
      .filter((incident) => incident.id || incident.name),
    affected: records(summary.components)
      .filter((component) => /outage|degraded/i.test(clip(component.status, 40)))
      .map((component) => clip(component.name, 60))
      .filter(Boolean)
  };
};

const fetchService = async (
  service: StatusService,
  signal: AbortSignal
): Promise<ServiceStatus | null> => {
  try {
    const response = await fetch(`${RELAY}/${service.id}`, { signal });

    // A host without the relay answers with the dashboard's own page.
    if (!response.ok || !(response.headers.get('content-type') ?? '').includes('json')) {
      return null;
    }

    return readSummary(service, await response.json());
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }

    return null;
  }
};

/** The state of each service asked for that answered; one that doesn't is left out. */
export const fetchStatuses = async (
  ids: readonly string[],
  signal: AbortSignal
): Promise<StatusReport> => {
  const wanted = STATUS_SERVICES.filter((service) => ids.includes(service.id));
  const results = await Promise.all(wanted.map((service) => fetchService(service, signal)));

  return { services: results.filter((result) => result !== null) };
};

/**
 * What to tell the visitor: the watched services that are in trouble, the
 * worst first. Degraded service only counts when asked for, since an outage is
 * what you need to know about.
 */
export const alertsOf = (
  report: StatusReport,
  watched: readonly string[],
  includeDegraded: boolean
): StatusAlert[] =>
  report.services
    .filter(
      (service) =>
        watched.includes(service.id) &&
        service.severity !== null &&
        (service.severity === 'outage' || includeDegraded)
    )
    .map((service) => ({
      key: [service.id, service.indicator, ...service.incidents.map((i) => i.id || i.name)].join(
        ':'
      ),
      id: service.id,
      name: service.name,
      severity: service.severity!,
      headline: service.incidents[0]?.name || service.description || 'Having problems',
      affected: service.affected,
      url: `https://${STATUS_SERVICES.find((candidate) => candidate.id === service.id)!.host}`
    }))
    .sort(
      (a, b) =>
        Number(b.severity === 'outage') - Number(a.severity === 'outage') ||
        a.name.localeCompare(b.name)
    );
