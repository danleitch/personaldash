import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchStatuses, readSummary, type ServiceStatus } from '../lib/status';
import { STATUS_SERVICES } from '../lib/status-services';
import { StatusBar } from './status-bar';

vi.mock('../lib/status', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/status')>()),
  fetchStatuses: vi.fn()
}));

const service = (id: string) => STATUS_SERVICES.find((candidate) => candidate.id === id)!;

const status = (
  id: string,
  indicator: string,
  extra: { incidents?: unknown[]; components?: unknown[]; description?: string } = {}
): ServiceStatus =>
  readSummary(service(id), {
    status: { indicator, description: extra.description ?? 'Partial System Outage' },
    components: extra.components ?? [],
    incidents: extra.incidents ?? []
  })!;

const answer = (...services: ServiceStatus[]) =>
  vi.mocked(fetchStatuses).mockResolvedValue({ services });

const githubOutage = status('github', 'major', {
  incidents: [{ id: 'a1', name: 'Disruption with Git operations' }],
  components: [
    { name: 'Git Operations', status: 'major_outage' },
    { name: 'Webhooks', status: 'partial_outage' },
    { name: 'Actions', status: 'degraded_performance' },
    { name: 'Pages', status: 'major_outage' },
    { name: 'API', status: 'operational' }
  ]
});

beforeEach(() => {
  vi.mocked(fetchStatuses).mockReset();
});

describe('StatusBar', () => {
  it('does nothing, not even ask, when nothing is watched', () => {
    const { container } = render(<StatusBar watched={[]} includeDegraded={false} />);

    expect(container).toBeEmptyDOMElement();
    expect(fetchStatuses).not.toHaveBeenCalled();
  });

  it('asks for the services watched, and nothing else', async () => {
    answer(status('github', 'none', { description: 'All Systems Operational' }));
    render(<StatusBar watched={['github', 'npm']} includeDegraded={false} />);

    await vi.waitFor(() =>
      expect(fetchStatuses).toHaveBeenCalledWith(['github', 'npm'], expect.any(AbortSignal))
    );
  });

  it('stays away while everything is fine', async () => {
    answer(
      status('github', 'none', { description: 'All Systems Operational' }),
      status('npm', 'maintenance')
    );
    const { container } = render(<StatusBar watched={['github', 'npm']} includeDegraded />);

    await vi.waitFor(() => expect(fetchStatuses).toHaveBeenCalled());
    await Promise.resolve();
    expect(container).toBeEmptyDOMElement();
  });

  it('stays away when a service cannot be reached', async () => {
    answer();
    const { container } = render(<StatusBar watched={['github']} includeDegraded />);

    await vi.waitFor(() => expect(fetchStatuses).toHaveBeenCalled());
    await Promise.resolve();
    expect(container).toBeEmptyDOMElement();
  });

  it('says which service is down, what is wrong, and where to read more', async () => {
    answer(githubOutage);
    render(<StatusBar watched={['github']} includeDegraded={false} />);

    const bar = await screen.findByRole('status');
    expect(bar).toHaveAttribute('data-severity', 'outage');
    expect(bar).toHaveTextContent(
      'GitHub is down · Disruption with Git operations · Git Operations, Webhooks, Actions and 1 more'
    );

    const link = within(bar).getByRole('link', { name: /Status page/ });
    expect(link).toHaveAttribute('href', 'https://www.githubstatus.com');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer noopener');
  });

  it('keeps to outages, unless slow service is asked for too', async () => {
    answer(status('npm', 'minor', { description: 'Minor Service Outage' }));
    const first = render(<StatusBar watched={['npm']} includeDegraded={false} />);
    await vi.waitFor(() => expect(fetchStatuses).toHaveBeenCalled());
    await Promise.resolve();
    expect(first.container).toBeEmptyDOMElement();
    first.unmount();
    window.localStorage.clear();

    render(<StatusBar watched={['npm']} includeDegraded />);
    const bar = await screen.findByRole('status');
    expect(bar).toHaveAttribute('data-severity', 'degraded');
    expect(bar).toHaveTextContent('npm is having problems · Minor Service Outage');
  });

  it('puts the worst first, and tucks the rest behind a button', async () => {
    answer(
      status('npm', 'minor', { description: 'Minor Service Outage' }),
      githubOutage,
      status('vercel', 'critical', { description: 'Major Service Outage' })
    );
    render(<StatusBar watched={['github', 'npm', 'vercel']} includeDegraded />);

    const bar = await screen.findByRole('status');
    expect(within(bar).getAllByRole('listitem')).toHaveLength(1);
    expect(bar).toHaveTextContent('GitHub is down');
    expect(bar).not.toHaveTextContent('Vercel');

    const more = within(bar).getByRole('button', { name: /2 more/ });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(more);

    expect(more).toHaveAttribute('aria-expanded', 'true');
    expect(more).toHaveTextContent('Show less');
    expect(
      within(bar)
        .getAllByRole('listitem')
        .map((item) => item.textContent)
    ).toEqual([
      expect.stringContaining('GitHub is down'),
      expect.stringContaining('Vercel is down'),
      expect.stringContaining('npm is having problems')
    ]);

    await userEvent.click(more);
    expect(within(bar).getAllByRole('listitem')).toHaveLength(1);
  });

  describe('dismissing', () => {
    it('hides the bar, and keeps it hidden after a reload', async () => {
      answer(githubOutage);
      const first = render(<StatusBar watched={['github']} includeDegraded={false} />);
      await userEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));

      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      first.unmount();

      render(<StatusBar watched={['github']} includeDegraded={false} />);
      await vi.waitFor(() => expect(fetchStatuses).toHaveBeenCalled());
      await Promise.resolve();
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('brings the bar back when the incident gets worse or a new one starts', async () => {
      answer(status('github', 'minor', { incidents: [{ id: 'a1', name: 'Slow pushes' }] }));
      const first = render(<StatusBar watched={['github']} includeDegraded />);
      await userEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));
      first.unmount();
      window.localStorage.removeItem('dashboard-cache:status:github');

      answer(status('github', 'major', { incidents: [{ id: 'a1', name: 'Slow pushes' }] }));
      render(<StatusBar watched={['github']} includeDegraded />);

      expect(await screen.findByRole('status')).toHaveTextContent('GitHub is down');
    });

    it('covers everything shown, and forgets incidents that have ended', async () => {
      answer(
        githubOutage,
        status('npm', 'major', { incidents: [{ id: 'n1', name: 'Publishing' }] })
      );
      const first = render(<StatusBar watched={['github', 'npm']} includeDegraded={false} />);
      await userEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));
      first.unmount();

      const remembered = JSON.parse(window.localStorage.getItem('dashboard-status-dismissed')!);
      expect(remembered).toEqual(['github:major:a1', 'npm:major:n1']);

      window.localStorage.removeItem('dashboard-cache:status:github,npm');
      answer(status('npm', 'major', { incidents: [{ id: 'n2', name: 'Another' }] }));
      render(<StatusBar watched={['github', 'npm']} includeDegraded={false} />);
      await userEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));

      expect(JSON.parse(window.localStorage.getItem('dashboard-status-dismissed')!)).toEqual([
        'npm:major:n2'
      ]);
    });

    it('copes with a store that is full, broken or has been tampered with', async () => {
      window.localStorage.setItem('dashboard-status-dismissed', '{not json');
      answer(githubOutage);
      const first = render(<StatusBar watched={['github']} includeDegraded={false} />);
      expect(await screen.findByRole('status')).toBeInTheDocument();
      first.unmount();

      window.localStorage.setItem('dashboard-status-dismissed', JSON.stringify([1, null, 'x']));
      const second = render(<StatusBar watched={['github']} includeDegraded={false} />);
      expect(await screen.findByRole('status')).toBeInTheDocument();
      second.unmount();

      const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key) => {
        if (key === 'dashboard-status-dismissed') {
          throw new DOMException('Full', 'QuotaExceededError');
        }
      });
      render(<StatusBar watched={['github']} includeDegraded={false} />);
      await userEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));

      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      setItem.mockRestore();
    });
  });

  it('ignores a reading left over from an earlier visit while it looks again', async () => {
    window.localStorage.setItem(
      'dashboard-cache:status:github',
      JSON.stringify({ at: Date.now() - 60 * 60 * 1000, data: { services: [githubOutage] } })
    );
    vi.mocked(fetchStatuses).mockReturnValue(new Promise(() => undefined));
    const { container } = render(<StatusBar watched={['github']} includeDegraded={false} />);

    await vi.waitFor(() => expect(fetchStatuses).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a recent reading at once, without waiting to look again', () => {
    window.localStorage.setItem(
      'dashboard-cache:status:github',
      JSON.stringify({ at: Date.now() - 60 * 1000, data: { services: [githubOutage] } })
    );
    render(<StatusBar watched={['github']} includeDegraded={false} />);

    expect(screen.getByRole('status')).toHaveTextContent('GitHub is down');
    expect(fetchStatuses).not.toHaveBeenCalled();
  });
});
