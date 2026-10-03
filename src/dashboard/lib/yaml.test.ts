import { describe, expect, it } from 'vitest';
import { createStarterConfig, sanitizeConfig } from './model';
import { configToYaml, exportYaml, planImport, yamlToConfig } from './yaml';

const strip = <T>(value: T): T =>
  JSON.parse(JSON.stringify(value, (key, field) => (key === 'id' ? undefined : field))) as T;

describe('dashboard YAML', () => {
  it('round-trips a board, leaving the runtime ids out of the file', () => {
    const config = createStarterConfig();
    const yaml = configToYaml(config);

    expect(yaml).not.toMatch(/\bid:/);
    expect(yaml).toContain('# Your dashboard');

    const parsed = yamlToConfig(yaml);
    expect(parsed.ok).toBe(true);
    expect(parsed.ok && strip(parsed.value)).toEqual(strip(config));
  });

  it('carries the status bar’s services in the export, and leaves them out when there are none', () => {
    const watching = configToYaml(
      sanitizeConfig({ status: ['npm', 'github'], statusDegraded: true })
    );

    expect(watching).toMatch(/^status:\n {2}- github\n {2}- npm$/m);
    expect(watching).toMatch(/^statusDegraded: true$/m);

    const parsed = yamlToConfig(watching);
    expect(parsed.ok && parsed.value.status).toEqual(['github', 'npm']);
    expect(parsed.ok && parsed.value.statusDegraded).toBe(true);

    const quiet = configToYaml(sanitizeConfig({}));
    expect(quiet).not.toContain('status');
  });

  it('carries a My PRs token in the export, and warns that it is private', () => {
    const token = 'github_pat_11ABCDEFG0abcdefghijklmnopqrstuvwxyz';
    const yaml = configToYaml(sanitizeConfig({ widgets: [{ type: 'prs', token, show: 'mine' }] }));

    expect(yaml).toContain(`token: ${token}`);
    expect(yaml).toMatch(/A My PRs widget keeps its GitHub token here\./);

    const parsed = yamlToConfig(yaml);
    expect(parsed.ok && parsed.value.pages[0].widgets[0]).toMatchObject({
      type: 'prs',
      token,
      show: 'mine'
    });
  });

  it('leaves out fields that are at their defaults', () => {
    const yaml = configToYaml(
      sanitizeConfig({
        groups: [{ name: 'Code', bookmarks: [{ name: 'GitHub', url: 'https://github.com' }] }]
      })
    );

    expect(yaml).not.toContain('description:');
    expect(yaml).not.toContain('icon:');
    expect(yaml).not.toContain('collapsed:');
    expect(yaml).toContain('url: https://github.com');
  });

  it('says which line is wrong in YAML that does not parse', () => {
    const parsed = yamlToConfig('title: Home\ngroups:\n  - name: [unclosed\n');

    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.problem.line).toBeGreaterThan(1);
  });

  it('refuses YAML that is not a board at all', () => {
    const parsed = yamlToConfig('- just\n- a list\n');

    expect(parsed.ok).toBe(false);
  });

  it('carries Branchify and pond state in an export', () => {
    const yaml = exportYaml(createStarterConfig(), { background: 'koi', 'pond-fish': 4 });
    const plan = planImport(yaml);

    expect(plan.ok).toBe(true);
    expect(plan.ok && plan.value.source).toBe('dashboard');
    expect(plan.ok && plan.value.saved).toEqual({ background: 'koi', 'pond-fish': 4 });
    expect(plan.ok && plan.value.config?.pages[0].groups).toHaveLength(3);
  });
});

describe('importing', () => {
  it('reads a homepage bookmarks.yaml, icons and all', () => {
    const plan = planImport(`
- Developer:
    - Github:
        - abbr: GH
          href: https://github.com/
          icon: si-github
    - Stack Overflow:
        - href: https://stackoverflow.com/
- Social:
    - Reddit:
        - href: https://reddit.com/
          description: The front page
`);

    expect(plan.ok).toBe(true);

    if (!plan.ok) {
      return;
    }

    expect(plan.value.source).toBe('homepage');
    expect(plan.value.groups.map((group) => group.name)).toEqual(['Developer', 'Social']);
    expect(plan.value.groups[0].bookmarks[0]).toMatchObject({
      name: 'Github',
      url: 'https://github.com/',
      icon: 'si-github'
    });
    expect(plan.value.groups[1].bookmarks[0].description).toBe('The front page');
  });

  it('reads a homepage services.yaml too', () => {
    const plan = planImport(`
- Media:
    - Plex:
        href: http://plex.lan:32400
        icon: plex.png
        description: Movies
`);

    expect(plan.ok && plan.value.groups[0].bookmarks[0]).toMatchObject({
      name: 'Plex',
      url: 'http://plex.lan:32400',
      icon: 'plex.png'
    });
  });

  it('follows YAML merge keys, as homepage files use them', () => {
    const plan = planImport(`
- Media:
    - Plex: &media
        href: http://plex.lan:32400
        icon: plex.png
    - Jellyfin:
        <<: *media
        href: http://jellyfin.lan:8096
`);

    expect(plan.ok && plan.value.groups[0].bookmarks[1]).toMatchObject({
      name: 'Jellyfin',
      url: 'http://jellyfin.lan:8096',
      icon: 'plex.png'
    });
  });

  it('reads the bookmarks file a browser exports, folder by folder', () => {
    const plan = planImport(`<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3>Bookmarks bar</H3>
    <DL><p>
        <DT><A HREF="https://news.ycombinator.com/">Hacker News</A>
        <DT><H3>Work</H3>
        <DL><p>
            <DT><A HREF="https://github.com/pulls">Pull requests</A>
            <DT><A HREF="javascript:void(0)">A bookmarklet</A>
        </DL><p>
    </DL><p>
</DL><p>`);

    expect(plan.ok).toBe(true);

    if (!plan.ok) {
      return;
    }

    expect(plan.value.source).toBe('browser');
    expect(plan.value.groups.map((group) => [group.name, group.bookmarks.length])).toEqual([
      ['Bookmarks bar', 1],
      ['Work', 1]
    ]);
    expect(plan.value.groups[1].bookmarks[0]).toMatchObject({
      name: 'Pull requests',
      url: 'https://github.com/pulls'
    });
  });

  it('explains when a file is none of the formats it knows', () => {
    const plan = planImport('hello: world\n');

    expect(plan.ok).toBe(false);
    expect(!plan.ok && plan.problem.message).toMatch(/isn’t a dashboard export/);
  });
});
