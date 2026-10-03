# Home Slice

Home Slice is a personal dashboard for the sites you open every day: groups of
bookmarks on glass cards over a living koi pond, with weather, markets and news
alongside. A branch-name generator, [Branchify](#branchify-the-branch-name-tool),
is built in as a tool for devs.

It ships as a self-contained Docker image, so you can run it wherever you like —
a spare port on your laptop, a VPS, or a homelab box behind your own reverse
proxy. There's no backend or database: everything you set up lives in your
browser's `localStorage`, and you export it as YAML to keep a copy or move it
to another browser. I run my own instance from a self-hosted server at home,
and you're free to spin up your own the same way (see
[Docker (Static Hosting)](#docker-static-hosting) below).

## The Dashboard

- **Bookmarks in groups.** Every bookmark shows its site's favicon, found
  automatically, with a monogram while it loads or if a site has none. Each
  group lays its bookmarks out as **cards** (icon, name and description),
  **tiles** (a launcher of big icons) or a compact **list**.
- **Drag and snap.** Drag a bookmark to reorder it or carry it into another
  group. Drag a group or widget by its header to move it. In edit mode, drag a
  right edge to resize it; widths snap to a 12-column grid, and faint column
  guides show while you place things. The board packs itself like masonry, so a
  tall widget never leaves a hole beside it.
- **Adding is quick.** Press `N` or the `+` button, paste a link anywhere on the
  page, or drag a link in from another tab and drop it on a group. Names are
  guessed from the address, and you can change everything later.
- **Right-click for more.** Bookmarks open in a new tab, copy their link, edit,
  move to another group or delete. Groups change layout, collapse, move or
  delete. Every delete can be undone from its toast, or with `Ctrl Z`.
- **One search box.** Press `/` or `Ctrl K` to find a bookmark by name, address,
  description or group. Enter opens the top match, an address goes straight
  there, and anything else is searched on the web with the engine you choose.
- **Widgets.** Weather from Open-Meteo, in the style of glance's widget: twelve
  bars across the day with daylight and rain marked. Markets with a month of
  trend for stocks, indices, FX and crypto. A world clock, this month's
  calendar, the top of Hacker News, GitHub Trending, the strongest AI models
  from BenchLM, and the TV everyone is watching from TMDB.
- **Your Google Calendar.** The [Agenda](#agenda-your-google-calendar) widget
  shows the month with a dot under every day that has something on, and the
  days to come beneath it: what is on now, what is next and in how long, a
  button to join the call, and a click for the details.
- **For developers.** A [status bar](#status-alerts) that appears across the top
  only while a service you depend on is down, a [My PRs](#my-prs-reviews-and-ci)
  widget for the reviews waiting on you and your own pull requests with their
  checks, and a [focus timer](#focus-timer) that counts down in the tab's title.
- **A side bar, as in VS Code.** Tools, apps and Extensions down the left edge,
  with Add, Edit and Settings at the foot. It tucks away behind a small tab
  until the pointer reaches the edge; Settings → General keeps it out.
- **Glass over a background you choose.** The koi pond, Dreams (a calm drawn
  valley, by day or night), particles, a wallpaper of your own, or a quiet
  gradient. Blur and tint are adjustable.
- **Branchify is a tool on the board.** The **Branchify** button in the side bar,
  the `B` key or the address `/#branchify` opens it over the dashboard. Its
  recent branches still swim as koi, and copying a new branch still earns koi
  coins.

### Keyboard

| Keys            | Does                           |
| --------------- | ------------------------------ |
| `/` or `Ctrl K` | Search bookmarks and the web   |
| `N`             | Add a bookmark                 |
| `E`             | Edit the board                 |
| `B`             | Open Branchify                 |
| `Ctrl Z`        | Undo a delete                  |
| `Ctrl V`        | Paste a link to add it         |
| `Esc`           | Close a dialog, or leave edits |

### Your dashboard as YAML

The whole board is YAML, stored in `localStorage` under `dashboard-config`.
**Settings → Data & YAML** shows it in an editor you can change and apply,
exports it as a file, and imports one back. An export also carries your
Branchify settings, recent branches, background and koi pond, so importing it
in another browser restores everything.

```yaml
title: Home
name: Dan
newTab: true
search: google
clock: 24h
glass:
  blur: 18
  tint: 0.32
widgets:
  - type: weather
    width: 4
    location: Cape Town
    units: metric
  - type: markets
    width: 4
    symbols:
      - symbol: AAPL
        name: Apple
      - symbol: BTC-USD
groups:
  - name: GitHub
    icon: si-github
    width: 4
    style: cards
    bookmarks:
      - name: Pull requests
        url: https://github.com/pulls
        description: Reviews waiting on me
      - name: Notifications
        url: https://github.com/notifications
```

Widths are columns of the 12-column board, from 3 to 12. Leave `icon` out for
the site's favicon, or use the same forms homepage does: `si-github` (Simple
Icons), `mdi-home` (Material Design Icons), `sh-jellyfin` (selfh.st icons),
`plex.png` (dashboard-icons), an emoji, or any image address. Anything the
dashboard doesn't understand is dropped rather than breaking the page.

Imports also read a [homepage](https://gethomepage.dev) `bookmarks.yaml` or
`services.yaml`, and the bookmarks file every browser exports. Those are added
to your board, merging into groups with the same name and skipping links you
already have.

### Where the widgets get their data

Weather comes from [Open-Meteo](https://open-meteo.com) and news from the
Hacker News API, both straight from the browser with no key. Market prices
come from Yahoo Finance, which doesn't answer browsers on other sites, so the
page asks for them at `/api/markets/<symbol>` on its own server. The Vite dev
and preview servers and the Docker image's Nginx relay that one endpoint. A
plain static host without the relay shows a note in the markets widget instead
of prices. Readings are cached in `localStorage` so a reload paints at once.

GitHub Trending reads the static JSON that
[isboyjc/github-trending-api](https://github.com/isboyjc/github-trending-api)
publishes, straight from the browser.

The **AI Leaderboard** (from [BenchLM](https://benchlm.ai)) and **Popular TV**
(from [TMDB](https://www.themoviedb.org)) widgets need a key. Keys never go in
the page, the YAML or git: they live in a `.env` file on the server (copy
`.env.example`), and the page asks its own server at `/api/benchlm/rankings`
and `/api/tmdb/trending-tv`, which adds the key. Nginx keeps each answer for
84 hours, so each service is asked at most about twice a week however many
people visit, which keeps BenchLM's free 1,000 reads a month in hand. The
relays pass on only the ranking or the trending window, so a visitor can't
spend reads by varying the address.

The AI Leaderboard has two presets in its settings: **Frontier** (Overall,
every lab, 5 models) and **Budget** (Coding, at most $2 per million tokens,
5 models). While a widget's settings match one, its title says so, as "AI
Leaderboard · Budget". Its **Max price** setting keeps only models at or under that
price, counting three parts input to one part output, so a cheap input price
can't hide an expensive output. Prices come from BenchLM's public price list,
which needs no key but is licensed
[CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/): fine for a
personal dashboard, not for a commercial one without BenchLM's say-so. The page
asks `/api/benchlm/pricing` (Nginx keeps it for 84 hours, like the rankings) and
only does so when a price limit is set. Models are matched to prices by name; a
model BenchLM lists no price for, or whose name differs, is left out of a
capped list, and the footer says how many.

### Status alerts

A strip across the top of the page that appears **only while a service you
depend on is down**, and goes away when it recovers. Choose the services in
**Settings → General → Status alerts**: GitHub, npm, Cloudflare, Vercel,
Netlify, Docker, Anthropic, Discord and DigitalOcean. Nothing shows while they
are all well.

- It names the service and the incident, links to the service's own status page,
  and folds a second or third incident behind **N more**.
- **Dismiss** hides it until something changes: a new incident, or one that gets
  worse, brings it back.
- By default it is for outages. Turn on **Also tell me about slow or partly
  broken service** to hear about degraded service too.
- A service that can't be reached is left out quietly. The bar never raises an
  alarm of its own, and with nothing chosen it doesn't even ask.

Each of these services publishes an Atlassian Statuspage. The page asks
`/api/status/<id>` on its own server, and Nginx (or the Vite dev server) fetches
that one service's summary from the one host listed for its id in `nginx.conf`,
so the page can't point it anywhere else, and keeps each answer for two minutes.
A host without the relay (a plain static host) shows no bar. Adding a service is
one line in `src/dashboard/lib/status-services.ts` and one in `nginx.conf`; a test
fails if the two lists differ.

```yaml
status: # in the YAML next to the other settings
  - github
  - npm
statusDegraded: false # true to hear about slow service too
```

### My PRs: reviews and CI

The **My PRs** widget lists the pull requests **waiting for your review** and
**your own open ones**, each with a dot for how its checks are going: green
passing, red failing, amber running, hollow for none. Your own show where they
stand with reviewers (Approved, Changes requested, Needs review) and which are
drafts, and failing ones come first. **See all** goes to the rest on GitHub.

It needs a GitHub token, entered in the widget's settings:

1. Make a **read-only** token at
   [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new)
   with read access to **Pull requests**, **Commit statuses** and **Checks** on
   the repositories you want. (A classic token with the `repo` scope also works,
   but it can do far more than this needs.)
2. Open the widget's settings (the sliders icon) and paste it under **GitHub
   token**.

Treat the token like a password. It is saved with your dashboard in this browser,
and **it is in the YAML export too**, so an exported file carries it; the export
says so at the top. The page sends it to `api.github.com` and nowhere else
(GitHub's API answers browsers on other sites, so there is no relay), and the
widget's cache key holds only a fingerprint of it. It looks for new news every
two minutes. Revoke the token on GitHub if it ever leaks.

```yaml
widgets:
  - type: prs
    width: 6
    token: github_pat_… # read-only; keep this file private
    show: both # or review, or mine
    count: 5 # pull requests per list, 3 to 10
```

### Focus timer

A **Focus timer** widget: a ring that fills as a stretch goes, with **Start /
Pause**, **Reset** and **Skip**. A focus stretch is 25 minutes by default, then a
5-minute break, and the widget counts the focus stretches you finish today.

- The countdown shows in the **tab's title** while it runs (`24:31 · Focus`), so
  you can see it from another tab, and the title comes back when it stops.
- A soft chime marks the end of each stretch; turn it off in the widget's
  settings. When a stretch ends, the next one waits for you to press Start.
- It counts down to a moment, not by ticks, so it keeps time in a sleeping tab and
  **survives a reload**. A stretch that ran out while the page was closed is
  counted if it was just now, and let go if it was long ago.
- There is one timer per browser, shared by every Focus widget and every open
  tab of the dashboard, and it lives apart from the YAML (a running timer is not
  something to export).

```yaml
widgets:
  - type: focus
    focus: 25 # minutes of focus, 5 to 90
    rest: 5 # minutes of break, 1 to 30
    sound: true # false for no chime
```

### Agenda: your Google Calendar

The **Agenda** widget reads your Google Calendar. It is a month, with a dot
under each day that has something on, and the days from the one you pick
onward as a list. Beside the month, once the widget is half the board wide or
more, the list moves to the right.

- Today is circled, and the day you pick is outlined; the arrows (or `Page Up`
  and `Page Down`) turn the month, and **Today** brings you back. With the
  keyboard, the arrow keys, `Home` and `End` move between days.
- An event that is on shows **Now** and how far through it you are; the next
  one says how long until it starts. Events that are over fade.
- Click an event for its place (a link to the map), notes and exact times. If
  it has a Meet, Zoom, Teams or similar link, a button joins the call.
- All-day and multi-day events say which day of how many it is, repeating
  events and the days taken out of them come out as Google has them, and
  cancelled events stay hidden.
- Up to three calendars show in their own colours, with a key underneath.
- **List only** drops the month for a plain list of what is coming up.

It needs no Google sign-in or Cloud project: Google gives every calendar a
private web address that serves it as an iCal feed, and the dashboard reads
that. Read-only, and it works with any calendar that has such an address.

1. In Google Calendar, open **Settings**, pick the calendar under **Settings
   for my calendars**, and scroll to **Integrate calendar**.
2. Copy **Secret address in iCal format**.
3. Put it in `.env` as `CALENDAR_ICAL_URL`, with no quotes. For a second and a
   third calendar use `CALENDAR_ICAL_URL_2` and `CALENDAR_ICAL_URL_3`.
4. Restart the server, then add the **Agenda** widget.

Like the BenchLM and TMDB keys, the addresses never reach the page, the YAML or
git: the page asks this server at `/api/calendar/1` to `/3`, which fetches the
address it holds. Nginx keeps each feed for five minutes, so Google is asked
about that often however many people visit, and the page looks every ten.
Changes in Google Calendar can take a few minutes to show.

**This makes your calendar readable by anyone who can open the dashboard.**
That is fine on a home network, or behind a VPN or a reverse proxy with a
login. If the dashboard is open to the internet, put a login in front of it,
or leave the Agenda out. Reset the secret address in Google Calendar if it
ever leaks.

```yaml
widgets:
  - type: agenda
    width: 6
    weekStart: 1 # 0 for Sunday
    count: 6 # events in the list, 3 to 12
    month: true # false for the list alone
```

### Extensions

The **Extensions** button in the side bar turns Branchify and each widget on or
off, and installs apps: any site, opened over the board in a frame at its own
address, `/#app/<name>`. Doddle, a word game, is offered ready to install; add
anything else by its address. The site has to allow being framed.

## Branchify, the branch-name tool

Branchify is the branch-name generator built into Home Slice. Open it from the
side bar, with `B`, or at `/#branchify`.

- Fast branch name generation with simple inputs
- Supports optional ticket numbers while keeping the final branch visible
- Generates PR titles like `feat/BRF-123: Description.`
- Copies the generated branch name and full `git checkout -b` command
- Persists your latest values and recent branches in `localStorage`
- Fully static frontend output (`dist/`) with no backend runtime
- Mobile-friendly, minimal UI
- Recent branches swim as koi in the pond behind the dashboard, and copying a new branch earns coins for the daily koi market

## Branch Naming Formula

Branchify uses a simple, consistent branch naming pattern. The separators below
are the defaults; you can change them in Branchify's settings.

### With Ticket Number

```
<type>/<ticket-number>-<details>
```

**Example:** `feat/BRF-123-add-user-authentication`

### Without Ticket Number

```
<type>/<details>
```

**Example:** `feat/add-user-authentication`

### Components

- **Type** — The kind of work (e.g., `feat`, `fix`, `bugfix`, `chore`, `refactor`, `release`, `style`, `test`, `experiment`)
- **Ticket Number** — Optional project ticket/issue ID (e.g., `BRF-123`, `PROJ-456`)
- **Details** — A brief, lowercase kebab-case description of the work

## Output Format

Once you generate a branch name, Branchify provides three outputs:

### Branch Name

The formatted Git branch name ready to use, e.g.:

```
feat/add-user-authentication
```

### Git Command

A complete, ready-to-paste command to create and checkout the branch:

```
git checkout -b "feat/add-user-authentication"
```

### PR Title

A properly formatted pull request title following conventional commits. With a
ticket it becomes `feat/BRF-123: Add user authentication.`; without one it falls
back to `feat: Add user authentication.`

All three outputs are one-click copyable for quick pasting into your terminal or PR form.

## Koi Pond & Market

The default background is a 3D koi pond (three.js, with a 2D fallback when WebGL
isn't available). Out of the box, each recent branch swims as its own koi, and
a few resident koi keep the pond occupied. You set how many residents there are
under **Settings → Appearance → Fish always in the pond**. The koi swim under
the dashboard's glass, and the gaps between the cards are open water.

### Say hello

The pond has stones on its bed and water lilies on its surface, and the koi
swim over one and under the other.

- **Click the water** and a ring spreads from your fingertip. The koi notice,
  each in its own time (the bold ones first, the shyest not at all), and cruise
  over to investigate. When they arrive they rise to the surface and gulp at it,
  milling about for a while before sinking back to their own depth.
- **Right-click the water** to scatter a handful of pellets. They float and
  drift for about thirty seconds before sinking. Hungry koi come for the nearest
  one, rise, and take it with a splash. Chagoi are first to the food, as they
  are in real ponds.
- **Click a fish** to open its card: its name and what it means, its variety
  (with the kanji and the show family it is judged in), any traits it was born
  with, its personality, what it is doing right now, how big it is and could
  grow, and what it is worth. A bought fish also shows what you paid and how
  long it has been in the pond; a branch koi or a resident is named and
  appraised as its variety, and a branch koi shows the branch it swims for.
- **Click a fish's name** on its card to rename it. Enter or clicking away saves,
  Escape cancels, and names are tidied and capped at 24 characters. A fish from
  the market is renamed on the market's books, so the market and the pond agree;
  a branch koi or resident's name is kept in this browser, against its place in
  the pond.
- **Drag a fish** to carry it somewhere else in the pond. It rises toward the
  surface while you hold it, and swims calmly on from wherever you set it down.

Clicks on the cards, the side bar or any dialog are left alone, and the context
menu is only replaced over open water. With reduced motion on, the pond stays still: fish
can still be clicked for their card, but not carried.

### Real varieties

The market sells real nishikigoi varieties, from plain self-coloured fish to
patterned ones. Each variety is written as a recipe that says where its colour
sits:

- **Self-coloured:** Benigoi (red), Orenji Ogon (metallic orange), Yamabuki
  Ogon (gold), Platinum Ogon, Kigoi, Chagoi, Soragoi, Karasugoi, Aka Matsuba
- **Patterned:** Kohaku, Tancho, Taisho Sanke, Showa, Shiro Bekko, the three
  Utsuri, Asagi, Goshiki, Ochiba Shigure
- **Metallic and scaleless:** Kujaku, Hariwake, Shusui, Kumonryu, Beni
  Kumonryu, Kin Kikokuryu, and the rare Midorigoi

A fish can also be born with a trait: **Gin Rin** (sparkling scales),
**Doitsu** (scaleless) or **Butterfly** (long, flowing fins). Traits raise its
rarity and its price. A fish's genome is just its variety, traits and seed, so
the fish in a listing's photo is exactly the fish that swims in your pond.

### The market

With the koi pond selected, a koi button appears in the dashboard's side bar,
beside the Branchify button:

- **Daily stock.** The market lists six koi a day, seeded by the date, so
  everyone starts the day with the same fish. It restocks at local midnight.
  Every tank includes at least one self-coloured koi and one patterned one.
- **Buy one, another arrives.** A bought koi is replaced where it swam, so the
  tank always holds six. Can't wait for midnight? **Restock** swaps all six for
  a fresh tank for 100 coins.
- **Coins come from branching.** The first time a new branch name is copied
  or saved to your recent list, it earns 25 coins, up to 8 branches a day. New
  visitors start with 100 coins, plus 25 for each branch already in their
  recent list.
- **Koi for sale by age.** Like a dealer's, the tank is mostly tosai (koi in
  their first year) and nisai, with the odd sansai or older fish, and every tank
  has at least one tosai. Price follows size: half the length is a quarter of
  the price.
- **Fish grow.** A day for you is a week in the pond. Koi and goldfish follow a
  real growth curve (von Bertalanffy), fast when young and levelling off at an
  adult size set by their genes. A young koi grows about a centimetre every two
  or three days, and most top out in the seventies, with the odd 80 cm+ jumbo.
  Value grows with the square of length, and the market's **Your pond** tab
  shows the pond's total value, what it has gained, and how fast it is growing.
- **Your pond.** Once you own a market koi, market koi fill the whole pond and
  the branch koi and residents rest. The pond holds up to 10 koi. Releasing a
  fish pays back half of what it is worth now, and it's gone for good: it never
  returns to the market. Release them all and the branch koi return.
- **Goldfish.** A Goldfish tab sells real pond breeds (Common, Comet, Sarasa
  Comet, Shubunkin, Bristol Shubunkin, Wakin, Tamasaba and Fantail), always in
  stock and cheap. They swim alongside whichever koi are in the pond, up to 6,
  drawn to scale beside them and without barbels. Fancy breeds too delicate to
  share a pond with koi aren't sold.
- **How it works, and the koi guide.** A panel at the top of the market
  explains the rules. The book icon opens a short guide to koi: where they come
  from, how their names work, every variety grouped by show family, the traits,
  and where the market takes liberties.
- **Portraits.** The fish are photographed with the same renderer as the pond,
  and the koi under your pointer comes to life and swims in place.

There is no payment gateway and no server. Coins and koi live in `localStorage`
under `branchify-koi-market`. That key, and the other `branchify-*` ones, keep
the names the project had before it became Home Slice, so nobody's saved coins,
koi or settings are lost.

## Tech Stack

- [Vite 8](https://vite.dev/) (build + dev server)
- [React 19](https://react.dev/) + [TypeScript 6](https://www.typescriptlang.org/) in strict mode
- [three.js](https://threejs.org/) for the koi pond and [tsParticles](https://particles.js.org/) for the particles background
- [dnd kit](https://dndkit.com/) for dragging and sorting, [js-yaml](https://github.com/nodeca/js-yaml) for the YAML
- [Lucide](https://lucide.dev/) icons and the [Inter](https://rsms.me/inter/) typeface, both bundled
- [Vitest 5](https://vitest.dev/) + [Testing Library](https://testing-library.com/) on jsdom for tests, with V8 coverage
- ESLint 10 + Prettier for linting and formatting
- Nginx for static Docker hosting

Node 22.22.2 or newer (or 24.15+) is needed to build and test; the Docker image
builds with Node 24.

## Project Structure

```
src/
  app.tsx                     # The shell: background, koi market, Branchify, dashboard
  main.tsx                    # React entry point
  types.ts                    # Shared domain types
  dashboard/
    dashboard.tsx             # The board: dialogs, menus, shortcuts, paste and drop
    dashboard.css             # Glass, the grid, cards, widgets and dialogs
    components/               # Board (drag and drop), groups, cards, search, settings
    widgets/                  # Weather, markets, world clock, calendar, Hacker News
    hooks/                    # Board state with undo, cached fetches, masonry, resizing
    lib/                      # The YAML model, imports, icons, URLs and widget data
  branchify/
    use-branchify.ts          # The form and naming settings, saved while closed too
    branchify-sheet.tsx       # Branchify as a tool over the board
  components/
    branch-form.tsx           # Input form (type, ticket, description)
    branch-outputs.tsx        # Generated branch, git command, PR title
    recent-branches.tsx       # Recently generated branches list
    copy-button.tsx           # Copy-to-clipboard button with feedback
    particles-background.tsx  # Animated background
    koi3d-background.tsx      # The 3D koi pond (falls back to koi-background.tsx)
    koi-market.tsx            # The market dialog: today's koi and your pond
    koi-market-button.tsx     # Header button, new-stock dot and coin pop
    koi-guide.tsx             # The koi guide: history, names, varieties, traits
  hooks/
    use-recent-branches.ts    # Recent-branch state + persistence
    use-koi-account.ts        # Coins, owned koi, and the market day
  lib/
    branch-utils.ts           # Pure branch/PR-title formatting logic
    storage.ts                # Safe localStorage helpers + parsing
    koi-varieties.ts          # The nishikigoi catalogue, as pattern recipes
    koi-genome.ts             # Variety + traits + seed → a koi's exact look
    koi-market.ts             # The daily stock, names and prices
    koi-account.ts            # Earning, buying and releasing, as pure functions
    fish-growth.ts            # How fish grow, and what growing makes them worth
    goldfish.ts               # The pond goldfish breeds, as recipes
    goldfish-market.ts        # The always-in-stock goldfish counter
    koi-portrait.ts           # Photographs koi for the market's cards
    koi3d.ts                  # The pond stage: arrivals, departures, the panel
    koi-attention.ts          # How koi notice a touch on the water, and food
    koi-inspect.ts            # What a clicked fish's card says about it
    pond-decor.ts             # Stones on the bed, lilies on the surface
    pond-surface.ts           # Ripples and floating pellets
  test/                       # Shared test setup and a recording canvas stand-in
  vendor/koi-pond/            # The hyperfrontend koi, untouched (see its README)
```

Presentation lives in `components/`, reusable stateful behaviour in `hooks/`,
and all pure logic in `lib/` so it can be unit-tested in isolation. Tests sit
beside the code they cover, as `*.test.ts` and `*.test.tsx`.

## Local Development

```bash
npm install
npm run dev
```

Then open the local URL shown by Vite (typically `http://localhost:5173`). The
dev server also relays `/api/markets` to Yahoo Finance, so the markets widget
works locally, and BenchLM, TMDB and your calendars with the keys and
addresses in `.env` (copy `.env.example`). The dev server doesn't keep their answers the way nginx does;
the page's own cache asks at most twice a day.

## Testing & Quality

```bash
npm test            # run the unit and component test suite once
npm run test:watch  # watch mode for local development
npm run coverage    # run the suite with coverage, failing under the thresholds
npm run lint        # ESLint
npm run format      # apply Prettier formatting
npm run build       # type-check (tsc -b) and build
```

The pure logic in `src/lib/` is covered by fast unit tests, and the React
components, hooks and widgets are exercised with Testing Library: the board's
dialogs, drag and drop, keyboard and context menus, the widgets' loading, error
and empty states, and the pond's canvas and WebGL drawing through recording
stand-ins for the canvas and for three.js.

`npm run coverage` fails if line, statement or function coverage drops below
99%, or branch coverage below 93%, so new code arrives with its tests. At the
last count the suite ran about 2,000 tests at roughly 99.8% line coverage;
the few lines left are defensive guards that can't be reached. The suite runs
in UTC, so it gives the same answers on any machine.

CI runs lint, the formatting check, the tests with coverage and a production
build before any Docker image is built.

## Production Build

```bash
npm run build
```

The static site is written to `dist/`.

## Docker (Static Hosting)

The image is published on Docker Hub as
[`blades/homeslice`](https://hub.docker.com/r/blades/homeslice).

### Run the published image

```bash
docker run --rm -p 8080:80 --env-file .env blades/homeslice:latest
```

### Build it yourself

```bash
docker build -t blades/homeslice:latest .
```

The Dockerfile builds the site with Node 24 and serves it from Nginx. Then run
it as above.

`--env-file .env` gives the AI Leaderboard and Popular TV widgets their keys and
the Agenda its calendar addresses; leave it out and those widgets say they
aren't set up.

App will be available at `http://localhost:8080`.

## Docker Compose (Homelab Friendly)

```bash
docker compose up -d --build
```

This starts one service:

- `homeslice` (serves the static app on internal container port `80`)

It reads `.env` beside `docker-compose.yml` when there is one, for the
BenchLM and TMDB keys and the calendar addresses.

If you ran an earlier version of this project, its service was called
`branchify`. Add `--remove-orphans` once, so Compose removes the old container
instead of leaving it running beside the new one.

The included Nginx config supports SPA route refresh via `try_files ... /index.html`.

It also relays the markets widget's `/api/markets/<symbol>` requests to Yahoo
Finance's chart endpoint, and nothing else. The image installs it as a template
so Nginx resolves Yahoo with the container's own DNS servers per request, which
means the container starts even if DNS isn't up yet. Yahoo turns away TLS
handshakes that look scripted, so the relay offers a browser-like cipher order.

The Agenda's `/api/calendar/1` to `/api/calendar/3` relays work the same way for
the calendar addresses in `.env`: each fetches only its own address, passes
nothing the visitor sends, keeps the feed for five minutes and marks it
`private`. A calendar with no address answers `204`, which the widget reads as
not set up.

## GitHub Actions to Docker Hub

The workflow at `.github/workflows/docker-publish.yml` has two jobs:

1. **verify** installs with `npm ci` and runs lint, the formatting check, the
   tests with coverage and a production build.
2. **docker** builds the image once verify passes, and pushes it to Docker Hub
   unless the run is for a pull request.

It runs on pull requests to `main` (build only, nothing is pushed), on pushes
to `main`, on version tags such as `v1.2.0`, and by hand from the Actions tab
(**Run workflow**). A push publishes these tags:

- `latest`, for the default branch
- `sha-<commit>`, for traceability
- the tag's own name (`v1.2.0`), for a version tag

### Setting it up

Docker needs nothing more than the Dockerfile in this repo to build the image.
Publishing it needs a Docker Hub account and two secrets in GitHub:

1. **Docker Hub repository.** Create `homeslice` under the `blades` account at
   hub.docker.com. (Pushing to a repository that doesn't exist yet creates it
   too, but creating it first lets you choose whether it is public or private.)
2. **Docker Hub access token.** In Docker Hub go to _Account settings →
   Personal access tokens → Generate new token_, give it **Read & Write**
   access and copy the token. It is shown once.
3. **GitHub secrets.** In this repository go to _Settings → Secrets and
   variables → Actions → New repository secret_ and add:
   - `DOCKERHUB_USERNAME`: `blades`
   - `DOCKERHUB_TOKEN`: the token from step 2
4. **Publish.** Push to `main` (or run the workflow by hand). A few minutes
   later `blades/homeslice:latest` is on Docker Hub, and `docker compose pull`
   on the server fetches it.

The image name defaults to:

```text
<DOCKERHUB_USERNAME>/homeslice
```

To publish somewhere else, set the optional repository **variable** (under
_Settings → Secrets and variables → Actions → Variables_) `DOCKERHUB_REPOSITORY`
to the exact path, such as `blades/homeslice`; it overrides the default.

Pull request builds never log in or push. They build against a local fallback
image name, so a pull request validates even from a fork with no secrets. A
push to `main` without the two secrets fails at the Docker Hub login step.

## Notes

- This is a **static app**: no backend, no database, no runtime Node server.
  Everything you set up stays in your browser; the only thing the server does
  besides serving files is relay market prices.
- The Docker image uses multi-stage builds: Node for compile, Nginx for serving.
- Intended to sit cleanly behind an existing reverse proxy in a homelab setup.
