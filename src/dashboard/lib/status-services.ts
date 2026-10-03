/**
 * The services the status bar can watch. Each publishes its status as an
 * Atlassian Statuspage, and the page never names a host: it asks this site's
 * /api/status/<id> relay, which fetches the one host listed here for that id.
 * nginx.conf holds the same list, and a test keeps the two together.
 */
export type StatusService = { id: string; name: string; host: string };

export const STATUS_SERVICES: readonly StatusService[] = [
  { id: 'github', name: 'GitHub', host: 'www.githubstatus.com' },
  { id: 'npm', name: 'npm', host: 'status.npmjs.org' },
  { id: 'cloudflare', name: 'Cloudflare', host: 'www.cloudflarestatus.com' },
  { id: 'vercel', name: 'Vercel', host: 'www.vercel-status.com' },
  { id: 'netlify', name: 'Netlify', host: 'www.netlifystatus.com' },
  { id: 'docker', name: 'Docker', host: 'status.docker.com' },
  { id: 'anthropic', name: 'Anthropic', host: 'status.claude.com' },
  { id: 'discord', name: 'Discord', host: 'discordstatus.com' },
  { id: 'digitalocean', name: 'DigitalOcean', host: 'status.digitalocean.com' }
];

/** The services in a hand-edited list that exist, once each, in the order they are offered. */
export const readStatusIds = (value: unknown): string[] => {
  const given = new Set(Array.isArray(value) ? value : typeof value === 'string' ? [value] : []);
  return STATUS_SERVICES.filter((service) => given.has(service.id)).map((service) => service.id);
};
