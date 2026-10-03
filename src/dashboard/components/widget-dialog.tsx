import { useId, useMemo, useState, type FormEvent, type JSX } from 'react';
import { Plus, X } from 'lucide-react';
import {
  BENCH_PRESETS,
  BENCH_SURFACES,
  SURFACE_LABELS,
  presetOf,
  type BenchPreset
} from '../lib/benchlm';
import { FOCUS_LIMITS } from '../lib/focus';
import { POPULAR_LANGUAGES, TRENDING_SINCE, languageSlug } from '../lib/github';
import { isToken, readToken } from '../lib/pulls';
import {
  WIDGET_BLURBS,
  WIDGET_LABELS,
  WIDGET_TYPES,
  type ClockZone,
  type MarketSymbol,
  type Widget,
  type WidgetType
} from '../lib/model';
import { WIDGET_ICONS } from '../widgets/widget-icons';
import { WIDTH_OPTIONS } from './layout-options';
import { Field, Modal, Segmented, Switch } from './ui';

export const WidgetPicker = ({
  types = WIDGET_TYPES,
  onPick,
  onClose
}: {
  /** The widgets whose extensions are turned on. */
  types?: readonly WidgetType[];
  onPick: (type: WidgetType) => void;
  onClose: () => void;
}): JSX.Element => (
  <Modal title="Add a widget" subtitle="Widgets sit above your groups." onClose={onClose}>
    <div className="picker">
      {types.length === 0 && (
        <p className="field-hint">
          Every widget is turned off. Turn some back on in Extensions, in the side bar.
        </p>
      )}
      {types.map((type) => {
        const Icon = WIDGET_ICONS[type];
        return (
          <button key={type} type="button" className="picker-option" onClick={() => onPick(type)}>
            <span className="picker-icon">
              <Icon size={20} aria-hidden="true" />
            </span>
            <span className="picker-text">
              <span className="picker-label">{WIDGET_LABELS[type]}</span>
              <span className="picker-blurb">{WIDGET_BLURBS[type]}</span>
            </span>
          </button>
        );
      })}
    </div>
  </Modal>
);

const BENCH_PRESET_NAMES = Object.keys(BENCH_PRESETS) as BenchPreset[];

/** Dollars per million tokens; 0 is no limit. */
const MAX_PRICES = [0, 0.5, 1, 2, 5] as const;

const supportedZones = (): string[] => {
  try {
    return (Intl as unknown as { supportedValuesOf: (key: string) => string[] }).supportedValuesOf(
      'timeZone'
    );
  } catch {
    return ['UTC', 'Europe/London', 'America/New_York', 'Asia/Tokyo'];
  }
};

const isZone = (zone: string): boolean => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
};

type WidgetDialogProps = {
  widget: Widget;
  onSave: (widget: Widget) => void;
  onClose: () => void;
};

/** Each widget's own settings, written back as a whole widget. */
export const WidgetDialog = ({ widget, onSave, onClose }: WidgetDialogProps): JSX.Element => {
  const [draft, setDraft] = useState<Widget>(widget);
  const [error, setError] = useState('');
  const zoneList = useId();
  const zones = useMemo(supportedZones, []);

  const patch = (changes: Partial<Widget>): void => {
    setDraft((current) => ({ ...current, ...changes }) as Widget);
    setError('');
  };

  const submit = (event: FormEvent): void => {
    event.preventDefault();

    if (draft.type === 'weather' && !draft.location.trim()) {
      setError('Choose a place.');
      return;
    }

    if (draft.type === 'clock') {
      // Blank rows are left out below, so only a zone that was actually typed can be wrong.
      const bad = draft.zones.find((zone) => zone.zone.trim() && !isZone(zone.zone));

      if (bad) {
        setError(`“${bad.zone}” isn’t a time zone. Try one like Europe/Paris.`);
        return;
      }
    }

    if (draft.type === 'prs' && draft.token.trim() && !isToken(draft.token)) {
      setError(
        'That doesn’t look like a GitHub token. It is letters, numbers and underscores, 20 or more of them, like github_pat_… or ghp_…'
      );
      return;
    }

    const cleaned: Widget =
      draft.type === 'markets'
        ? {
            ...draft,
            symbols: draft.symbols
              .map((item) => ({ symbol: item.symbol.trim().toUpperCase(), name: item.name.trim() }))
              .filter((item) => item.symbol)
          }
        : draft.type === 'clock'
          ? { ...draft, zones: draft.zones.filter((zone) => zone.zone.trim()) }
          : draft.type === 'weather'
            ? { ...draft, location: draft.location.trim() }
            : draft.type === 'github'
              ? { ...draft, language: languageSlug(draft.language) }
              : draft.type === 'prs'
                ? { ...draft, token: readToken(draft.token) }
                : draft;

    onSave(cleaned);
  };

  const Icon = WIDGET_ICONS[widget.type];

  return (
    <Modal
      title={
        <span className="title-with-icon">
          <Icon size={18} aria-hidden="true" />
          {WIDGET_LABELS[widget.type]}
        </span>
      }
      size="sm"
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="widget-form" className="btn btn-primary">
            Save
          </button>
        </>
      }
    >
      <form id="widget-form" className="form" onSubmit={submit} noValidate>
        {draft.type === 'weather' && (
          <>
            <Field
              label="Place"
              hint="A city, or “City, Region, Country” to pick between places with one name."
              error={error}
            >
              <input
                type="text"
                value={draft.location}
                placeholder="Cape Town"
                data-autofocus=""
                onChange={(event) => patch({ location: event.target.value })}
              />
            </Field>
            <div className="field">
              <span className="field-label">Units</span>
              <Segmented
                label="Units"
                value={draft.units}
                options={[
                  { value: 'metric', label: '°C, km/h' },
                  { value: 'imperial', label: '°F, mph' }
                ]}
                onChange={(units) => patch({ units })}
              />
            </div>
          </>
        )}

        {draft.type === 'markets' && (
          <div className="field">
            <span className="field-label">Symbols</span>
            <ul className="rows-editor">
              {draft.symbols.map((item, index) => (
                <li key={index}>
                  <input
                    type="text"
                    aria-label="Symbol"
                    value={item.symbol}
                    placeholder="AAPL"
                    spellCheck={false}
                    data-autofocus={index === 0 ? '' : undefined}
                    onChange={(event) =>
                      patch({
                        symbols: draft.symbols.map((other, position) =>
                          position === index ? { ...other, symbol: event.target.value } : other
                        )
                      })
                    }
                  />
                  <input
                    type="text"
                    aria-label="Name"
                    value={item.name}
                    placeholder="Name (optional)"
                    onChange={(event) =>
                      patch({
                        symbols: draft.symbols.map((other, position) =>
                          position === index ? { ...other, name: event.target.value } : other
                        )
                      })
                    }
                  />
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Remove ${item.symbol || 'symbol'}`}
                    onClick={() =>
                      patch({
                        symbols: draft.symbols.filter((_other, position) => position !== index)
                      })
                    }
                  >
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
            {draft.symbols.length < 12 && (
              <button
                type="button"
                className="btn btn-ghost btn-small"
                onClick={() =>
                  patch({ symbols: [...draft.symbols, { symbol: '', name: '' } as MarketSymbol] })
                }
              >
                <Plus size={14} aria-hidden="true" /> Add symbol
              </button>
            )}
            <span className="field-hint">
              Yahoo Finance symbols: AAPL, ^GSPC for the S&amp;P 500, BTC-USD, EURUSD=X.
            </span>
          </div>
        )}

        {draft.type === 'clock' && (
          <div className="field">
            <span className="field-label">Time zones</span>
            <datalist id={zoneList}>
              {zones.map((zone) => (
                <option key={zone} value={zone} />
              ))}
            </datalist>
            <ul className="rows-editor">
              {draft.zones.map((zone, index) => (
                <li key={index}>
                  <input
                    type="text"
                    aria-label="Time zone"
                    list={zoneList}
                    value={zone.zone}
                    placeholder="Europe/Paris"
                    spellCheck={false}
                    data-autofocus={index === 0 ? '' : undefined}
                    onChange={(event) =>
                      patch({
                        zones: draft.zones.map((other, position) =>
                          position === index ? { ...other, zone: event.target.value } : other
                        )
                      })
                    }
                  />
                  <input
                    type="text"
                    aria-label="Label"
                    value={zone.label}
                    placeholder="Label (optional)"
                    onChange={(event) =>
                      patch({
                        zones: draft.zones.map((other, position) =>
                          position === index ? { ...other, label: event.target.value } : other
                        )
                      })
                    }
                  />
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Remove ${zone.label || zone.zone || 'zone'}`}
                    onClick={() =>
                      patch({ zones: draft.zones.filter((_other, position) => position !== index) })
                    }
                  >
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
            {error && (
              <span className="field-error" role="alert">
                {error}
              </span>
            )}
            {draft.zones.length < 8 && (
              <button
                type="button"
                className="btn btn-ghost btn-small"
                onClick={() =>
                  patch({ zones: [...draft.zones, { zone: '', label: '' } as ClockZone] })
                }
              >
                <Plus size={14} aria-hidden="true" /> Add time zone
              </button>
            )}
          </div>
        )}

        {draft.type === 'hackernews' && (
          <Field label={`Stories: ${draft.count}`}>
            <input
              type="range"
              min={3}
              max={15}
              value={draft.count}
              data-autofocus=""
              onChange={(event) => patch({ count: Number(event.target.value) })}
            />
          </Field>
        )}

        {draft.type === 'benchlm' && (
          <>
            <div className="field">
              <span className="field-label">Preset</span>
              <Segmented
                label="Preset"
                value={presetOf(draft)}
                options={BENCH_PRESET_NAMES.map((name) => ({
                  value: name,
                  label: BENCH_PRESETS[name].label
                }))}
                onChange={(name) => {
                  const { surface, creator, count, maxPrice } = BENCH_PRESETS[name as BenchPreset];
                  patch({ surface, creator, count, maxPrice });
                }}
              />
            </div>
            <div className="field">
              <span className="field-label">Ranking</span>
              <Segmented
                label="Ranking"
                value={draft.surface}
                options={BENCH_SURFACES.map((surface) => ({
                  value: surface,
                  label: SURFACE_LABELS[surface]
                }))}
                onChange={(surface) => patch({ surface })}
              />
            </div>
            <Field label="Only from" hint="A lab, like Anthropic or Google. Leave empty for all.">
              <input
                type="text"
                value={draft.creator}
                maxLength={40}
                placeholder="Every lab"
                data-autofocus=""
                onChange={(event) => patch({ creator: event.target.value })}
              />
            </Field>
            <Field label={`Models: ${draft.count}`}>
              <input
                type="range"
                min={3}
                max={15}
                value={draft.count}
                onChange={(event) => patch({ count: Number(event.target.value) })}
              />
            </Field>
            <div className="field">
              <span className="field-label">Max price</span>
              <Segmented
                label="Max price"
                value={String(draft.maxPrice)}
                options={MAX_PRICES.map((price) => ({
                  value: String(price),
                  label: price ? `$${Number.isInteger(price) ? price : price.toFixed(2)}` : 'Any'
                }))}
                onChange={(price) => patch({ maxPrice: Number(price) })}
              />
              <span className="field-hint">
                Per million tokens, counting three parts input to one part output. Models without a
                listed price are left out.
              </span>
            </div>
          </>
        )}

        {draft.type === 'focus' && (
          <>
            <Field label={`Focus: ${draft.focus} minutes`}>
              <input
                type="range"
                min={FOCUS_LIMITS.focus.min}
                max={FOCUS_LIMITS.focus.max}
                step={5}
                value={draft.focus}
                data-autofocus=""
                onChange={(event) => patch({ focus: Number(event.target.value) })}
              />
            </Field>
            <Field label={`Break: ${draft.rest} minutes`}>
              <input
                type="range"
                min={FOCUS_LIMITS.rest.min}
                max={FOCUS_LIMITS.rest.max}
                value={draft.rest}
                onChange={(event) => patch({ rest: Number(event.target.value) })}
              />
            </Field>
            <Switch
              label="Chime when time is up"
              hint="The timer is shared by every Focus widget and every open tab of this dashboard, and its countdown shows in the tab's title."
              checked={draft.sound}
              onChange={(sound) => patch({ sound })}
            />
          </>
        )}

        {draft.type === 'prs' && (
          <>
            <Field
              label="GitHub token"
              hint={
                <>
                  Make a{' '}
                  <a
                    href="https://github.com/settings/personal-access-tokens/new"
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    read-only token
                  </a>
                  : read access to Pull requests, Commit statuses and Checks on the repositories you
                  want. It is saved in this browser and in the YAML export, so keep both private.
                </>
              }
              error={error}
            >
              <input
                type="password"
                value={draft.token}
                maxLength={255}
                placeholder="github_pat_…"
                autoComplete="off"
                spellCheck={false}
                data-autofocus=""
                onChange={(event) => patch({ token: event.target.value })}
              />
            </Field>
            <div className="field">
              <span className="field-label">Show</span>
              <Segmented
                label="Show"
                value={draft.show}
                options={[
                  { value: 'both', label: 'Both' },
                  { value: 'review', label: 'To review' },
                  { value: 'mine', label: 'Mine' }
                ]}
                onChange={(show) => patch({ show })}
              />
            </div>
            <Field label={`Pull requests: ${draft.count}`} hint="Per list.">
              <input
                type="range"
                min={3}
                max={10}
                value={draft.count}
                onChange={(event) => patch({ count: Number(event.target.value) })}
              />
            </Field>
          </>
        )}

        {draft.type === 'tv' && (
          <>
            <div className="field">
              <span className="field-label">Trending</span>
              <Segmented
                label="Trending"
                value={draft.window}
                options={[
                  { value: 'day', label: 'Today' },
                  { value: 'week', label: 'This week' }
                ]}
                onChange={(window) => patch({ window })}
              />
            </div>
            <Field label={`Shows: ${draft.count}`}>
              <input
                type="range"
                min={3}
                max={12}
                value={draft.count}
                data-autofocus=""
                onChange={(event) => patch({ count: Number(event.target.value) })}
              />
            </Field>
          </>
        )}

        {draft.type === 'github' && (
          <>
            <Field label="Language" hint="Any language GitHub lists, or “all” for every one.">
              <input
                type="text"
                list="github-languages"
                value={draft.language}
                spellCheck={false}
                data-autofocus=""
                onChange={(event) => patch({ language: event.target.value })}
                onBlur={(event) => patch({ language: languageSlug(event.target.value) })}
              />
              <datalist id="github-languages">
                {POPULAR_LANGUAGES.map((language) => (
                  <option key={language} value={language} />
                ))}
              </datalist>
            </Field>
            <div className="field">
              <span className="field-label">Trending</span>
              <Segmented
                label="Trending"
                value={draft.since}
                options={TRENDING_SINCE.map((since) => ({
                  value: since,
                  label:
                    since === 'daily' ? 'Today' : since === 'weekly' ? 'This week' : 'This month'
                }))}
                onChange={(since) => patch({ since })}
              />
            </div>
            <Field label={`Repositories: ${draft.count}`}>
              <input
                type="range"
                min={3}
                max={15}
                value={draft.count}
                onChange={(event) => patch({ count: Number(event.target.value) })}
              />
            </Field>
          </>
        )}

        {draft.type === 'agenda' && (
          <>
            <Field label={`Events: ${draft.count}`}>
              <input
                type="range"
                min={3}
                max={12}
                value={draft.count}
                data-autofocus=""
                onChange={(event) => patch({ count: Number(event.target.value) })}
              />
            </Field>
            <div className="field">
              <span className="field-label">Show</span>
              <Segmented
                label="Show"
                value={draft.month ? 'month' : 'list'}
                options={[
                  { value: 'month', label: 'Month and list' },
                  { value: 'list', label: 'List only' }
                ]}
                onChange={(value) => patch({ month: value === 'month' })}
              />
              <span className="field-hint">
                Calendars come from this server’s CALENDAR_ICAL_URL settings: up to three, from
                Google Calendar’s secret address in iCal format.
              </span>
            </div>
          </>
        )}

        {(draft.type === 'calendar' || (draft.type === 'agenda' && draft.month)) && (
          <div className="field">
            <span className="field-label">Weeks start on</span>
            <Segmented
              label="Weeks start on"
              value={String(draft.weekStart)}
              options={[
                { value: '1', label: 'Monday' },
                { value: '0', label: 'Sunday' }
              ]}
              onChange={(value) => patch({ weekStart: value === '0' ? 0 : 1 })}
            />
          </div>
        )}

        <div className="field">
          <span className="field-label">Width</span>
          <Segmented
            label="Width"
            value={String(draft.width)}
            options={
              WIDTH_OPTIONS.some((option) => option.value === String(draft.width))
                ? WIDTH_OPTIONS
                : [...WIDTH_OPTIONS, { value: String(draft.width), label: `${draft.width}/12` }]
            }
            onChange={(value) => patch({ width: Number(value) })}
          />
        </div>
      </form>
    </Modal>
  );
};
