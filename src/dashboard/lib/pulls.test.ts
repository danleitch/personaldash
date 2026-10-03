import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchPulls, isToken, readPull, readToken } from './pulls';

const signal = new AbortController().signal;
const TOKEN = 'github_pat_11ABCDEFG0abcdefghijklmnopqrstuvwxyz';

const node = (overrides: Record<string, unknown> = {}) => ({
  number: 12,
  title: 'Add the thing',
  url: 'https://github.com/acme/app/pull/12',
  isDraft: false,
  updatedAt: '2026-10-03T12:00:00Z',
  reviewDecision: 'REVIEW_REQUIRED',
  repository: { nameWithOwner: 'acme/app' },
  author: { login: 'sam' },
  commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] },
  ...overrides
});

const json = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' }, ...init });

describe('tokens', () => {
  it.each(['ghp_abcdefghijklmnopqrstuvwxyz0123456789', TOKEN, 'a'.repeat(40), `  ${TOKEN}\n`])(
    'accepts %s',
    (value) => {
      expect(isToken(value)).toBe(true);
      expect(readToken(value)).toBe(value.trim());
    }
  );

  it.each([
    '',
    'short',
    'has spaces in the token value itself abcdefgh',
    'ghp_abcdefghijklmnopqrstuvwxyz!',
    'a'.repeat(300),
    'ghp_abcdefghijklmnopqrstuvwxyz\nsecond'
  ])('turns away %j', (value) => {
    expect(isToken(value)).toBe(false);
    expect(readToken(value)).toBe('');
  });

  it('reads nothing from what is not text', () => {
    expect(readToken(undefined)).toBe('');
    expect(readToken(42)).toBe('');
    expect(readToken({ token: TOKEN })).toBe('');
  });
});

describe('readPull', () => {
  it('reads a pull request', () => {
    expect(readPull(node())).toEqual({
      number: 12,
      title: 'Add the thing',
      url: 'https://github.com/acme/app/pull/12',
      repo: 'acme/app',
      author: 'sam',
      draft: false,
      updated: Date.parse('2026-10-03T12:00:00Z') / 1000,
      checks: 'passing',
      review: 'required'
    });
  });

  it.each([
    ['SUCCESS', 'passing'],
    ['FAILURE', 'failing'],
    ['ERROR', 'failing'],
    ['PENDING', 'pending'],
    ['EXPECTED', 'pending'],
    ['SOMETHING_NEW', 'none']
  ])('calls a %s check %s', (state, checks) => {
    const commits = { nodes: [{ commit: { statusCheckRollup: { state } } }] };
    expect(readPull(node({ commits }))?.checks).toBe(checks);
  });

  it('has no checks to report when there are none', () => {
    expect(
      readPull(node({ commits: { nodes: [{ commit: { statusCheckRollup: null } }] } }))?.checks
    ).toBe('none');
    expect(readPull(node({ commits: { nodes: [] } }))?.checks).toBe('none');
    expect(readPull(node({ commits: null }))?.checks).toBe('none');
    expect(readPull(node({ commits: { nodes: 'nonsense' } }))?.checks).toBe('none');
  });

  it.each([
    ['APPROVED', 'approved'],
    ['CHANGES_REQUESTED', 'changes'],
    ['REVIEW_REQUIRED', 'required'],
    [null, 'none'],
    ['SOMETHING_NEW', 'none']
  ])('reads a %s review decision as %s', (decision, review) => {
    expect(readPull(node({ reviewDecision: decision }))?.review).toBe(review);
  });

  it('copes with a ghost author, a draft, no title and an unreadable date', () => {
    const pull = readPull(
      node({ author: null, isDraft: true, title: '  ', updatedAt: 'yesterday-ish' })
    );

    expect(pull).toMatchObject({ author: '', draft: true, title: '(No title)', updated: 0 });
  });

  it('shortens what is long', () => {
    const pull = readPull(node({ title: 'x'.repeat(900) }));
    expect(pull?.title).toHaveLength(300);
  });

  it.each([
    ['nothing', null],
    ['text', 'nonsense'],
    ['a list', []],
    ['no number', node({ number: undefined })],
    ['a fractional number', node({ number: 1.5 })],
    ['an address that is not on github.com', node({ url: 'https://evil.test/acme/app/pull/12' })],
    ['a lookalike address', node({ url: 'https://github.com.evil.test/acme/app/pull/12' })],
    ['a script address', node({ url: 'javascript:alert(1)' })],
    ['no address', node({ url: undefined })]
  ])('leaves out %s', (_what, value) => {
    expect(readPull(value)).toBeNull();
  });
});

describe('fetchPulls', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Answers the who-am-I question, then the search. */
  const serve = (...answers: Array<Response | (() => Response | Promise<Response>)>) => {
    const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => {
      const next = answers.shift();
      return typeof next === 'function' ? next() : (next ?? json({}, { status: 500 }));
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };

  const viewer = (login = 'sam') => json({ data: { viewer: { login } } });
  const lists = (
    review: unknown[],
    mine: unknown[],
    totals: [number, number] = [review.length, mine.length]
  ) =>
    json({
      data: {
        review: { issueCount: totals[0], nodes: review },
        mine: { issueCount: totals[1], nodes: mine }
      }
    });

  it('asks who the token is for, then for that person’s pull requests', async () => {
    const fetchMock = serve(viewer('sam-the-dev'), lists([node()], [node({ number: 7 })]));

    const data = await fetchPulls(TOKEN, signal);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[1]!;
    expect(url).toBe('https://api.github.com/graphql');
    expect(init).toMatchObject({ method: 'POST', signal });
    expect(init.headers).toEqual({
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json'
    });

    const body = JSON.parse(String(init.body)) as {
      variables: { review: string; mine: string; n: number };
    };
    expect(body.variables.review).toBe(
      'is:pr is:open archived:false draft:false review-requested:sam-the-dev sort:updated-desc'
    );
    expect(body.variables.mine).toBe(
      'is:pr is:open archived:false author:sam-the-dev sort:updated-desc'
    );
    expect(body.variables.n).toBe(10);

    expect(data).toMatchObject({ login: 'sam-the-dev', reviewTotal: 1, mineTotal: 1 });
    expect(data.review[0]?.number).toBe(12);
    expect(data.mine[0]?.number).toBe(7);
  });

  it('never sends the token anywhere but GitHub’s API', async () => {
    const fetchMock = serve(viewer(), lists([], []));
    await fetchPulls(TOKEN, signal);

    expect(fetchMock.mock.calls.every(([url]) => url === 'https://api.github.com/graphql')).toBe(
      true
    );
  });

  it('puts the failing and pending pull requests of your own first, keeping the newest first within each', async () => {
    serve(
      viewer(),
      lists(
        [],
        [
          node({
            number: 1,
            commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] }
          }),
          node({
            number: 2,
            commits: { nodes: [{ commit: { statusCheckRollup: { state: 'PENDING' } } }] }
          }),
          node({
            number: 3,
            commits: { nodes: [{ commit: { statusCheckRollup: { state: 'FAILURE' } } }] }
          }),
          node({ number: 4, commits: { nodes: [] } }),
          node({
            number: 5,
            commits: { nodes: [{ commit: { statusCheckRollup: { state: 'ERROR' } } }] }
          })
        ]
      )
    );

    const data = await fetchPulls(TOKEN, signal);

    expect(data.mine.map((pull) => pull.number)).toEqual([3, 5, 2, 1, 4]);
  });

  it('leaves the review list in the order GitHub gave', async () => {
    serve(viewer(), lists([node({ number: 9 }), node({ number: 3 }), node({ number: 6 })], []));
    expect((await fetchPulls(TOKEN, signal)).review.map((pull) => pull.number)).toEqual([9, 3, 6]);
  });

  it('knows there are more than it was given, and never fewer than it holds', async () => {
    serve(viewer(), lists([node()], [node(), node({ number: 2 })], [37, 0]));
    const data = await fetchPulls(TOKEN, signal);

    expect(data.reviewTotal).toBe(37);
    expect(data.mineTotal).toBe(2);
  });

  it('copes with results GitHub could not give, and with a missing count', async () => {
    serve(
      viewer(),
      json({
        data: { review: { nodes: [null, node(), { number: 'x' }] }, mine: null },
        errors: [{ type: 'FORBIDDEN', message: 'Resource protected by organization SAML' }]
      })
    );

    const data = await fetchPulls(TOKEN, signal);

    expect(data.review).toHaveLength(1);
    expect(data.reviewTotal).toBe(1);
    expect(data.mine).toEqual([]);
  });

  describe('when GitHub says no', () => {
    it('says the token is not accepted, for a 401', async () => {
      serve(new Response('{}', { status: 401 }));

      await expect(fetchPulls(TOKEN, signal)).rejects.toThrow(
        'GitHub didn’t accept the token. It may have expired or been revoked.'
      );
    });

    it.each([[{ 'x-ratelimit-remaining': '0' }], [{ 'retry-after': '60' }]])(
      'says the limit has been reached, for a 403 with %j',
      async (headers) => {
        serve(new Response('{}', { status: 403, headers }));

        await expect(fetchPulls(TOKEN, signal)).rejects.toThrow('rate limit has been reached');
      }
    );

    it('says the token is not allowed, for any other 403', async () => {
      serve(new Response('{}', { status: 403 }));

      await expect(fetchPulls(TOKEN, signal)).rejects.toThrow(
        'This token isn’t allowed to read pull requests.'
      );
    });

    it('says the limit has been reached, for a 429', async () => {
      serve(new Response('{}', { status: 429, headers: { 'retry-after': '30' } }));

      await expect(fetchPulls(TOKEN, signal)).rejects.toThrow('rate limit has been reached');
    });

    it.each([
      ['RATE_LIMITED', 'rate limit has been reached'],
      ['FORBIDDEN', 'isn’t allowed to read pull requests'],
      ['INSUFFICIENT_SCOPES', 'isn’t allowed to read pull requests'],
      ['SOMETHING_ELSE', 'couldn’t look up your pull requests']
    ])('reads a %s error in an otherwise empty answer', async (type, message) => {
      serve(viewer(), json({ data: null, errors: [{ type, message: 'no' }] }));

      await expect(fetchPulls(TOKEN, signal)).rejects.toThrow(message);
    });

    it('says it did not answer, for a server error or an answer that is not JSON', async () => {
      serve(new Response('', { status: 502 }));
      await expect(fetchPulls(TOKEN, signal)).rejects.toThrow('GitHub didn’t answer.');

      serve(new Response('<html>', { status: 200 }));
      await expect(fetchPulls(TOKEN, signal)).rejects.toThrow(
        'couldn’t look up your pull requests'
      );
    });

    it('says it did not answer when the network fails', async () => {
      serve(() => {
        throw new TypeError('Failed to fetch');
      });

      await expect(fetchPulls(TOKEN, signal)).rejects.toThrow('GitHub didn’t answer.');
    });

    it('passes an abort on rather than calling it a failure', async () => {
      const controller = new AbortController();
      controller.abort();
      serve(() => {
        throw new DOMException('Aborted', 'AbortError');
      });

      await expect(fetchPulls(TOKEN, controller.signal)).rejects.toThrow('Aborted');
    });

    it.each(['', 'sam smith', 'sam is:public', 'a'.repeat(40), 'x"y'])(
      'will not search for a login that is %j',
      async (login) => {
        const fetchMock = serve(viewer(login));

        await expect(fetchPulls(TOKEN, signal)).rejects.toThrow(
          'GitHub didn’t say whose token this is.'
        );
        expect(fetchMock).toHaveBeenCalledTimes(1);
      }
    );
  });
});
