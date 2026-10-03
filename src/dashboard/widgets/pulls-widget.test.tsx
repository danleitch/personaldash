import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createWidget, type PullsWidget as PullsConfig } from '../lib/model';
import { fetchPulls, type PullRequest, type PullsData } from '../lib/pulls';
import { PullsWidget } from './pulls-widget';

vi.mock('../lib/pulls', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/pulls')>()),
  fetchPulls: vi.fn()
}));

const TOKEN = 'github_pat_11ABCDEFG0abcdefghijklmnopqrstuvwxyz';
const NOW = Date.now() / 1000;

const pull = (number: number, rest: Partial<PullRequest> = {}): PullRequest => ({
  number,
  title: `Pull request ${number}`,
  url: `https://github.com/acme/app/pull/${number}`,
  repo: 'acme/app',
  author: 'sam',
  draft: false,
  updated: NOW - 2 * 3600,
  checks: 'passing',
  review: 'none',
  ...rest
});

const data = (rest: Partial<PullsData> = {}): PullsData => ({
  login: 'octocat',
  review: [pull(1, { author: 'robin' }), pull(2)],
  reviewTotal: 2,
  mine: [pull(10, { checks: 'failing', review: 'changes' }), pull(11, { review: 'approved' })],
  mineTotal: 2,
  ...rest
});

const widgetOf = (patch: Partial<PullsConfig> = {}): PullsConfig => ({
  ...(createWidget('prs') as PullsConfig),
  token: TOKEN,
  ...patch
});

const show = (patch: Partial<PullsConfig> = {}, newTab = false) =>
  render(<PullsWidget widget={widgetOf(patch)} newTab={newTab} />);

beforeEach(() => {
  vi.mocked(fetchPulls).mockReset();
});

describe('PullsWidget', () => {
  it('asks for a token, and asks GitHub nothing, until it has one', () => {
    show({ token: '' });

    expect(screen.getByText('Add a GitHub token in this widget’s settings.')).toBeInTheDocument();
    expect(fetchPulls).not.toHaveBeenCalled();
  });

  it('shimmers while it waits', () => {
    vi.mocked(fetchPulls).mockReturnValue(new Promise(() => undefined));
    show();

    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
  });

  it('asks GitHub with the token it was given', async () => {
    vi.mocked(fetchPulls).mockResolvedValue(data());
    show();

    await screen.findByText('Pull request 1');
    expect(fetchPulls).toHaveBeenCalledWith(TOKEN, expect.any(AbortSignal));
  });

  it('lists what is waiting for review and your own, and who you are', async () => {
    vi.mocked(fetchPulls).mockResolvedValue(data());
    show();

    const review = await screen.findByRole('region', { name: 'To review' });
    expect(within(review).getAllByRole('listitem')).toHaveLength(2);
    expect(within(review).getByText('Pull request 1')).toBeInTheDocument();
    expect(within(review).getByText('by robin')).toBeInTheDocument();

    const mine = screen.getByRole('region', { name: 'Your pull requests' });
    expect(within(mine).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('Signed in as octocat')).toBeInTheDocument();
  });

  it('links each pull request, with where it is and how long ago it changed', async () => {
    vi.mocked(fetchPulls).mockResolvedValue(data());
    show();

    const link = await screen.findByRole('link', { name: 'Pull request 1' });
    expect(link).toHaveAttribute('href', 'https://github.com/acme/app/pull/1');
    expect(link).toHaveAttribute('rel', 'noreferrer noopener');
    expect(link).not.toHaveAttribute('target');

    const item = link.closest('li')!;
    expect(item).toHaveTextContent('acme/app#1');
    expect(item).toHaveTextContent('2h');
  });

  it('opens them in a new tab if the board does', async () => {
    vi.mocked(fetchPulls).mockResolvedValue(data());
    show({}, true);

    expect(await screen.findByRole('link', { name: 'Pull request 1' })).toHaveAttribute(
      'target',
      '_blank'
    );
  });

  it('shows how each pull request’s checks are going, in words as well as colour', async () => {
    vi.mocked(fetchPulls).mockResolvedValue(
      data({
        review: [],
        reviewTotal: 0,
        mine: [
          pull(1, { checks: 'failing' }),
          pull(2, { checks: 'pending' }),
          pull(3, { checks: 'passing' }),
          pull(4, { checks: 'none' })
        ],
        mineTotal: 4
      })
    );
    show();

    await screen.findByText('Pull request 1');
    const states = screen
      .getAllByRole('img')
      .map((dot) => [dot.getAttribute('data-state'), dot.getAttribute('aria-label')]);
    expect(states).toEqual([
      ['failing', 'Checks failing'],
      ['pending', 'Checks running'],
      ['passing', 'Checks passing'],
      ['none', 'No checks']
    ]);
  });

  it('says where your own pull requests stand with their reviewers, and which are drafts', async () => {
    vi.mocked(fetchPulls).mockResolvedValue(
      data({
        mine: [
          pull(1, { review: 'approved' }),
          pull(2, { review: 'changes' }),
          pull(3, { review: 'required', draft: true }),
          pull(4, { review: 'none' })
        ],
        mineTotal: 4
      })
    );
    show();

    const mine = await screen.findByRole('region', { name: 'Your pull requests' });
    const tags = within(mine)
      .getAllByRole('listitem')
      .map((item) => Array.from(item.querySelectorAll('.prs-tag')).map((tag) => tag.textContent));
    expect(tags).toEqual([['Approved'], ['Changes requested'], ['Draft', 'Needs review'], []]);

    // What is waiting on you is waiting for you; where it stands with others is no news.
    const review = screen.getByRole('region', { name: 'To review' });
    expect(review.querySelector('.prs-tag')).toBeNull();
  });

  it('shows as many as it is set to, and points to the rest', async () => {
    vi.mocked(fetchPulls).mockResolvedValue(
      data({
        review: [pull(1), pull(2), pull(3), pull(4)],
        reviewTotal: 14,
        mine: [],
        mineTotal: 0
      })
    );
    show({ count: 3 });

    const review = await screen.findByRole('region', { name: 'To review' });
    expect(within(review).getAllByRole('listitem')).toHaveLength(3);
    expect(within(review).getByText('14')).toBeInTheDocument();
    expect(within(review).getByRole('link', { name: 'See all' })).toHaveAttribute(
      'href',
      'https://github.com/pulls/review-requested'
    );
  });

  it('has no “See all” when everything is already showing', async () => {
    vi.mocked(fetchPulls).mockResolvedValue(data());
    show({ count: 3 });

    await screen.findByText('Pull request 1');
    expect(screen.queryByRole('link', { name: 'See all' })).not.toBeInTheDocument();
  });

  it('points to all of your own pull requests on GitHub', async () => {
    vi.mocked(fetchPulls).mockResolvedValue(data({ mineTotal: 30 }));
    show({ count: 3 }, true);

    const mine = await screen.findByRole('region', { name: 'Your pull requests' });
    const all = within(mine).getByRole('link', { name: 'See all' });
    expect(all).toHaveAttribute('href', 'https://github.com/pulls');
    expect(all).toHaveAttribute('target', '_blank');
  });

  it.each([
    ['review', 'To review', 'Your pull requests'],
    ['mine', 'Your pull requests', 'To review']
  ] as const)('shows only %s when asked to', async (choice, shown, hidden) => {
    vi.mocked(fetchPulls).mockResolvedValue(data());
    show({ show: choice });

    expect(await screen.findByRole('region', { name: shown })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: hidden })).not.toBeInTheDocument();
  });

  it('says so when there is nothing to do', async () => {
    vi.mocked(fetchPulls).mockResolvedValue(
      data({ review: [], reviewTotal: 0, mine: [], mineTotal: 0 })
    );
    show();

    expect(await screen.findByText('Nothing is waiting on you.')).toBeInTheDocument();
    expect(screen.getByText('You have no open pull requests.')).toBeInTheDocument();
  });

  it('says what went wrong, and tries again on request', async () => {
    vi.mocked(fetchPulls).mockRejectedValueOnce(
      new Error('GitHub didn’t accept the token. It may have expired or been revoked.')
    );
    vi.mocked(fetchPulls).mockResolvedValueOnce(data());
    show();

    expect(await screen.findByRole('alert')).toHaveTextContent('GitHub didn’t accept the token.');

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Pull request 1')).toBeInTheDocument();
  });

  it('reads afresh for another token, without spelling the token out in its cache', async () => {
    vi.mocked(fetchPulls).mockResolvedValue(data());
    const view = show();
    await screen.findByText('Pull request 1');

    const other = 'ghp_zyxwvutsrqponmlkjihgfedcba9876543210';
    view.rerender(<PullsWidget widget={widgetOf({ token: other })} newTab={false} />);
    await vi.waitFor(() => expect(fetchPulls).toHaveBeenCalledTimes(2));

    expect(vi.mocked(fetchPulls).mock.calls[1]?.[0]).toBe(other);
    const keys = Object.keys(window.localStorage).filter((key) => key.includes('pulls'));
    expect(keys).toHaveLength(2);
    expect(keys.join()).not.toContain('github_pat');
    expect(keys.join()).not.toContain('ghp_');
  });
});
