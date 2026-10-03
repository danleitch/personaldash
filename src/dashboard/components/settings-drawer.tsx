import { useEffect, useRef, useState, type ReactNode, type JSX } from 'react';
import { Check, ClipboardCopy, Download, FileUp, RotateCcw } from 'lucide-react';
import {
  SEARCH_ENGINES,
  countBookmarks,
  type DashboardConfig,
  type DashboardSettings,
  type SearchEngine
} from '../lib/model';
import { STATUS_SERVICES, readStatusIds } from '../lib/status-services';
import { configToYaml, yamlToConfig, type YamlProblem } from '../lib/yaml';
import { Drawer, Field, Segmented, Switch } from './ui';

export type SettingsTab = 'general' | 'appearance' | 'data';

type SettingsDrawerProps = {
  config: DashboardConfig;
  initialTab?: SettingsTab;
  /** Background choices, owned by the app since the pond and particles live there. */
  appearance: ReactNode;
  onChange: (patch: Partial<DashboardSettings>) => void;
  onReplace: (config: DashboardConfig, message: string) => void;
  onExport: () => void;
  onImportFile: (file: File) => void;
  onReset: (kind: 'example' | 'empty') => void;
  onClose: () => void;
};

const SHORTCUTS: readonly [string, string][] = [
  ['/  or  Ctrl K', 'Search bookmarks and the web'],
  ['N', 'Add a bookmark'],
  ['E', 'Edit the board'],
  ['B', 'Open Branchify'],
  ['Ctrl Z', 'Undo a delete'],
  ['Ctrl V', 'Paste a link to add it']
];

const YamlEditor = ({
  config,
  onReplace
}: {
  config: DashboardConfig;
  onReplace: SettingsDrawerProps['onReplace'];
}): JSX.Element => {
  const current = configToYaml(config);
  const [text, setText] = useState(current);
  const [dirty, setDirty] = useState(false);
  const [problem, setProblem] = useState<YamlProblem | null>(null);
  const [copied, setCopied] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  // Changes made on the board show up here, unless the visitor is mid-edit.
  useEffect(() => {
    if (!dirty) {
      setText(current);
    }
  }, [current, dirty]);

  const apply = (): void => {
    const parsed = yamlToConfig(text);

    if (!parsed.ok) {
      setProblem(parsed.problem);

      if (parsed.problem.line && areaRef.current) {
        const lines = text.split('\n');
        const start = lines.slice(0, parsed.problem.line - 1).join('\n').length + 1;
        areaRef.current.focus();
        areaRef.current.setSelectionRange(
          start,
          start + (lines[parsed.problem.line - 1]?.length ?? 0)
        );
      }

      return;
    }

    setProblem(null);
    setDirty(false);
    onReplace(parsed.value, 'Applied your YAML.');
  };

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      areaRef.current?.select();
    }
  };

  return (
    <div className="yaml-editor">
      <div className="yaml-toolbar">
        <span className="field-label">dashboard.yaml</span>
        <span className="yaml-status">
          {dirty ? 'Edited, not applied' : `${countBookmarks(config)} bookmarks`}
        </span>
        <button
          type="button"
          className="icon-btn"
          onClick={copy}
          aria-label="Copy YAML"
          title="Copy"
        >
          {copied ? <Check size={14} /> : <ClipboardCopy size={14} />}
        </button>
      </div>
      <textarea
        ref={areaRef}
        className="yaml-text"
        value={text}
        spellCheck={false}
        aria-label="Dashboard YAML"
        aria-invalid={problem ? true : undefined}
        onChange={(event) => {
          setText(event.target.value);
          setDirty(true);
          setProblem(null);
        }}
        onKeyDown={(event) => {
          // Tab indents rather than leaving, as in any editor.
          if (event.key === 'Tab' && !event.shiftKey) {
            event.preventDefault();
            const area = event.currentTarget;
            const { selectionStart, selectionEnd } = area;
            const next = `${text.slice(0, selectionStart)}  ${text.slice(selectionEnd)}`;
            setText(next);
            setDirty(true);
            window.requestAnimationFrame(() =>
              area.setSelectionRange(selectionStart + 2, selectionStart + 2)
            );
          } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            apply();
          }
        }}
      />
      {problem && (
        <p className="field-error" role="alert">
          {problem.line ? `Line ${problem.line}: ` : ''}
          {problem.message}
        </p>
      )}
      <div className="yaml-actions">
        <button
          type="button"
          className="btn btn-ghost btn-small"
          disabled={!dirty}
          onClick={() => {
            setText(current);
            setDirty(false);
            setProblem(null);
          }}
        >
          Revert
        </button>
        <button
          type="button"
          className="btn btn-primary btn-small"
          disabled={!dirty}
          onClick={apply}
        >
          Apply <kbd>Ctrl ↵</kbd>
        </button>
      </div>
    </div>
  );
};

export const SettingsDrawer = ({
  config,
  initialTab = 'general',
  appearance,
  onChange,
  onReplace,
  onExport,
  onImportFile,
  onReset,
  onClose
}: SettingsDrawerProps): JSX.Element => {
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [confirmReset, setConfirmReset] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <Drawer title="Settings" onClose={onClose}>
      <div className="tabs" role="tablist" aria-label="Settings sections">
        {(
          [
            ['general', 'General'],
            ['appearance', 'Appearance'],
            ['data', 'Data & YAML']
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            className="tab"
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="drawer-body" role="tabpanel">
        {tab === 'general' && (
          <div className="form">
            <Field label="Your name" hint="For the greeting. Leave empty for none.">
              <input
                type="text"
                value={config.name}
                placeholder="Alex"
                maxLength={60}
                onChange={(event) => onChange({ name: event.target.value })}
              />
            </Field>
            <Field label="Page title" hint="What the browser tab says.">
              <input
                type="text"
                value={config.title}
                maxLength={80}
                onChange={(event) => onChange({ title: event.target.value })}
                onBlur={(event) => {
                  if (!event.target.value.trim()) {
                    onChange({ title: 'Home' });
                  }
                }}
              />
            </Field>
            <Field label="Search with">
              <select
                value={config.search}
                onChange={(event) => onChange({ search: event.target.value as SearchEngine })}
              >
                {Object.entries(SEARCH_ENGINES).map(([value, engine]) => (
                  <option key={value} value={value}>
                    {engine.label}
                  </option>
                ))}
              </select>
            </Field>
            <div className="field">
              <span className="field-label">Clock</span>
              <Segmented
                label="Clock"
                value={config.clock}
                options={[
                  { value: '24h', label: '24-hour' },
                  { value: '12h', label: '12-hour' }
                ]}
                onChange={(clock) => onChange({ clock })}
              />
            </div>
            <Switch
              label="Open bookmarks in a new tab"
              checked={config.newTab}
              onChange={(newTab) => onChange({ newTab })}
            />
            <Switch
              label="Don’t auto-hide the side bar"
              hint="Keep the bar out on the left, instead of tucked behind its tab."
              checked={config.pinBar}
              onChange={(pinBar) => onChange({ pinBar })}
            />

            <section className="settings-section">
              <h3>Status alerts</h3>
              <p className="field-hint">
                A bar appears across the top of the page only while one of these services is down,
                and goes away when it recovers. They are checked every few minutes.
              </p>
              <div className="status-choices" role="group" aria-label="Services to watch">
                {STATUS_SERVICES.map((service) => (
                  <label key={service.id} className="status-choice">
                    <input
                      type="checkbox"
                      checked={config.status.includes(service.id)}
                      onChange={(event) =>
                        onChange({
                          status: readStatusIds([
                            ...config.status.filter((id) => id !== service.id),
                            ...(event.target.checked ? [service.id] : [])
                          ])
                        })
                      }
                    />
                    {service.name}
                  </label>
                ))}
              </div>
              <Switch
                label="Also tell me about slow or partly broken service"
                hint="Otherwise the bar is for outages only."
                checked={config.statusDegraded}
                onChange={(statusDegraded) => onChange({ statusDegraded })}
              />
            </section>

            <section className="settings-section">
              <h3>Keyboard</h3>
              <dl className="shortcuts">
                {SHORTCUTS.map(([keys, label]) => (
                  <div key={keys}>
                    <dt>
                      {keys.split('  or  ').map((part, index) => (
                        <span key={part}>
                          {index > 0 && <span className="shortcut-or">or</span>}
                          {part.split(' ').map((key) => (
                            <kbd key={key}>{key}</kbd>
                          ))}
                        </span>
                      ))}
                    </dt>
                    <dd>{label}</dd>
                  </div>
                ))}
              </dl>
            </section>
          </div>
        )}

        {tab === 'appearance' && (
          <div className="form">
            {appearance}
            <section className="settings-section">
              <h3>Glass</h3>
              <Field label={`Blur: ${config.glass.blur}px`}>
                <input
                  type="range"
                  min={0}
                  max={32}
                  value={config.glass.blur}
                  onChange={(event) =>
                    onChange({ glass: { ...config.glass, blur: Number(event.target.value) } })
                  }
                />
              </Field>
              <Field label={`Tint: ${Math.round(config.glass.tint * 100)}%`}>
                <input
                  type="range"
                  min={0}
                  max={90}
                  value={Math.round(config.glass.tint * 100)}
                  onChange={(event) =>
                    onChange({
                      glass: { ...config.glass, tint: Number(event.target.value) / 100 }
                    })
                  }
                />
              </Field>
              <p className="field-hint">
                Less tint and blur lets more of the background through. A heavy blur over the koi
                pond costs a little battery.
              </p>
            </section>
          </div>
        )}

        {tab === 'data' && (
          <div className="form">
            <p className="field-hint data-intro">
              Everything lives in this browser’s local storage, nowhere else. Export to keep a copy
              or move to another browser.
            </p>
            <div className="data-actions">
              <button type="button" className="btn btn-secondary" onClick={onExport}>
                <Download size={15} aria-hidden="true" /> Export YAML
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => fileRef.current?.click()}
              >
                <FileUp size={15} aria-hidden="true" /> Import…
              </button>
              <input
                ref={fileRef}
                type="file"
                hidden
                accept=".yaml,.yml,.json,.html,.htm,text/yaml,application/json,text/html"
                onChange={(event) => {
                  const file = event.target.files?.[0];

                  if (file) {
                    onImportFile(file);
                  }

                  event.target.value = '';
                }}
              />
            </div>
            <p className="field-hint">
              Imports a dashboard export, a homepage <code>bookmarks.yaml</code>, or the bookmarks
              file any browser exports. You can also drop the file anywhere on the board.
            </p>

            <YamlEditor config={config} onReplace={onReplace} />

            <section className="settings-section danger-zone">
              <h3>Start over</h3>
              {confirmReset ? (
                <div className="data-actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      setConfirmReset(false);
                      onReset('example');
                    }}
                  >
                    Example board
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => {
                      setConfirmReset(false);
                      onReset('empty');
                    }}
                  >
                    Empty board
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setConfirmReset(false)}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="btn btn-ghost btn-danger-text"
                  onClick={() => setConfirmReset(true)}
                >
                  <RotateCcw size={14} aria-hidden="true" /> Reset the board…
                </button>
              )}
              <p className="field-hint">You can undo a reset for a few seconds afterwards.</p>
            </section>
          </div>
        )}
      </div>
    </Drawer>
  );
};
