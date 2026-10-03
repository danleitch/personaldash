/**
 * The My PRs widget: the pull requests waiting for your review, and your own
 * open ones with how their checks are going, from GitHub's GraphQL API. The
 * API answers browsers on other sites, so the page asks it directly with a
 * token you give the widget: it is saved in this browser and in the YAML
 * export, which is why the settings ask for a read-only one.
 */
export type PullsShow = 'both' | 'review' | 'mine';

export const PULLS_SHOWS: readonly PullsShow[] = ['both', 'review', 'mine'];

export type PullsWidget = {
  id: string;
  type: 'prs';
  width: number;
  /** A GitHub token that can read pull requests and their checks; empty until one is given. */
  token: string;
  show: PullsShow;
  /** How many pull requests each list shows. */
  count: number;
};

/** Classic (ghp_…), fine-grained (github_pat_…) and the older 40-character tokens all look like this. */
const TOKEN = /^[A-Za-z0-9_]{20,255}$/;

/** A token as it is kept, or empty when what was given can't be one. */
export const readToken = (value: unknown): string =>
  typeof value === 'string' && TOKEN.test(value.trim()) ? value.trim() : '';

export const isToken = (value: string): boolean => TOKEN.test(value.trim());

export type Checks = 'passing' | 'failing' | 'pending' | 'none';
export type ReviewState = 'approved' | 'changes' | 'required' | 'none';

export type PullRequest = {
  number: number;
  title: string;
  url: string;
  /** owner/name */
  repo: string;
  author: string;
  draft: boolean;
  /** Seconds since 1970, as the other widgets' time-ago takes. */
  updated: number;
  checks: Checks;
  review: ReviewState;
};

export type PullsData = {
  login: string;
  review: PullRequest[];
  /** How many there are in all; the list holds only the first few. */
  reviewTotal: number;
  mine: PullRequest[];
  mineTotal: number;
};

/** The most each list is asked for; the widget shows as many of them as it is set to. */
export const PULLS_FETCHED = 10;

const API = 'https://api.github.com/graphql';

const PULL = `fragment pull on PullRequest {
  number
  title
  url
  isDraft
  updatedAt
  reviewDecision
  repository { nameWithOwner }
  author { login }
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
}`;

const WHO = 'query { viewer { login } }';

const LISTS = `query($review: String!, $mine: String!, $n: Int!) {
  review: search(query: $review, type: ISSUE, first: $n) { issueCount nodes { ...pull } }
  mine: search(query: $mine, type: ISSUE, first: $n) { issueCount nodes { ...pull } }
}
${PULL}`;

type GraphQlError = { type?: unknown; message?: unknown };
type GraphQlAnswer = { data?: Record<string, unknown> | null; errors?: GraphQlError[] };

const isRateLimited = (response: Response): boolean =>
  response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after');

const ask = async (
  token: string,
  query: string,
  variables: Record<string, unknown>,
  signal: AbortSignal
): Promise<Record<string, unknown>> => {
  let response: Response | null = null;

  try {
    response = await fetch(API, {
      method: 'POST',
      signal,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables })
    });
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }
  }

  if (!response) {
    throw new Error('GitHub didn’t answer.');
  }

  if (response.status === 401) {
    throw new Error('GitHub didn’t accept the token. It may have expired or been revoked.');
  }

  if (response.status === 403 || response.status === 429) {
    throw new Error(
      isRateLimited(response)
        ? 'GitHub’s rate limit has been reached; it will try again later.'
        : 'This token isn’t allowed to read pull requests.'
    );
  }

  if (!response.ok) {
    throw new Error('GitHub didn’t answer.');
  }

  const answer = (await response.json().catch(() => null)) as GraphQlAnswer | null;

  // Some results can be missing (an organisation that wants SAML, say) while the rest is fine.
  if (answer?.data) {
    return answer.data;
  }

  const types = (answer?.errors ?? []).map((error) => String(error.type));

  if (types.includes('RATE_LIMITED')) {
    throw new Error('GitHub’s rate limit has been reached; it will try again later.');
  }

  if (types.some((type) => ['FORBIDDEN', 'INSUFFICIENT_SCOPES'].includes(type))) {
    throw new Error('This token isn’t allowed to read pull requests.');
  }

  throw new Error('GitHub couldn’t look up your pull requests.');
};

const text = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

const object = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const first = (value: unknown): unknown => (Array.isArray(value) ? value[0] : undefined);

const checksOf = (state: unknown): Checks =>
  state === 'SUCCESS'
    ? 'passing'
    : state === 'FAILURE' || state === 'ERROR'
      ? 'failing'
      : state === 'PENDING' || state === 'EXPECTED'
        ? 'pending'
        : 'none';

const reviewOf = (decision: unknown): ReviewState =>
  decision === 'APPROVED'
    ? 'approved'
    : decision === 'CHANGES_REQUESTED'
      ? 'changes'
      : decision === 'REVIEW_REQUIRED'
        ? 'required'
        : 'none';

/** A pull request from GitHub's answer, or null when it isn't one we can show and link to. */
export const readPull = (node: unknown): PullRequest | null => {
  const raw = object(node);
  const url = text(raw.url, 300);
  const number = raw.number;

  // Only a github.com address is linked, whatever the answer says.
  if (
    typeof number !== 'number' ||
    !Number.isInteger(number) ||
    !/^https:\/\/github\.com\//.test(url)
  ) {
    return null;
  }

  const rollup = object(object(object(first(object(raw.commits).nodes)).commit).statusCheckRollup);
  const updated = Date.parse(text(raw.updatedAt, 40));

  return {
    number,
    title: text(raw.title, 300) || '(No title)',
    url,
    repo: text(object(raw.repository).nameWithOwner, 140),
    author: text(object(raw.author).login, 60),
    draft: raw.isDraft === true,
    updated: Number.isNaN(updated) ? 0 : Math.floor(updated / 1000),
    checks: checksOf(rollup.state),
    review: reviewOf(raw.reviewDecision)
  };
};

const readList = (value: unknown): { pulls: PullRequest[]; total: number } => {
  const list = object(value);
  const pulls = (Array.isArray(list.nodes) ? list.nodes : [])
    .map(readPull)
    .filter((pull): pull is PullRequest => pull !== null);
  const total = typeof list.issueCount === 'number' ? list.issueCount : pulls.length;

  return { pulls, total: Math.max(total, pulls.length) };
};

const WEIGHT: Readonly<Record<Checks, number>> = { failing: 0, pending: 1, none: 2, passing: 2 };

/** The pull requests the token's owner has to deal with, failing ones first among their own. */
export const fetchPulls = async (token: string, signal: AbortSignal): Promise<PullsData> => {
  const who = object(object(await ask(token, WHO, {}, signal)).viewer);
  const login = text(who.login, 60);

  // A login is letters, digits and hyphens; it goes into a search, so nothing else may.
  if (!/^[A-Za-z0-9-]{1,39}$/.test(login)) {
    throw new Error('GitHub didn’t say whose token this is.');
  }

  const found = await ask(
    token,
    LISTS,
    {
      review: `is:pr is:open archived:false draft:false review-requested:${login} sort:updated-desc`,
      mine: `is:pr is:open archived:false author:${login} sort:updated-desc`,
      n: PULLS_FETCHED
    },
    signal
  );
  const review = readList(found.review);
  const mine = readList(found.mine);

  return {
    login,
    review: review.pulls,
    reviewTotal: review.total,
    // The sort is stable, so within a weight the most recently updated stays first.
    mine: [...mine.pulls].sort((a, b) => WEIGHT[a.checks] - WEIGHT[b.checks]),
    mineTotal: mine.total
  };
};
