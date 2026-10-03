import { useCallback, type JSX } from 'react';
import { useRemote } from '../hooks/use-remote';
import { fingerprint } from '../lib/fingerprint';
import { timeAgo } from '../lib/hackernews';
import {
  fetchPulls,
  type Checks,
  type PullRequest,
  type PullsWidget as PullsWidgetConfig,
  type ReviewState
} from '../lib/pulls';
import { WidgetSkeleton, WidgetState } from './widget-frame';
import '../prs.css';

/** GitHub allows plenty of reads, and a pull request's checks change by the minute. */
const PULLS_TTL_MS = 2 * 60 * 1000;

const CHECK_LABELS: Readonly<Record<Checks, string>> = {
  passing: 'Checks passing',
  failing: 'Checks failing',
  pending: 'Checks running',
  none: 'No checks'
};

const REVIEW_LABELS: Readonly<Record<ReviewState, string>> = {
  approved: 'Approved',
  changes: 'Changes requested',
  required: 'Needs review',
  none: ''
};

const PullRow = ({
  pull,
  newTab,
  showReview
}: {
  pull: PullRequest;
  newTab: boolean;
  showReview: boolean;
}): JSX.Element => (
  <li className="prs-item">
    <span
      className="prs-ci"
      data-state={pull.checks}
      role="img"
      aria-label={CHECK_LABELS[pull.checks]}
      title={CHECK_LABELS[pull.checks]}
    />
    <div className="prs-text">
      <a
        className="prs-title"
        href={pull.url}
        target={newTab ? '_blank' : undefined}
        rel="noreferrer noopener"
      >
        {pull.title}
      </a>
      <span className="prs-meta">
        <span className="prs-repo">
          {pull.repo}#{pull.number}
        </span>
        {pull.author && <span>by {pull.author}</span>}
        {pull.updated > 0 && <span>{timeAgo(pull.updated)}</span>}
        {pull.draft && <span className="prs-tag">Draft</span>}
        {showReview && REVIEW_LABELS[pull.review] && (
          <span className="prs-tag" data-review={pull.review}>
            {REVIEW_LABELS[pull.review]}
          </span>
        )}
      </span>
    </div>
  </li>
);

const PullList = ({
  title,
  pulls,
  total,
  count,
  empty,
  allUrl,
  newTab,
  showReview
}: {
  title: string;
  pulls: PullRequest[];
  total: number;
  count: number;
  empty: string;
  allUrl: string;
  newTab: boolean;
  showReview: boolean;
}): JSX.Element => (
  <section className="prs-section" aria-label={title}>
    <h3 className="prs-head">
      <span>{title}</span>
      <span className="prs-count">{total}</span>
      {total > count && (
        <a
          className="prs-all"
          href={allUrl}
          target={newTab ? '_blank' : undefined}
          rel="noreferrer noopener"
        >
          See all
        </a>
      )}
    </h3>
    {pulls.length === 0 ? (
      <p className="prs-none">{empty}</p>
    ) : (
      <ul className="prs-list">
        {pulls.slice(0, count).map((pull) => (
          <PullRow key={pull.url} pull={pull} newTab={newTab} showReview={showReview} />
        ))}
      </ul>
    )}
  </section>
);

export const PullsWidget = ({
  widget,
  newTab
}: {
  widget: PullsWidgetConfig;
  newTab: boolean;
}): JSX.Element =>
  widget.token ? (
    <PullsBoard widget={widget} newTab={newTab} />
  ) : (
    <WidgetState>Add a GitHub token in this widget’s settings.</WidgetState>
  );

const PullsBoard = ({
  widget,
  newTab
}: {
  widget: PullsWidgetConfig;
  newTab: boolean;
}): JSX.Element => {
  const { token, show, count } = widget;
  const load = useCallback((signal: AbortSignal) => fetchPulls(token, signal), [token]);
  // The token is the reading's identity, but isn't spelled out in the cache's key.
  const { data, error, refresh } = useRemote(`pulls:${fingerprint(token)}`, PULLS_TTL_MS, load);

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
      <WidgetSkeleton rows={Math.min(count, 5)} />
    );
  }

  return (
    <div className="prs">
      {show !== 'mine' && (
        <PullList
          title="To review"
          pulls={data.review}
          total={data.reviewTotal}
          count={count}
          empty="Nothing is waiting on you."
          allUrl="https://github.com/pulls/review-requested"
          newTab={newTab}
          showReview={false}
        />
      )}
      {show !== 'review' && (
        <PullList
          title="Your pull requests"
          pulls={data.mine}
          total={data.mineTotal}
          count={count}
          empty="You have no open pull requests."
          allUrl="https://github.com/pulls"
          newTab={newTab}
          showReview
        />
      )}
      <p className="wdg-foot">Signed in as {data.login}</p>
    </div>
  );
};
