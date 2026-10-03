import { describe, expect, it, vi } from 'vitest';
import nginx from '../../../nginx.conf?raw';
import { alertsOf, fetchStatuses, readSummary, type StatusReport } from './status';
import { STATUS_SERVICES, readStatusIds } from './status-services';

const github = STATUS_SERVICES.find((service) => service.id === 'github')!;
const npm = STATUS_SERVICES.find((service) => service.id === 'npm')!;

const summary = (
  indicator: string,
  extra: { incidents?: unknown[]; components?: unknown[]; description?: string } = {}
) => ({
  page: { name: 'GitHub' },
  status: { indicator, description: extra.description ?? 'Partial System Outage' },
  components: extra.components ?? [],
  incidents: extra.incidents ?? []
});

describe('the services', () => {
  it('lists nine, each with its own id and host', () => {
    expect(STATUS_SERVICES).toHaveLength(9);
    expect(new Set(STATUS_SERVICES.map((service) => service.id)).size).toBe(9);
    expect(new Set(STATUS_SERVICES.map((service) => service.host)).size).toBe(9);
  });

  it('keeps nginx.conf’s relay to exactly the same ids and hosts', () => {
    const mapped = [...nginx.matchAll(/^\s*\/api\/status\/([a-z]+)\s+([\w.-]+);/gm)].map(
      (match) => [match[1], match[2]]
    );

    expect(mapped).toEqual(STATUS_SERVICES.map((service) => [service.id, service.host]));
  });

  it('reads a hand-edited list: known ids only, once each, in the order they are offered', () => {
    expect(readStatusIds(['npm', 'nonsense', 'github', 'npm', 7, null])).toEqual(['github', 'npm']);
    expect(readStatusIds('vercel')).toEqual(['vercel']);
    expect(readStatusIds(undefined)).toEqual([]);
    expect(readStatusIds({ github: true })).toEqual([]);
  });
});

describe('readSummary', () => {
  it('reads a service that is all right', () => {
    expect(
      readSummary(github, summary('none', { description: 'All Systems Operational' }))
    ).toEqual({
      id: 'github',
      name: 'GitHub',
      indicator: 'none',
      severity: null,
      description: 'All Systems Operational',
      incidents: [],
      affected: []
    });
  });

  it.each([
    ['minor', 'degraded'],
    ['major', 'outage'],
    ['critical', 'outage'],
    ['MAJOR', 'outage'],
    ['none', null],
    ['maintenance', null],
    ['something new', null]
  ])('calls %s %s', (indicator, severity) => {
    expect(readSummary(github, summary(indicator))?.severity).toBe(severity);
  });

  it('lists the incidents and the parts that are not working', () => {
    const status = readSummary(
      github,
      summary('major', {
        incidents: [
          { id: 'abc', name: 'Disruption with Git operations' },
          { id: 'def', name: 'Slow webhooks' }
        ],
        components: [
          { name: 'Git Operations', status: 'major_outage' },
          { name: 'Webhooks', status: 'degraded_performance' },
          { name: 'Pages', status: 'operational' },
          { name: 'Actions', status: 'under_maintenance' }
        ]
      })
    );

    expect(status?.incidents).toEqual([
      { id: 'abc', name: 'Disruption with Git operations' },
      { id: 'def', name: 'Slow webhooks' }
    ]);
    expect(status?.affected).toEqual(['Git Operations', 'Webhooks']);
  });

  it('shortens long text and drops entries that say nothing', () => {
    const status = readSummary(
      github,
      summary('minor', {
        description: 'x'.repeat(500),
        incidents: [{ name: 'y'.repeat(500), id: 'a' }, {}, 'nonsense', null],
        components: [{ status: 'partial_outage' }, 'nonsense']
      })
    );

    expect(status?.description).toHaveLength(120);
    expect(status?.incidents).toHaveLength(1);
    expect(status?.incidents[0]?.name).toHaveLength(160);
    expect(status?.affected).toEqual([]);
  });

  it('is nothing when the answer is not a status', () => {
    expect(readSummary(github, null)).toBeNull();
    expect(readSummary(github, {})).toBeNull();
    expect(readSummary(github, { status: { indicator: 3 } })).toBeNull();
    expect(readSummary(github, '<html>')).toBeNull();
  });
});

describe('fetchStatuses', () => {
  const signal = new AbortController().signal;
  const json = (body: unknown, init: ResponseInit = {}): Response =>
    new Response(JSON.stringify(body), {
      headers: { 'content-type': 'application/json' },
      ...init
    });

  it('asks the relay for each service wanted, and no other', async () => {
    const fetchMock = vi.fn(async (url: string) => json({ ...summary('none'), requested: url }));
    vi.stubGlobal('fetch', fetchMock);

    await fetchStatuses(['npm', 'nonsense', 'github'], signal);

    // In the order the services are offered, whatever the order asked for.
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/status/github',
      '/api/status/npm'
    ]);
  });

  it('leaves out a service that does not answer, with no fuss', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/github')) {
          return json(summary('major'));
        }

        if (url.endsWith('/npm')) {
          return new Response('', { status: 502 });
        }

        if (url.endsWith('/cloudflare')) {
          return new Response('<html>', { headers: { 'content-type': 'text/html' } });
        }

        if (url.endsWith('/vercel')) {
          return json({ not: 'a status' });
        }

        throw new TypeError('Failed to fetch');
      })
    );

    const report = await fetchStatuses(
      ['github', 'npm', 'cloudflare', 'vercel', 'netlify'],
      signal
    );

    expect(report.services.map((service) => service.id)).toEqual(['github']);
  });

  it('passes an abort on rather than calling it silence', async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new DOMException('Aborted', 'AbortError');
      })
    );

    await expect(fetchStatuses(['github'], controller.signal)).rejects.toThrow('Aborted');
  });
});

describe('alertsOf', () => {
  const report: StatusReport = {
    services: [
      readSummary(
        github,
        summary('major', {
          incidents: [{ id: 'abc', name: 'Disruption with Git operations' }],
          components: [{ name: 'Git Operations', status: 'major_outage' }]
        })
      )!,
      readSummary(npm, summary('minor', { description: 'Minor Service Outage' }))!,
      readSummary(STATUS_SERVICES[2]!, summary('critical'))!,
      readSummary(STATUS_SERVICES[3]!, summary('none'))!,
      readSummary(STATUS_SERVICES[4]!, summary('maintenance'))!
    ]
  };
  const watched = ['github', 'npm', 'cloudflare', 'vercel', 'netlify'];

  it('is silent while everything is fine, or only maintenance is planned', () => {
    expect(alertsOf({ services: report.services.slice(3) }, watched, true)).toEqual([]);
    expect(alertsOf({ services: [] }, watched, true)).toEqual([]);
  });

  it('tells of outages only, unless degraded service is asked for', () => {
    expect(alertsOf(report, watched, false).map((alert) => alert.id)).toEqual([
      'cloudflare',
      'github'
    ]);
    expect(alertsOf(report, watched, true).map((alert) => [alert.id, alert.severity])).toEqual([
      ['cloudflare', 'outage'],
      ['github', 'outage'],
      ['npm', 'degraded']
    ]);
  });

  it('says only about what is watched', () => {
    expect(alertsOf(report, ['npm'], false)).toEqual([]);
    expect(alertsOf(report, ['npm'], true).map((alert) => alert.id)).toEqual(['npm']);
  });

  it('headlines the incident, or else Statuspage’s summary, with where to read more', () => {
    const [cloudflare, gh, ,] = alertsOf(report, watched, true);

    expect(gh).toMatchObject({
      name: 'GitHub',
      headline: 'Disruption with Git operations',
      affected: ['Git Operations'],
      url: 'https://www.githubstatus.com'
    });
    expect(cloudflare?.headline).toBe('Partial System Outage');
    expect(
      alertsOf(
        { services: [readSummary(github, summary('major', { description: '' }))!] },
        ['github'],
        false
      )[0]?.headline
    ).toBe('Having problems');
  });

  it('changes its key when an incident starts, ends or gets worse', () => {
    const key = (indicator: string, ids: string[]): string =>
      alertsOf(
        {
          services: [
            readSummary(
              github,
              summary(indicator, { incidents: ids.map((id) => ({ id, name: id })) })
            )!
          ]
        },
        ['github'],
        true
      )[0]!.key;

    expect(key('major', ['a'])).toBe(key('major', ['a']));
    expect(key('major', ['a'])).not.toBe(key('major', ['a', 'b']));
    expect(key('minor', ['a'])).not.toBe(key('major', ['a']));
    expect(key('major', [])).toBe('github:major');
  });
});
