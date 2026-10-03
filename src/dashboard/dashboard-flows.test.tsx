import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../app';
import { DASHBOARD_STORAGE_KEY } from './lib/storage';
import { openUrl } from './lib/urls';
import { sanitizeConfig } from './lib/model';
import { configToYaml } from './lib/yaml';

vi.mock('./lib/urls', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/urls')>()),
  openUrl: vi.fn()
}));

const seed = (config: unknown): void => {
  window.localStorage.setItem(DASHBOARD_STORAGE_KEY, configToYaml(sanitizeConfig(config)));
};

const board = {
  name: 'Sam',
  groups: [
    {
      name: 'Code',
      bookmarks: [
        { name: 'GitHub', url: 'https://github.com', description: 'Pull requests' },
        { name: 'npm', url: 'https://www.npmjs.com' }
      ]
    },
    { name: 'Read', bookmarks: [{ name: 'Lobsters', url: 'https://lobste.rs' }] },
    { name: 'Empty', bookmarks: [] }
  ]
};

const group = (name: string): HTMLElement => screen.getByRole('region', { name });
const namesIn = (name: string): string[] =>
  [...group(name).querySelectorAll('.bm-name')].map((node) => node.textContent ?? '');
const link = (name: RegExp | string): HTMLElement => screen.getByRole('link', { name });
const menu = (name: string): HTMLElement => screen.getByRole('menu', { name });
const item = (name: RegExp | string): HTMLElement => screen.getByRole('menuitem', { name });
// More than one live region is on the page, so the toasts are found by their own container.
const toasts = (): HTMLElement => document.querySelector<HTMLElement>('.toasts')!;
const toast = (text: RegExp | string): HTMLElement => within(toasts()).getByText(text);

const rightClick = (element: Element): void => {
  fireEvent.contextMenu(element);
};

const header = (name: string): HTMLElement => group(name).querySelector('header')!;

const key = (init: KeyboardEventInit, target: Element | Window = document.body): void => {
  fireEvent.keyDown(target, init);
};

describe('Dashboard flows', () => {
  beforeEach(() => {
    vi.mocked(openUrl).mockClear();
    seed(board);
  });

  afterEach(() => {
    delete (navigator as { clipboard?: unknown }).clipboard;
  });

  describe('a bookmark’s menu', () => {
    it('opens it in a new tab', async () => {
      render(<App />);
      rightClick(link(/GitHub/));

      await userEvent.click(item('Open in new tab'));

      expect(openUrl).toHaveBeenCalledWith('https://github.com', true);
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('is named for the bookmark', () => {
      render(<App />);

      rightClick(link(/GitHub/));

      expect(menu('GitHub')).toBeInTheDocument();
    });

    it('copies the link, and says so', async () => {
      const user = userEvent.setup();
      render(<App />);
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
      rightClick(link(/GitHub/));

      await user.click(item('Copy link'));

      expect(writeText).toHaveBeenCalledWith('https://github.com');
      expect(await screen.findByText('Link copied')).toBeInTheDocument();
    });

    it('says when the link could not be copied', async () => {
      const user = userEvent.setup();
      render(<App />);
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) }
      });
      rightClick(link(/GitHub/));

      await user.click(item('Copy link'));

      expect(await screen.findByText('Couldn’t copy that link')).toBeInTheDocument();
    });

    it('copes with a browser that has no clipboard', async () => {
      const user = userEvent.setup();
      render(<App />);
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
      rightClick(link(/GitHub/));

      await user.click(item('Copy link'));

      expect(toasts()).toBeEmptyDOMElement();
    });

    it('opens the edit dialog for it', async () => {
      render(<App />);
      rightClick(link(/npm/));

      await userEvent.click(item('Edit…'));

      const dialog = screen.getByRole('dialog', { name: 'Edit bookmark' });
      expect(within(dialog).getByLabelText('Name')).toHaveValue('npm');
    });

    it('moves it to the end of another group, offering every group but its own', async () => {
      render(<App />);
      rightClick(link(/GitHub/));
      await userEvent.hover(item(/Move to/));
      const sub = screen.getByRole('menu', { name: 'Move to' });

      expect(
        within(sub)
          .getAllByRole('menuitem')
          .map((entry) => entry.textContent)
      ).toEqual(['Read', 'Empty']);

      await userEvent.click(within(sub).getByRole('menuitem', { name: 'Read' }));

      expect(namesIn('Read')).toEqual(['Lobsters', 'GitHub']);
      expect(namesIn('Code')).toEqual(['npm']);
    });

    it('cannot move a bookmark when there is nowhere else to go', () => {
      seed({
        groups: [{ name: 'Only', bookmarks: [{ name: 'One', url: 'https://one.example' }] }]
      });
      render(<App />);

      rightClick(link(/One/));

      expect(item(/Move to/)).toBeDisabled();
    });

    it('deletes it, offering to take it back', async () => {
      render(<App />);
      rightClick(link(/npm/));

      await userEvent.click(item('Delete'));

      expect(namesIn('Code')).toEqual(['GitHub']);
      expect(toast('Deleted “npm”')).toBeInTheDocument();
    });

    it('opens under the pointer when right-clicked', () => {
      render(<App />);

      fireEvent.contextMenu(link(/GitHub/), { clientX: 120, clientY: 90 });

      expect(document.querySelector('.menu-anchor')).toHaveStyle({ left: '120px', top: '90px' });
    });

    it('opens under the button when one was clicked', async () => {
      render(<App />);
      const button = screen.getByRole('button', { name: 'Code options' });
      vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({
        left: 300,
        bottom: 200
      } as DOMRect);

      await userEvent.click(button);

      expect(document.querySelector('.menu-anchor')).toHaveStyle({ left: '300px', top: '206px' });
    });
  });

  describe('a group’s menu', () => {
    const openMenu = (name: string): void => rightClick(header(name));

    it('is named for the group', () => {
      render(<App />);

      openMenu('Code');

      expect(menu('Code')).toBeInTheDocument();
    });

    it('adds a bookmark to that group', async () => {
      render(<App />);
      openMenu('Read');

      await userEvent.click(item('Add bookmark'));

      const dialog = screen.getByRole('dialog', { name: 'Add a bookmark' });
      expect(within(dialog).getByLabelText('Group')).toHaveDisplayValue('Read');
    });

    it('opens the group’s settings', async () => {
      render(<App />);
      openMenu('Read');

      await userEvent.click(item('Group settings…'));

      const dialog = screen.getByRole('dialog', { name: 'Group settings' });
      expect(within(dialog).getByLabelText('Name')).toHaveValue('Read');
    });

    it('changes how its bookmarks are laid out, ticking the layout in use', async () => {
      render(<App />);
      openMenu('Code');
      await userEvent.hover(item(/Layout/));
      const sub = screen.getByRole('menu', { name: 'Layout' });
      expect(within(sub).getByRole('menuitem', { name: /Cards/ })).toHaveAttribute(
        'aria-checked',
        'true'
      );

      await userEvent.click(within(sub).getByRole('menuitem', { name: /Tiles/ }));

      expect(group('Code').querySelector('.grp-items--tiles')).not.toBeNull();
    });

    it('collapses, and then offers to expand', async () => {
      render(<App />);
      openMenu('Code');
      await userEvent.click(item('Collapse'));
      expect(namesIn('Code')).toEqual([]);

      openMenu('Code');
      await userEvent.click(item('Expand'));

      expect(namesIn('Code')).toEqual(['GitHub', 'npm']);
    });

    it('moves earlier and later, and cannot go past either end', async () => {
      render(<App />);
      openMenu('Code');
      expect(item('Move earlier')).toBeDisabled();
      await userEvent.click(item('Move later'));
      expect(
        [...document.querySelectorAll('section.grp')].map((node) => node.getAttribute('aria-label'))
      ).toEqual(['Read', 'Code', 'Empty']);

      openMenu('Empty');
      expect(item('Move later')).toBeDisabled();
      await userEvent.click(item('Move earlier'));

      expect(
        [...document.querySelectorAll('section.grp')].map((node) => node.getAttribute('aria-label'))
      ).toEqual(['Read', 'Empty', 'Code']);
    });

    it('deletes the group, saying how many bookmarks went with it', async () => {
      render(<App />);
      openMenu('Code');

      await userEvent.click(item('Delete group'));

      expect(screen.queryByRole('region', { name: 'Code' })).not.toBeInTheDocument();
      expect(toast('Deleted “Code” and its 2 bookmarks')).toBeInTheDocument();
    });

    it('says “bookmark” for just one, and nothing about bookmarks for none', async () => {
      render(<App />);
      openMenu('Read');
      await userEvent.click(item('Delete group'));
      expect(toast('Deleted “Read” and its 1 bookmark')).toBeInTheDocument();

      openMenu('Empty');
      await userEvent.click(item('Delete group'));
      expect(toast('Deleted “Empty”')).toBeInTheDocument();
    });

    it('can be undone', async () => {
      render(<App />);
      openMenu('Code');
      await userEvent.click(item('Delete group'));

      await userEvent.click(within(toasts()).getByRole('button', { name: /Undo/ }));

      expect(namesIn('Code')).toEqual(['GitHub', 'npm']);
    });
  });

  describe('groups and widgets', () => {
    it('renames a group from its settings', async () => {
      render(<App />);
      rightClick(header('Read'));
      await userEvent.click(item('Group settings…'));
      const dialog = screen.getByRole('dialog', { name: 'Group settings' });

      await userEvent.clear(within(dialog).getByLabelText('Name'));
      await userEvent.type(within(dialog).getByLabelText('Name'), 'Reading');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

      expect(screen.getByRole('region', { name: 'Reading' })).toBeInTheDocument();
    });

    it('creates a group, and says so', async () => {
      render(<App />);
      fireEvent.keyDown(document.body, { key: 'e' });
      await userEvent.click(screen.getByRole('button', { name: /Group/ }));
      const dialog = screen.getByRole('dialog', { name: 'New group' });

      await userEvent.type(within(dialog).getByLabelText('Name'), 'Fresh');
      await userEvent.click(within(dialog).getByRole('button', { name: /Create|Add|Save/ }));

      expect(screen.getByRole('region', { name: 'Fresh' })).toBeInTheDocument();
      expect(toast('Created “Fresh”')).toBeInTheDocument();
    });

    it('adds a calendar straight away, but asks what a weather widget should show', async () => {
      render(<App />);
      key({ key: 'e' });

      await userEvent.click(screen.getByRole('button', { name: /Widget/ }));
      await userEvent.click(screen.getByRole('button', { name: /^Calendar/ }));
      expect(screen.getByRole('grid', { name: 'This month' })).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: /Widget/ }));
      await userEvent.click(screen.getByRole('button', { name: /Weather/ }));
      const dialog = screen.getByRole('dialog', { name: 'Weather' });
      await userEvent.clear(within(dialog).getByLabelText(/^Place/));
      await userEvent.type(within(dialog).getByLabelText(/^Place/), 'Oslo');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

      const stored = window.localStorage.getItem(DASHBOARD_STORAGE_KEY);
      await waitFor(() =>
        expect(window.localStorage.getItem(DASHBOARD_STORAGE_KEY)).toContain('Oslo')
      );
      expect(stored).not.toBeNull();
    });

    it('adds an agenda straight away, which asks for a calendar address and asks nobody', async () => {
      const asked: string[] = [];
      vi.stubGlobal('fetch', (url: string) => {
        asked.push(String(url));
        return Promise.reject(new Error('Offline in tests.'));
      });
      render(<App />);
      key({ key: 'e' });

      await userEvent.click(screen.getByRole('button', { name: /Widget/ }));
      await userEvent.click(screen.getByRole('button', { name: /^Agenda/ }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      const agenda = screen.getByRole('region', { name: 'Agenda' });
      expect(
        within(agenda).getByText('Add a calendar address in this widget’s settings.')
      ).toBeInTheDocument();
      expect(asked.filter((url) => url.startsWith('/api/calendar'))).toEqual([]);
    });

    it('removes a widget, and can take it back', async () => {
      seed({ ...board, widgets: [{ type: 'calendar' }] });
      render(<App />);
      key({ key: 'e' });

      await userEvent.click(screen.getByRole('button', { name: /Remove/ }));
      expect(screen.queryByRole('grid', { name: 'This month' })).not.toBeInTheDocument();
      expect(toast('Removed Calendar')).toBeInTheDocument();

      await userEvent.click(within(toasts()).getByRole('button', { name: /Undo/ }));
      expect(screen.getByRole('grid', { name: 'This month' })).toBeInTheDocument();
    });

    it('drops a link dragged onto a group into that group', () => {
      render(<App />);

      fireEvent.drop(group('Read'), {
        dataTransfer: {
          types: ['text/uri-list'],
          files: [],
          getData: (type: string) =>
            ({
              'text/uri-list': 'https://example.com/post',
              'text/x-moz-url': 'https://example.com/post\nA good post'
            })[type] ?? ''
        }
      });

      expect(namesIn('Read')).toEqual(['Lobsters', 'A good post']);
    });

    it('names a dropped link from its address when it brings no title', () => {
      render(<App />);

      fireEvent.drop(group('Read'), {
        dataTransfer: {
          types: ['text/uri-list'],
          files: [],
          getData: (type: string) => (type === 'text/uri-list' ? 'https://example.com/post' : '')
        }
      });

      expect(namesIn('Read')).toHaveLength(2);
      expect(namesIn('Read')[1]).toMatch(/example/i);
    });
  });

  describe('keyboard shortcuts', () => {
    it('Ctrl K and Cmd K go to the search box, even from a text field', async () => {
      render(<App />);
      const search = screen.getByRole('combobox', { name: 'Search' });

      key({ key: 'k', ctrlKey: true });
      expect(search).toHaveFocus();

      search.blur();
      key({ key: 'K', metaKey: true });
      expect(search).toHaveFocus();
    });

    it('/ goes to the search box', () => {
      render(<App />);

      key({ key: '/' });

      expect(screen.getByRole('combobox', { name: 'Search' })).toHaveFocus();
    });

    it('E starts and stops editing', () => {
      render(<App />);

      key({ key: 'e' });
      expect(screen.getByRole('toolbar', { name: 'Edit the board' })).toBeInTheDocument();

      key({ key: 'E' });
      expect(screen.queryByRole('toolbar', { name: 'Edit the board' })).not.toBeInTheDocument();
    });

    it('Escape stops editing', () => {
      render(<App />);
      key({ key: 'e' });

      key({ key: 'Escape' });

      expect(screen.queryByRole('toolbar', { name: 'Edit the board' })).not.toBeInTheDocument();
    });

    it('N and Shift+N open the add dialog', () => {
      render(<App />);

      key({ key: 'n' });

      expect(screen.getByRole('dialog', { name: 'Add a bookmark' })).toBeInTheDocument();
    });

    it('B opens Branchify, when it is turned on', () => {
      render(<App />);

      key({ key: 'b' });

      expect(screen.getByRole('dialog', { name: /Branchify/ })).toBeInTheDocument();
    });

    it('Ctrl Z undoes a delete, and is otherwise left alone', async () => {
      render(<App />);
      rightClick(link(/npm/));
      await userEvent.click(item('Delete'));
      expect(namesIn('Code')).toEqual(['GitHub']);

      const handled = fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
      expect(handled).toBe(false);
      expect(namesIn('Code')).toEqual(['GitHub', 'npm']);

      expect(fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })).toBe(true);
    });

    it('does not use the other shortcuts while typing', async () => {
      render(<App />);
      const search = screen.getByRole('combobox', { name: 'Search' });
      search.focus();

      key({ key: 'n' }, search);
      key({ key: 'e' }, search);

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.queryByRole('toolbar', { name: 'Edit the board' })).not.toBeInTheDocument();
    });

    it('does not use them while a dialog is open', () => {
      render(<App />);
      key({ key: 'n' });
      expect(screen.getAllByRole('dialog')).toHaveLength(1);

      key({ key: 'e' });

      expect(screen.queryByRole('toolbar', { name: 'Edit the board' })).not.toBeInTheDocument();
    });

    it('leaves Alt and Ctrl combinations to the browser', () => {
      render(<App />);

      key({ key: 'e', altKey: true });
      key({ key: 'e', ctrlKey: true });
      key({ key: 'n', metaKey: true });

      expect(screen.queryByRole('toolbar', { name: 'Edit the board' })).not.toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('ignores keys it has no use for', () => {
      render(<App />);

      expect(fireEvent.keyDown(document.body, { key: 'q' })).toBe(true);
    });
  });

  describe('pasting', () => {
    const paste = (text: string, target: Element = document.body): void => {
      fireEvent.paste(target, { clipboardData: { getData: () => text } });
    };

    it('ignores text that is not a link', () => {
      render(<App />);

      paste('just some words');

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('ignores a paste into a text field, which is the field’s own', () => {
      render(<App />);

      paste('https://example.com', screen.getByRole('combobox', { name: 'Search' }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('ignores a paste while a dialog is open', () => {
      render(<App />);
      key({ key: 'n' });
      const before = screen.getAllByRole('dialog').length;

      paste('https://example.com');

      expect(screen.getAllByRole('dialog')).toHaveLength(before);
    });
  });

  describe('dragging things in from outside', () => {
    const drag = (type: string, types: string[]): boolean =>
      fireEvent(
        window,
        Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
          dataTransfer: { types, files: [], getData: () => '' }
        })
      );

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('says a file will be imported when one is held over the page', () => {
      render(<App />);

      drag('dragover', ['Files']);

      expect(screen.getByText('Drop to import bookmarks')).toBeInTheDocument();
    });

    it('says a link can be dropped on a group or anywhere', () => {
      render(<App />);

      drag('dragover', ['text/uri-list']);

      expect(screen.getByText(/Drop on a group to add it there/)).toBeInTheDocument();
    });

    it('takes the hint away a moment after the drag stops', () => {
      render(<App />);
      drag('dragover', ['Files']);

      act(() => {
        vi.advanceTimersByTime(250);
      });

      expect(screen.queryByText('Drop to import bookmarks')).not.toBeInTheDocument();
    });

    it('keeps the hint while the drag goes on', () => {
      render(<App />);

      for (let step = 0; step < 4; step += 1) {
        drag('dragover', ['Files']);
        act(() => {
          vi.advanceTimersByTime(150);
        });
      }

      expect(screen.getByText('Drop to import bookmarks')).toBeInTheDocument();
    });

    it('has no hint for anything else being dragged', () => {
      render(<App />);

      const proceeded = drag('dragover', ['text/plain']);

      expect(proceeded).toBe(true);
      expect(document.querySelector('.drop-hint')).toBeNull();
    });

    it('has no hint while a dialog is open', () => {
      render(<App />);
      key({ key: 'n' });

      drag('dragover', ['Files']);

      expect(document.querySelector('.drop-hint')).toBeNull();
    });

    it('starts a bookmark from a link dropped anywhere on the page', () => {
      render(<App />);

      fireEvent(
        window,
        Object.assign(new Event('drop', { bubbles: true, cancelable: true }), {
          dataTransfer: {
            types: ['text/uri-list'],
            files: [],
            getData: (type: string) =>
              ({
                'text/uri-list': 'https://example.com/page',
                'text/x-moz-url': 'https://example.com/page\nA page'
              })[type] ?? ''
          }
        })
      );

      const dialog = screen.getByRole('dialog', { name: 'Add a bookmark' });
      expect(within(dialog).getByLabelText('Address')).toHaveValue('https://example.com/page');
      expect(within(dialog).getByLabelText('Name')).toHaveValue('A page');
    });

    it('ignores a drop that carries nothing it can use', () => {
      render(<App />);

      fireEvent(
        window,
        Object.assign(new Event('drop', { bubbles: true, cancelable: true }), {
          dataTransfer: { types: [], files: [], getData: () => '' }
        })
      );

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('ignores a drop with no data at all', () => {
      render(<App />);

      fireEvent(window, new Event('drop', { bubbles: true, cancelable: true }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });
});
