import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
  type JSX
} from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Blocks,
  BookmarkPlus,
  ChevronsDownUp,
  ChevronsUpDown,
  ClipboardCopy,
  Download,
  ExternalLink,
  FolderInput,
  GitBranch,
  LayoutGrid,
  List,
  PanelLeft,
  Pencil,
  Rows3,
  Settings,
  SlidersHorizontal,
  Trash2
} from 'lucide-react';
import { AppSheet } from '../extensions/app-sheet';
import { ExtensionsPanel } from '../extensions/extensions-panel';
import { BRANCHIFY_ID, enabledWidgetTypes, iconForApp, isEnabled } from '../extensions/registry';
import { useAppRoute } from '../extensions/use-app-route';
import { ActivityBar, type ActivityItem } from './components/activity-bar';
import { BookmarkDialog, type BookmarkTarget } from './components/bookmark-dialog';
import { Board } from './components/board';
import { GroupDialog, type GroupFields } from './components/group-dialog';
import { ImportDialog } from './components/import-dialog';
import { SearchBox, type Command } from './components/search-box';
import { SettingsDrawer, type SettingsTab } from './components/settings-drawer';
import { PageDots } from './components/page-dots';
import { StatusBar } from './components/status-bar';
import { EditDock, EmptyBoard, TopBar } from './components/top-bar';
import { ContextMenu, Toasts, type MenuItem } from './components/ui';
import { WidgetDialog, WidgetPicker } from './components/widget-dialog';
import { useDashboard, type ApplyToPage } from './hooks/use-dashboard';
import { usePage } from './hooks/use-page';
import { clearRemoteCache } from './hooks/use-remote';
import {
  addBookmark,
  addGroup,
  addWidget,
  deleteBookmark,
  deleteGroup,
  deleteWidget,
  findBookmark,
  mergeGroups,
  moveBookmark,
  moveGroup,
  updateBookmark,
  updateGroup,
  updateWidget,
  type BookmarkFields
} from './lib/edit';
import {
  PAGE_COUNT,
  WIDGET_LABELS,
  allGroups,
  createStarterConfig,
  createStarterPage,
  emptyConfig,
  pageOf,
  withPage,
  type Bookmark,
  type BookmarkStyle,
  type DashboardConfig,
  type Group,
  type Widget
} from './lib/model';
import { collectSavedState, restoreSavedState, saveConfig } from './lib/storage';
import {
  guessName,
  isLinkDrag,
  looksLikeUrl,
  normalizeUrl,
  openUrl,
  readDroppedLink
} from './lib/urls';
import { exportYaml, planImport, type ImportPlan } from './lib/yaml';
import './dashboard.css';

type DashboardProps = {
  /** The app's own bar buttons: the koi market while the pond swims, the particle controls. */
  headerExtras?: ReactNode;
  /** Background controls for the Appearance settings. */
  appearance: (closeSettings: () => void) => ReactNode;
  onOpenBranchify: () => void;
  /** An import restored state the app keeps itself, so it has to read it all again. */
  onRestored: () => void;
};

type BookmarkDialogState =
  | { mode: 'add'; initial: Partial<BookmarkFields> & { groupId?: string | null } }
  | { mode: 'edit'; bookmark: Bookmark; groupId: string };

type GroupDialogState = { mode: 'add' } | { mode: 'edit'; group: Group };

type MenuState = { x: number; y: number; items: MenuItem[]; label: string };

/** A file's text, through FileReader where Blob.text is missing. */
const readText = (file: Blob): Promise<string> =>
  typeof file.text === 'function'
    ? file.text()
    : new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file);
      });

/** A message to show once the app has re-read everything after a full restore. */
let noticeAfterRestore: string | null = null;

const isTyping = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

const dialogOpen = (): boolean => document.querySelector('[aria-modal="true"]') !== null;

const STYLE_ICONS: Readonly<Record<BookmarkStyle, ReactNode>> = {
  cards: <Rows3 size={15} />,
  tiles: <LayoutGrid size={15} />,
  list: <List size={15} />
};

const STYLE_LABELS: Readonly<Record<BookmarkStyle, string>> = {
  cards: 'Cards',
  tiles: 'Tiles',
  list: 'List'
};

const menuPoint = (event: MouseEvent): { x: number; y: number } => {
  // A click on a button opens the menu under the button, not under the pointer.
  if (event.type === 'click' && event.currentTarget instanceof HTMLElement) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: rect.left, y: rect.bottom + 6 };
  }

  return { x: event.clientX, y: event.clientY };
};

export const Dashboard = ({
  headerExtras,
  appearance,
  onOpenBranchify,
  onRestored
}: DashboardProps): JSX.Element => {
  const { config: dashboard, apply: applyAll, toasts, notify, dismiss, undo } = useDashboard();
  const { page, leaving, direction, go, settle } = usePage();
  // Everything below edits the page in view; only a restore or a reset reaches past it.
  const config = useMemo(() => pageOf(dashboard, page), [dashboard, page]);
  const apply = useCallback<ApplyToPage>(
    (change, undoMessage) =>
      applyAll((current) => {
        const view = pageOf(current, page);
        const next = change(view);
        return next === view ? current : withPage(current, page, next);
      }, undoMessage),
    [applyAll, page]
  );
  const [editing, setEditing] = useState(false);
  const [bookmarkDialog, setBookmarkDialog] = useState<BookmarkDialogState | null>(null);
  const [groupDialog, setGroupDialog] = useState<GroupDialogState | null>(null);
  const [widgetDialog, setWidgetDialog] = useState<Widget | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [importing, setImporting] = useState<{ plan: ImportPlan; fileName: string } | null>(null);
  const [dropHint, setDropHint] = useState<'link' | 'file' | null>(null);
  const [freshId, setFreshId] = useState<string | null>(null);
  const [extensionsOpen, setExtensionsOpen] = useState(false);
  const [appId, openApp, closeApp] = useAppRoute();
  const { extensions } = dashboard;
  const branchifyOn = isEnabled(extensions, BRANCHIFY_ID);
  const openedApp = appId ? extensions.apps.find((app) => app.id === appId) : undefined;
  const searchRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (noticeAfterRestore) {
      notify(noticeAfterRestore, 'success');
      noticeAfterRestore = null;
    }
  }, [notify]);

  useEffect(() => {
    document.title = config.title || 'Home';
  }, [config.title]);

  // The glass settings reach dialogs and menus too, which render outside the board.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--glass-blur', `${config.glass.blur}px`);
    root.style.setProperty('--glass-tint', String(config.glass.tint));
  }, [config.glass.blur, config.glass.tint]);

  const flash = useCallback((bookmarkId: string): void => {
    setFreshId(bookmarkId);
    window.setTimeout(
      () => setFreshId((current) => (current === bookmarkId ? null : current)),
      1800
    );
    window.requestAnimationFrame(() =>
      document
        .querySelector(`[data-bookmark-id="${bookmarkId}"]`)
        ?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
    );
  }, []);

  const openAdd = useCallback(
    (initial: Partial<BookmarkFields> & { groupId?: string | null } = {}): void => {
      setMenu(null);
      setBookmarkDialog({ mode: 'add', initial });
    },
    []
  );

  const removeBookmark = useCallback(
    (bookmark: Bookmark): void => {
      apply((current) => deleteBookmark(current, bookmark.id), `Deleted “${bookmark.name}”`);
    },
    [apply]
  );

  const removeGroup = useCallback(
    (group: Group): void => {
      const count = group.bookmarks.length;
      apply(
        (current) => deleteGroup(current, group.id),
        `Deleted “${group.name}”${count ? ` and its ${count} bookmark${count === 1 ? '' : 's'}` : ''}`
      );
    },
    [apply]
  );

  const removeWidget = useCallback(
    (widget: Widget): void => {
      apply((current) => deleteWidget(current, widget.id), `Removed ${WIDGET_LABELS[widget.type]}`);
    },
    [apply]
  );

  const toggleGroup = useCallback(
    (group: Group): void => {
      apply((current) => updateGroup(current, group.id, { collapsed: !group.collapsed }));
    },
    [apply]
  );

  const bookmarkMenu = useCallback(
    (bookmark: Bookmark, event: MouseEvent): void => {
      const found = findBookmark(config.groups, bookmark.id);
      const others = config.groups.filter((group) => group.id !== found?.group.id);

      setMenu({
        ...menuPoint(event),
        label: bookmark.name,
        items: [
          {
            label: 'Open in new tab',
            icon: <ExternalLink size={15} />,
            onSelect: () => openUrl(bookmark.url, true)
          },
          {
            label: 'Copy link',
            icon: <ClipboardCopy size={15} />,
            onSelect: () => {
              navigator.clipboard
                ?.writeText(bookmark.url)
                .then(() => notify('Link copied', 'success'))
                .catch(() => notify('Couldn’t copy that link', 'error'));
            }
          },
          'separator',
          {
            label: 'Edit…',
            icon: <Pencil size={15} />,
            onSelect: () =>
              found && setBookmarkDialog({ mode: 'edit', bookmark, groupId: found.group.id })
          },
          {
            label: 'Move to',
            icon: <FolderInput size={15} />,
            disabled: others.length === 0,
            items: others.map((group) => ({
              label: group.name,
              onSelect: () =>
                apply((current) => ({
                  ...current,
                  groups: moveBookmark(current.groups, bookmark.id, group.id, Infinity)
                }))
            }))
          },
          'separator',
          {
            label: 'Delete',
            icon: <Trash2 size={15} />,
            danger: true,
            onSelect: () => removeBookmark(bookmark)
          }
        ]
      });
    },
    [apply, config.groups, notify, removeBookmark]
  );

  const groupMenu = useCallback(
    (group: Group, event: MouseEvent): void => {
      const index = config.groups.findIndex((candidate) => candidate.id === group.id);

      setMenu({
        ...menuPoint(event),
        label: group.name,
        items: [
          {
            label: 'Add bookmark',
            icon: <BookmarkPlus size={15} />,
            onSelect: () => openAdd({ groupId: group.id })
          },
          {
            label: 'Group settings…',
            icon: <SlidersHorizontal size={15} />,
            onSelect: () => setGroupDialog({ mode: 'edit', group })
          },
          {
            label: 'Layout',
            icon: STYLE_ICONS[group.style],
            items: (['cards', 'tiles', 'list'] as const).map((style) => ({
              label: STYLE_LABELS[style],
              icon: STYLE_ICONS[style],
              checked: group.style === style,
              onSelect: () => apply((current) => updateGroup(current, group.id, { style }))
            }))
          },
          {
            label: group.collapsed ? 'Expand' : 'Collapse',
            icon: group.collapsed ? <ChevronsUpDown size={15} /> : <ChevronsDownUp size={15} />,
            onSelect: () => toggleGroup(group)
          },
          'separator',
          {
            label: 'Move earlier',
            icon: <ArrowLeft size={15} />,
            disabled: index <= 0,
            onSelect: () => apply((current) => moveGroup(current, index, index - 1))
          },
          {
            label: 'Move later',
            icon: <ArrowRight size={15} />,
            disabled: index === config.groups.length - 1,
            onSelect: () => apply((current) => moveGroup(current, index, index + 1))
          },
          'separator',
          {
            label: 'Delete group',
            icon: <Trash2 size={15} />,
            danger: true,
            onSelect: () => removeGroup(group)
          }
        ]
      });
    },
    [apply, config.groups, openAdd, removeGroup, toggleGroup]
  );

  const saveBookmark = (fields: BookmarkFields, target: BookmarkTarget): void => {
    const state = bookmarkDialog;
    setBookmarkDialog(null);

    if (!state) {
      return;
    }

    if (state.mode === 'add') {
      let addedId = '';
      let groupName = '';

      apply((current) => {
        const result = addBookmark(current, target, fields);
        addedId = result.bookmark.id;
        groupName =
          result.config.groups.find((group) => group.id === result.groupId)?.name ?? 'the board';
        return result.config;
      });
      notify(`Added “${fields.name}” to ${groupName}`, 'success');
      flash(addedId);
      return;
    }

    const { bookmark, groupId } = state;
    apply((current) => {
      let next = updateBookmark(current, bookmark.id, fields);

      if ('newGroup' in target) {
        const added = addGroup(next, target.newGroup);
        next = {
          ...added.config,
          groups: moveBookmark(added.config.groups, bookmark.id, added.group.id, 0)
        };
      } else if (target.groupId !== groupId) {
        next = {
          ...next,
          groups: moveBookmark(next.groups, bookmark.id, target.groupId, Infinity)
        };
      }

      return next;
    });
    flash(bookmark.id);
  };

  const saveGroup = (fields: GroupFields): void => {
    const state = groupDialog;
    setGroupDialog(null);

    if (state?.mode === 'edit') {
      apply((current) => updateGroup(current, state.group.id, fields));
    } else if (state?.mode === 'add') {
      apply((current) => addGroup(current, fields.name, fields).config);
      notify(`Created “${fields.name}”`, 'success');
    }
  };

  const exportBoard = useCallback((): void => {
    const yaml = exportYaml(dashboard, collectSavedState());
    const fileName = `dashboard-${new Date().toISOString().slice(0, 10)}.yaml`;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([yaml], { type: 'text/yaml' }));
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
    notify(`Exported ${fileName}`, 'success');
  }, [dashboard, notify]);

  const importFile = useCallback(
    async (file: File): Promise<void> => {
      if (file.size > 5_000_000) {
        notify('That file is too big to be a bookmarks file.', 'error');
        return;
      }

      const plan = planImport(await readText(file));

      if (!plan.ok) {
        notify(plan.problem.message, 'error');
        return;
      }

      setSettingsTab(null);
      setImporting({ plan: plan.value, fileName: file.name });
    },
    [notify]
  );

  const finishImport = (mode: 'merge' | 'replace'): void => {
    if (!importing) {
      return;
    }

    const { plan } = importing;
    const count = plan.groups.reduce((total, group) => total + group.bookmarks.length, 0);
    setImporting(null);

    if (mode === 'merge') {
      apply(
        (current) => mergeGroups(current, plan.groups),
        `Imported ${count} bookmark${count === 1 ? '' : 's'}`
      );
      return;
    }

    if (plan.config) {
      // A full restore: the board is saved now, the rest of the app's state
      // written back, and the whole app read again from storage.
      saveConfig(plan.config);

      if (plan.saved) {
        restoreSavedState(plan.saved);
      }

      noticeAfterRestore = `Restored ${count} bookmarks and your settings`;
      onRestored();
      return;
    }

    apply((current) => ({ ...current, groups: plan.groups }), `Replaced your bookmarks`);
  };

  /** Starting over clears every page; the example fills the first. */
  const resetBoard = (kind: 'example' | 'empty'): void => {
    const fresh = kind === 'example' ? createStarterConfig() : emptyConfig();
    clearRemoteCache();
    applyAll(
      (current) => ({ ...current, pages: fresh.pages }),
      kind === 'example' ? 'Started again from the example' : 'Cleared the board'
    );
    setSettingsTab(null);
    go(0);
  };

  /** An empty page asked for the example: just that page gets it. */
  const fillWithExample = (): void => {
    clearRemoteCache();
    apply((current) => ({ ...current, ...createStarterPage() }));
  };

  const commands = useMemo<Command[]>(
    () => [
      ...(branchifyOn
        ? [
            {
              id: 'branchify',
              label: 'Open Branchify',
              icon: <GitBranch size={15} />,
              keywords: 'git branch name tool',
              hint: 'B',
              run: onOpenBranchify
            }
          ]
        : []),
      ...extensions.apps.map((app) => {
        const Icon = iconForApp(app);
        return {
          id: `app:${app.id}`,
          label: `Open ${app.name}`,
          icon: <Icon size={15} />,
          keywords: `app extension ${app.url}`,
          run: () => openApp(app.id)
        };
      }),
      {
        id: 'extensions',
        label: 'Extensions',
        icon: <Blocks size={15} />,
        keywords: 'apps tools widgets install marketplace',
        run: () => setExtensionsOpen(true)
      },
      {
        id: 'add',
        label: 'Add a bookmark',
        icon: <BookmarkPlus size={15} />,
        keywords: 'new bookmark link',
        hint: 'N',
        run: () => openAdd()
      },
      {
        id: 'edit',
        label: 'Edit the board',
        icon: <Pencil size={15} />,
        keywords: 'arrange move resize',
        hint: 'E',
        run: () => setEditing(true)
      },
      {
        id: 'settings',
        label: 'Settings',
        icon: <Settings size={15} />,
        keywords: 'preferences appearance background',
        run: () => setSettingsTab('general')
      },
      {
        id: 'yaml',
        label: 'Edit YAML',
        icon: <SlidersHorizontal size={15} />,
        keywords: 'config yaml import',
        run: () => setSettingsTab('data')
      },
      {
        id: 'export',
        label: 'Export YAML',
        icon: <Download size={15} />,
        keywords: 'backup download save',
        run: exportBoard
      }
    ],
    [branchifyOn, exportBoard, extensions.apps, onOpenBranchify, openAdd, openApp]
  );

  const setPinBar = useCallback(
    (pinBar: boolean): void => applyAll((current) => ({ ...current, pinBar })),
    [applyAll]
  );

  const barItems: ActivityItem[] = [
    ...(branchifyOn
      ? [
          {
            id: 'branchify',
            label: 'Branchify',
            icon: <GitBranch size={20} aria-hidden="true" />,
            shortcut: 'B',
            onSelect: onOpenBranchify
          }
        ]
      : []),
    ...extensions.apps.map((app): ActivityItem => {
      const Icon = iconForApp(app);
      return {
        id: `app:${app.id}`,
        label: app.name,
        icon: <Icon size={20} aria-hidden="true" />,
        active: app.id === appId,
        onSelect: () => openApp(app.id)
      };
    })
  ];

  const barMenu = (event: MouseEvent): void =>
    setMenu({
      x: event.clientX,
      y: event.clientY,
      label: 'Side bar',
      items: [
        {
          label: 'Don’t auto-hide',
          icon: <PanelLeft size={15} />,
          checked: dashboard.pinBar,
          onSelect: () => setPinBar(!dashboard.pinBar)
        },
        'separator',
        {
          label: 'Extensions…',
          icon: <Blocks size={15} />,
          onSelect: () => setExtensionsOpen(true)
        }
      ]
    });

  // Keyboard shortcuts, for when nothing else wants the keys.
  useEffect(() => {
    const handleKey = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }

      if (isTyping(event.target) || dialogOpen() || event.altKey) {
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        if (undo()) {
          event.preventDefault();
        }

        return;
      }

      if (event.ctrlKey || event.metaKey) {
        return;
      }

      switch (event.key) {
        case '/':
          event.preventDefault();
          searchRef.current?.focus();
          break;
        case 'e':
        case 'E':
          setEditing((current) => !current);
          break;
        case 'n':
        case 'N':
          event.preventDefault();
          openAdd();
          break;
        case 'b':
        case 'B':
          if (branchifyOn) {
            event.preventDefault();
            onOpenBranchify();
          }
          break;
        case 'Escape':
          setEditing(false);
          break;
      }
    };

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [branchifyOn, onOpenBranchify, openAdd, undo]);

  // A link pasted anywhere that isn't a text field starts a new bookmark.
  useEffect(() => {
    const handlePaste = (event: ClipboardEvent): void => {
      if (isTyping(event.target) || dialogOpen()) {
        return;
      }

      const text = event.clipboardData?.getData('text/plain').trim() ?? '';
      const url = looksLikeUrl(text) ? normalizeUrl(text) : null;

      if (url) {
        event.preventDefault();
        openAdd({ url, name: guessName(url) });
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [openAdd]);

  // Links dragged in from other tabs, and files dropped to import.
  useEffect(() => {
    let hideTimer: number | undefined;

    const handleDragOver = (event: DragEvent): void => {
      const types = Array.from(event.dataTransfer?.types ?? []);
      const kind = types.includes('Files') ? 'file' : isLinkDrag(types) ? 'link' : null;

      if (!kind || dialogOpen()) {
        return;
      }

      event.preventDefault();
      setDropHint(kind);
      window.clearTimeout(hideTimer);
      // dragover repeats while something is held over the page; when it stops, so does the hint.
      hideTimer = window.setTimeout(() => setDropHint(null), 220);
    };

    const handleDrop = (event: DragEvent): void => {
      const data = event.dataTransfer;
      setDropHint(null);

      if (!data || dialogOpen()) {
        return;
      }

      const file = data.files?.[0];

      if (file) {
        event.preventDefault();
        void importFile(file);
        return;
      }

      const link = readDroppedLink(data);

      if (link) {
        event.preventDefault();
        openAdd({ url: link.url, name: link.title || guessName(link.url) });
      }
    };

    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('drop', handleDrop);

    return () => {
      window.clearTimeout(hideTimer);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('drop', handleDrop);
    };
  }, [importFile, openAdd]);

  // The page in view gets everything; one sliding out is only there to be seen.
  const renderPage = (index: number): JSX.Element => {
    const view = index === page ? config : pageOf(dashboard, index);
    const isEmpty = view.groups.length === 0 && view.widgets.length === 0 && !editing;

    return isEmpty ? (
      <EmptyBoard
        onAddBookmark={() => openAdd()}
        onAddWidget={() => setPickerOpen(true)}
        onImport={() => fileRef.current?.click()}
        onExample={fillWithExample}
      />
    ) : (
      <Board
        config={view}
        editing={editing}
        apply={apply}
        freshId={freshId}
        onEditBookmark={(bookmark) => {
          const found = findBookmark(config.groups, bookmark.id);

          if (found) {
            setBookmarkDialog({ mode: 'edit', bookmark, groupId: found.group.id });
          }
        }}
        onDeleteBookmark={removeBookmark}
        onBookmarkMenu={bookmarkMenu}
        onAddBookmark={(groupId) => openAdd({ groupId })}
        onGroupMenu={groupMenu}
        onToggleGroup={toggleGroup}
        onAddGroup={() => setGroupDialog({ mode: 'add' })}
        onAddWidget={() => setPickerOpen(true)}
        onConfigureWidget={setWidgetDialog}
        onRemoveWidget={removeWidget}
        onDropLink={(groupId, url, title) => {
          let addedId = '';
          apply((current) => {
            const result = addBookmark(
              current,
              { groupId },
              { url, name: title || guessName(url), description: '', icon: '' }
            );
            addedId = result.bookmark.id;
            return result.config;
          });
          flash(addedId);
        }}
      />
    );
  };

  // React 18 doesn't know `inert` yet, so it goes through as a plain attribute.
  const inert = { inert: '' } as Record<string, string>;

  return (
    <>
      <StatusBar watched={dashboard.status} includeDegraded={dashboard.statusDegraded} />
      <div
        className="dash"
        data-editing={editing ? 'on' : undefined}
        style={{ '--glass-blur': `${config.glass.blur}px` } as CSSProperties}
      >
        <ActivityBar
          pinned={dashboard.pinBar}
          items={barItems}
          extras={headerExtras}
          editing={editing}
          extensionsOpen={extensionsOpen}
          onOpenExtensions={() => setExtensionsOpen(true)}
          onAddBookmark={() => openAdd()}
          onToggleEdit={() => setEditing((current) => !current)}
          onOpenSettings={() => setSettingsTab('general')}
          onContextMenu={barMenu}
        />

        <TopBar name={config.name} clock={config.clock}>
          <SearchBox
            groups={allGroups(dashboard)}
            engine={config.search}
            newTab={config.newTab}
            commands={commands}
            inputRef={searchRef}
          />
        </TopBar>

        <div className="pages" data-moving={leaving !== null ? '' : undefined}>
          {Array.from({ length: PAGE_COUNT }, (_unused, index) => index)
            .filter((index) => index === page || index === leaving)
            .map((index) => (
              <div
                key={index}
                className="page"
                data-state={index === page ? 'current' : 'leaving'}
                data-direction={direction ?? undefined}
                {...(index === page ? {} : { 'aria-hidden': true, ...inert })}
                onAnimationEnd={(event) => {
                  if (event.target === event.currentTarget && index !== page) {
                    settle(index);
                  }
                }}
              >
                {renderPage(index)}
              </div>
            ))}
        </div>

        <PageDots count={PAGE_COUNT} page={page} direction={direction} onGo={go} />

        <input
          ref={fileRef}
          type="file"
          hidden
          accept=".yaml,.yml,.json,.html,.htm,text/yaml,application/json,text/html"
          onChange={(event) => {
            const file = event.target.files?.[0];

            if (file) {
              void importFile(file);
            }

            event.target.value = '';
          }}
        />

        {editing && (
          <EditDock
            onAddBookmark={() => openAdd()}
            onAddGroup={() => setGroupDialog({ mode: 'add' })}
            onAddWidget={() => setPickerOpen(true)}
            onDone={() => setEditing(false)}
          />
        )}

        {dropHint && (
          <div className="drop-hint glass" aria-hidden="true">
            {dropHint === 'file'
              ? 'Drop to import bookmarks'
              : 'Drop on a group to add it there, or anywhere else to choose'}
          </div>
        )}

        {bookmarkDialog && (
          <BookmarkDialog
            mode={bookmarkDialog.mode}
            initial={
              bookmarkDialog.mode === 'edit'
                ? { ...bookmarkDialog.bookmark, groupId: bookmarkDialog.groupId }
                : bookmarkDialog.initial
            }
            groups={config.groups}
            onSave={saveBookmark}
            onDelete={
              bookmarkDialog.mode === 'edit'
                ? () => {
                    removeBookmark(bookmarkDialog.bookmark);
                    setBookmarkDialog(null);
                  }
                : undefined
            }
            onClose={() => setBookmarkDialog(null)}
          />
        )}

        {groupDialog && (
          <GroupDialog
            mode={groupDialog.mode}
            initial={groupDialog.mode === 'edit' ? groupDialog.group : undefined}
            onSave={saveGroup}
            onClose={() => setGroupDialog(null)}
          />
        )}

        {pickerOpen && (
          <WidgetPicker
            types={enabledWidgetTypes(extensions)}
            onClose={() => setPickerOpen(false)}
            onPick={(type) => {
              setPickerOpen(false);
              const created: { widget: Widget | null } = { widget: null };
              apply((current) => {
                const result = addWidget(current, type);
                created.widget = result.widget;
                return result.config;
              });

              // Most widgets want a word about what to show before they are useful.
              if (
                created.widget &&
                !['calendar', 'agenda', 'hackernews', 'github', 'benchlm', 'tv'].includes(type)
              ) {
                setWidgetDialog(created.widget);
              }
            }}
          />
        )}

        {widgetDialog && (
          <WidgetDialog
            widget={widgetDialog}
            onClose={() => setWidgetDialog(null)}
            onSave={(widget) => {
              setWidgetDialog(null);
              apply((current) => updateWidget(current, widget.id, widget));
            }}
          />
        )}

        {settingsTab && (
          <SettingsDrawer
            config={dashboard}
            initialTab={settingsTab}
            appearance={appearance(() => setSettingsTab(null))}
            onChange={(patch) => apply((current) => ({ ...current, ...patch }))}
            onReplace={(next: DashboardConfig, message) => applyAll(() => next, message)}
            onExport={exportBoard}
            onImportFile={(file) => void importFile(file)}
            onReset={resetBoard}
            onClose={() => setSettingsTab(null)}
          />
        )}

        {extensionsOpen && (
          <ExtensionsPanel
            extensions={extensions}
            onChange={(next, message) =>
              applyAll((current) => ({ ...current, extensions: next }), message)
            }
            onOpenApp={(id) => {
              setExtensionsOpen(false);
              openApp(id);
            }}
            onClose={() => setExtensionsOpen(false)}
          />
        )}

        {openedApp && <AppSheet app={openedApp} onClose={closeApp} />}

        {importing && (
          <ImportDialog
            plan={importing.plan}
            fileName={importing.fileName}
            onMerge={() => finishImport('merge')}
            onReplace={() => finishImport('replace')}
            onClose={() => setImporting(null)}
          />
        )}

        {menu && (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            items={menu.items}
            label={menu.label}
            onClose={() => setMenu(null)}
          />
        )}

        <Toasts toasts={toasts} onUndo={(id) => undo(id)} onDismiss={dismiss} />
      </div>
    </>
  );
};
