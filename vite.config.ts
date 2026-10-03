/// <reference types="vitest/config" />
import { Agent } from 'node:https';
import { defineConfig, loadEnv, type ProxyOptions } from 'vite';
import { STATUS_SERVICES } from './src/dashboard/lib/status-services.ts';

/**
 * Yahoo turns away TLS handshakes that look like a script's (Node's default
 * cipher order gets a 429 every time) and lets a browser-like order through.
 * nginx.conf offers the same list.
 */
const BROWSER_LIKE_CIPHERS = [
  'TLS_AES_128_GCM_SHA256',
  'TLS_AES_256_GCM_SHA384',
  'TLS_CHACHA20_POLY1305_SHA256',
  'ECDHE-ECDSA-AES128-GCM-SHA256',
  'ECDHE-RSA-AES128-GCM-SHA256',
  'ECDHE-ECDSA-AES256-GCM-SHA384',
  'ECDHE-RSA-AES256-GCM-SHA384',
  'ECDHE-ECDSA-CHACHA20-POLY1305',
  'ECDHE-RSA-CHACHA20-POLY1305',
  'ECDHE-RSA-AES128-SHA',
  'ECDHE-RSA-AES256-SHA',
  'AES128-GCM-SHA256',
  'AES256-GCM-SHA384',
  'AES128-SHA',
  'AES256-SHA'
].join(':');

/**
 * The dashboard's markets widget reads Yahoo Finance, which doesn't answer
 * browsers on other sites. The dev and preview servers relay it at the same
 * address the Docker image's nginx does.
 */
const marketsProxy: Record<string, ProxyOptions> = {
  '/api/markets': {
    target: 'https://query1.finance.yahoo.com',
    changeOrigin: true,
    agent: new Agent({ keepAlive: true, ciphers: BROWSER_LIKE_CIPHERS }),
    rewrite: (path) => path.replace(/^\/api\/markets/, '/v8/finance/chart'),
    headers: {
      'User-Agent':
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36'
    }
  }
};

/** One of the few values a relay passes on; anything else becomes the first. */
const oneOf = (path: string, name: string, options: readonly string[]): string => {
  const value = new URL(path, 'http://relay').searchParams.get(name) ?? '';
  return options.includes(value) ? value : options[0];
};

/**
 * BenchLM and TMDB need a key, which lives in .env beside this file and never
 * reaches the page: these relays add it, as nginx.conf does in the Docker
 * image. Only the one endpoint each widget reads, with its settings checked.
 */
const keyedProxies = (env: Record<string, string>): Record<string, ProxyOptions> => ({
  '/api/benchlm/rankings': {
    target: 'https://data.benchlm.ai',
    changeOrigin: true,
    rewrite: (path) =>
      `/v1/rankings/current?surface=${oneOf(path, 'surface', ['overall', 'coding', 'agentic', 'knowledge'])}&limit=50`,
    headers: { Authorization: `Bearer ${env.BENCHLM_TOKEN ?? ''}` }
  },
  '/api/tmdb/trending-tv': {
    target: 'https://api.themoviedb.org',
    changeOrigin: true,
    rewrite: (path) => `/3/trending/tv/${oneOf(path, 'window', ['week', 'day'])}?language=en-US`,
    headers: { Authorization: `Bearer ${env.TMDB_TOKEN ?? ''}` }
  }
});

/**
 * The AI Leaderboard's budget view reads BenchLM's public price list, which
 * needs no key. It comes in pages of 200 models; only those offsets pass.
 */
const pricingProxy: Record<string, ProxyOptions> = {
  '/api/benchlm/pricing': {
    target: 'https://benchlm.ai',
    changeOrigin: true,
    rewrite: (path) =>
      `/api/data/pricing?limit=200&offset=${oneOf(path, 'offset', ['0', '200', '400', '600', '800'])}`
  }
};

/** The Agenda widget reads up to three calendars, one variable each (see .env.example). */
const CALENDAR_VARIABLES = ['CALENDAR_ICAL_URL', 'CALENDAR_ICAL_URL_2', 'CALENDAR_ICAL_URL_3'];

/**
 * A calendar's secret iCal address is its key, so these relays hold it as
 * nginx.conf does: /api/calendar/1 to /3 each fetch their one address, whatever
 * the page asks for. A calendar with no address answers 204 (no content), which
 * the widget reads as "not set up", without the browser logging an error.
 */
const calendarProxies = (env: Record<string, string>): Record<string, ProxyOptions> =>
  Object.fromEntries(
    CALENDAR_VARIABLES.map((name, index): [string, ProxyOptions] => {
      let address: URL | null = null;

      try {
        address = new URL(env[name] ?? '');
      } catch {
        /* unset, or not an address: the relay says so below */
      }

      return [
        `^/api/calendar/${index + 1}$`,
        address
          ? {
              target: address.origin,
              changeOrigin: true,
              rewrite: () => `${address.pathname}${address.search}`
            }
          : {
              bypass: (_request, response) => {
                if (response) {
                  response.statusCode = 204;
                  response.end();
                }

                // A string tells Vite the request is handled; it stops once the response has ended.
                return '/';
              }
            }
      ];
    })
  );

/**
 * The status bar's services: /api/status/<id> fetches that service's Statuspage
 * summary from the one host listed for it, whatever the page asks for.
 */
const statusProxies: Record<string, ProxyOptions> = Object.fromEntries(
  STATUS_SERVICES.map((service): [string, ProxyOptions] => [
    `/api/status/${service.id}`,
    {
      target: `https://${service.host}`,
      changeOrigin: true,
      rewrite: () => '/api/v2/summary.json'
    }
  ])
);

export default defineConfig(({ mode }) => {
  // Every variable, not only VITE_ ones; none of these are put in the bundle.
  const env = loadEnv(mode, process.cwd(), '');
  const proxy = {
    ...marketsProxy,
    ...pricingProxy,
    ...keyedProxies(env),
    ...calendarProxies(env),
    ...statusProxies
  };

  return {
    server: {
      host: true,
      port: 5173,
      proxy
    },
    preview: {
      proxy
    },
    test: {
      globals: true,
      environment: 'jsdom',
      globalSetup: './vitest.global-setup.ts',
      setupFiles: './src/test/setup.ts',
      // Only this app's tests; reference checkouts beside it bring their own.
      include: ['src/**/*.test.{ts,tsx}'],
      css: true,
      coverage: {
        provider: 'v8',
        include: ['src/**/*.{ts,tsx}'],
        exclude: [
          'src/**/*.test.{ts,tsx}',
          'src/main.tsx',
          'src/test/**',
          'src/declarations.d.ts',
          'src/vendor/**'
        ],
        reporter: ['text-summary', 'lcov'],
        // A little under what the suite reaches, so a change that leaves new code
        // untested fails `npm run coverage` (and CI) rather than slipping by. What is
        // left is defensive: guards on refs that are always set, float fallbacks.
        thresholds: {
          lines: 99,
          statements: 99,
          functions: 99,
          branches: 93
        }
      }
    }
  };
});
