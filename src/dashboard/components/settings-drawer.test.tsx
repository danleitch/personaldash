import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps, JSX } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { SEARCH_ENGINES, sanitizeConfig, type DashboardConfig } from '../lib/model';
import { configToYaml } from '../lib/yaml';
import { SettingsDrawer, type SettingsTab } from './settings-drawer';

const boardWith = (overrides: Record<string, unknown> = {}): DashboardConfig =>
  sanitizeConfig({
    name: 'Sam',
    title: 'My board',
    search: 'duckduckgo',
    clock: '12h',
    newTab: true,
    glass: { blur: 12, tint: 0.4 },
    groups: [
      {
        name: 'Code',
        bookmarks: [
          { name: 'GitHub', url: 'https://github.com' },
          { name: 'npm', url: 'https://www.npmjs.com' }
        ]
      }
    ],
    ...overrides
  });

type Props = ComponentProps<typeof SettingsDrawer>;

type Handlers = {
  onChange: Mock<Props['onChange']>;
  onReplace: Mock<Props['onReplace']>;
  onExport: Mock<Props['onExport']>;
  onImportFile: Mock<Props['onImportFile']>;
  onReset: Mock<Props['onReset']>;
  onClose: Mock<Props['onClose']>;
};

const open = (
  options: { config?: DashboardConfig; tab?: SettingsTab } = {}
): Handlers & { rerender: (config: DashboardConfig) => void } => {
  const handlers: Handlers = {
    onChange: vi.fn<Props['onChange']>(),
    onReplace: vi.fn<Props['onReplace']>(),
    onExport: vi.fn<Props['onExport']>(),
    onImportFile: vi.fn<Props['onImportFile']>(),
    onReset: vi.fn<Props['onReset']>(),
    onClose: vi.fn<Props['onClose']>()
  };
  const view = (config: DashboardConfig): JSX.Element => (
    <SettingsDrawer
      config={config}
      initialTab={options.tab}
      appearance={<p>Background choices</p>}
      {...handlers}
    />
  );
  const { rerender } = render(view(options.config ?? boardWith()));

  return { ...handlers, rerender: (config) => rerender(view(config)) };
};

const tab = (name: string): HTMLElement => screen.getByRole('tab', { name });

describe('SettingsDrawer', () => {
  describe('the tabs', () => {
    it('opens on General unless told otherwise', () => {
      open();

      expect(tab('General')).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByLabelText(/Your name/)).toBeInTheDocument();
    });

    it.each([
      ['appearance', 'Appearance', 'Background choices'],
      ['data', 'Data & YAML', /Everything lives in this browser/]
    ] as const)('can open on %s', (initial, name, content) => {
      open({ tab: initial });

      expect(tab(name)).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByText(content)).toBeInTheDocument();
    });

    it('moves between them', async () => {
      open();

      await userEvent.click(tab('Appearance'));
      expect(screen.getByText('Background choices')).toBeInTheDocument();
      expect(tab('General')).toHaveAttribute('aria-selected', 'false');

      await userEvent.click(tab('Data & YAML'));
      expect(screen.getByRole('button', { name: /Export YAML/ })).toBeInTheDocument();

      await userEvent.click(tab('General'));
      expect(screen.getByLabelText(/Your name/)).toBeInTheDocument();
    });

    it('is a labelled tab list', () => {
      open();

      expect(screen.getByRole('tablist', { name: 'Settings sections' })).toBeInTheDocument();
      expect(screen.getByRole('tabpanel')).toBeInTheDocument();
    });

    it('closes from its close button', async () => {
      const { onClose } = open();

      await userEvent.click(screen.getByRole('button', { name: 'Close settings' }));

      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('General', () => {
    it('shows the current settings', () => {
      open();

      expect(screen.getByLabelText(/Your name/)).toHaveValue('Sam');
      expect(screen.getByLabelText(/Page title/)).toHaveValue('My board');
      expect(screen.getByLabelText(/Search with/)).toHaveValue('duckduckgo');
      expect(screen.getByRole('radio', { name: '12-hour' })).toBeChecked();
      expect(screen.getByRole('switch', { name: /Open bookmarks in a new tab/ })).toBeChecked();
    });

    it('changes the name and the title', () => {
      const { onChange } = open();

      fireEvent.change(screen.getByLabelText(/Your name/), { target: { value: 'Alex' } });
      fireEvent.change(screen.getByLabelText(/Page title/), { target: { value: 'Home base' } });

      expect(onChange).toHaveBeenNthCalledWith(1, { name: 'Alex' });
      expect(onChange).toHaveBeenNthCalledWith(2, { title: 'Home base' });
    });

    it('limits how long they can be', () => {
      open();

      expect(screen.getByLabelText(/Your name/)).toHaveAttribute('maxlength', '60');
      expect(screen.getByLabelText(/Page title/)).toHaveAttribute('maxlength', '80');
    });

    it('puts the title back to Home when it is left empty', () => {
      const { onChange } = open({ config: boardWith({ title: '' }) });

      fireEvent.blur(screen.getByLabelText(/Page title/), { target: { value: '   ' } });

      expect(onChange).toHaveBeenCalledWith({ title: 'Home' });
    });

    it('leaves a title that has something in it alone when it is left', () => {
      const { onChange } = open();

      fireEvent.blur(screen.getByLabelText(/Page title/), { target: { value: 'My board' } });

      expect(onChange).not.toHaveBeenCalled();
    });

    it('offers every search engine, and changes it', async () => {
      const { onChange } = open();
      const select = screen.getByLabelText(/Search with/);

      expect(
        within(select)
          .getAllByRole('option')
          .map((option) => option.getAttribute('value'))
      ).toEqual(Object.keys(SEARCH_ENGINES));

      await userEvent.selectOptions(select, 'brave');
      expect(onChange).toHaveBeenCalledWith({ search: 'brave' });
    });

    it('changes the clock', async () => {
      const { onChange } = open();

      await userEvent.click(screen.getByRole('radio', { name: '24-hour' }));

      expect(onChange).toHaveBeenCalledWith({ clock: '24h' });
    });

    it('flips whether bookmarks open in a new tab, and whether the side bar hides', async () => {
      const { onChange } = open({ config: boardWith({ newTab: true, pinBar: false }) });

      await userEvent.click(screen.getByRole('switch', { name: /Open bookmarks in a new tab/ }));
      await userEvent.click(screen.getByRole('switch', { name: /Don’t auto-hide the side bar/ }));

      expect(onChange).toHaveBeenNthCalledWith(1, { newTab: false });
      expect(onChange).toHaveBeenNthCalledWith(2, { pinBar: true });
    });

    describe('status alerts', () => {
      const choice = (name: string): HTMLInputElement =>
        within(screen.getByRole('group', { name: 'Services to watch' })).getByRole('checkbox', {
          name
        });

      it('offers every service, with the ones watched ticked', () => {
        open({ config: boardWith({ status: ['npm', 'github'] }) });

        const boxes = within(screen.getByRole('group', { name: 'Services to watch' })).getAllByRole(
          'checkbox'
        ) as HTMLInputElement[];
        expect(boxes.map((box) => box.parentElement?.textContent)).toEqual([
          'GitHub',
          'npm',
          'Cloudflare',
          'Vercel',
          'Netlify',
          'Docker',
          'Anthropic',
          'Discord',
          'DigitalOcean'
        ]);
        expect(
          boxes.filter((box) => box.checked).map((box) => box.parentElement?.textContent)
        ).toEqual(['GitHub', 'npm']);
      });

      it('starts a service being watched, keeping them in the order they are offered', async () => {
        const { onChange } = open({ config: boardWith({ status: ['npm'] }) });

        await userEvent.click(choice('GitHub'));

        expect(onChange).toHaveBeenCalledExactlyOnceWith({ status: ['github', 'npm'] });
      });

      it('stops one being watched', async () => {
        const { onChange } = open({ config: boardWith({ status: ['github', 'npm'] }) });

        await userEvent.click(choice('GitHub'));

        expect(onChange).toHaveBeenCalledExactlyOnceWith({ status: ['npm'] });
      });

      it('says the bar is for outages unless slow service is asked for too', async () => {
        const { onChange } = open();
        const toggle = screen.getByRole('switch', { name: /slow or partly broken/ });

        expect(toggle).not.toBeChecked();
        await userEvent.click(toggle);

        expect(onChange).toHaveBeenCalledExactlyOnceWith({ statusDegraded: true });
      });

      it('shows slow service already being asked for', () => {
        open({ config: boardWith({ statusDegraded: true }) });

        expect(screen.getByRole('switch', { name: /slow or partly broken/ })).toBeChecked();
      });
    });

    it('lists the keyboard shortcuts', () => {
      open();
      const list = screen.getByText('Keyboard').closest('section')!;

      expect(within(list).getByText('Search bookmarks and the web')).toBeInTheDocument();
      expect(within(list).getByText('Undo a delete')).toBeInTheDocument();
      expect(within(list).getAllByText('K').length).toBeGreaterThan(0);
      // Two ways to search: "/" or Ctrl K.
      expect(within(list).getByText('or')).toBeInTheDocument();
    });
  });

  describe('Appearance', () => {
    it('shows the background choices it was given', async () => {
      open({ tab: 'appearance' });

      expect(screen.getByText('Background choices')).toBeInTheDocument();
    });

    it('shows and changes the blur, leaving the tint', () => {
      const { onChange } = open({ tab: 'appearance' });
      const blur = screen.getByLabelText('Blur: 12px');

      expect(blur).toHaveAttribute('min', '0');
      expect(blur).toHaveAttribute('max', '32');
      fireEvent.change(blur, { target: { value: '20' } });

      expect(onChange).toHaveBeenCalledWith({ glass: { blur: 20, tint: 0.4 } });
    });

    it('shows and changes the tint, as a percentage, leaving the blur', () => {
      const { onChange } = open({ tab: 'appearance' });
      const tint = screen.getByLabelText('Tint: 40%');

      expect(tint).toHaveAttribute('max', '90');
      fireEvent.change(tint, { target: { value: '65' } });

      expect(onChange).toHaveBeenCalledWith({ glass: { blur: 12, tint: 0.65 } });
    });
  });

  describe('Data & YAML', () => {
    beforeEach(() => {
      vi.useRealTimers();
    });

    it('exports the board', async () => {
      const { onExport } = open({ tab: 'data' });

      await userEvent.click(screen.getByRole('button', { name: /Export YAML/ }));

      expect(onExport).toHaveBeenCalledTimes(1);
    });

    describe('importing', () => {
      const fileInput = (): HTMLInputElement =>
        document.querySelector<HTMLInputElement>('input[type="file"]')!;

      it('opens the file chooser from the Import button', async () => {
        open({ tab: 'data' });
        const click = vi.spyOn(fileInput(), 'click').mockImplementation(() => {});

        await userEvent.click(screen.getByRole('button', { name: /Import…/ }));

        expect(click).toHaveBeenCalledTimes(1);
      });

      it('takes the kinds of file an import can read', () => {
        open({ tab: 'data' });

        expect(fileInput().accept.split(',')).toEqual(
          expect.arrayContaining(['.yaml', '.yml', '.json', '.html', '.htm'])
        );
      });

      it('hands over the file that was chosen, and lets the same one be chosen again', () => {
        const { onImportFile } = open({ tab: 'data' });
        const file = new File(['title: x'], 'board.yaml', { type: 'text/yaml' });

        fireEvent.change(fileInput(), { target: { files: [file] } });

        expect(onImportFile).toHaveBeenCalledExactlyOnceWith(file);
        expect(fileInput().value).toBe('');
      });

      it('does nothing when the chooser is dismissed with no file', () => {
        const { onImportFile } = open({ tab: 'data' });

        fireEvent.change(fileInput(), { target: { files: [] } });

        expect(onImportFile).not.toHaveBeenCalled();
      });
    });

    describe('the YAML editor', () => {
      const editor = (): HTMLTextAreaElement => screen.getByLabelText('Dashboard YAML');
      const apply = (): HTMLElement => screen.getByRole('button', { name: /Apply/ });
      const revert = (): HTMLElement => screen.getByRole('button', { name: 'Revert' });

      it('shows the board as YAML, and how many bookmarks it holds', () => {
        const config = boardWith();
        open({ config, tab: 'data' });

        expect(editor()).toHaveValue(configToYaml(config));
        expect(screen.getByText('2 bookmarks')).toBeInTheDocument();
        expect(editor()).not.toHaveAttribute('aria-invalid');
      });

      it('has nothing to apply or revert until it is edited', () => {
        open({ tab: 'data' });

        expect(apply()).toBeDisabled();
        expect(revert()).toBeDisabled();
      });

      it('says when it has been edited but not applied', () => {
        open({ tab: 'data' });

        fireEvent.change(editor(), { target: { value: `${editor().value}\n# note` } });

        expect(screen.getByText('Edited, not applied')).toBeInTheDocument();
        expect(apply()).toBeEnabled();
        expect(revert()).toBeEnabled();
      });

      it('applies valid YAML as the new board', async () => {
        const { onReplace } = open({ tab: 'data' });
        fireEvent.change(editor(), { target: { value: 'title: Changed\ngroups: []' } });

        await userEvent.click(apply());

        expect(onReplace).toHaveBeenCalledTimes(1);
        expect(onReplace.mock.calls[0]![0]).toMatchObject({ pages: expect.any(Array) });
        expect(onReplace.mock.calls[0]![1]).toBe('Applied your YAML.');
        expect(screen.queryByText('Edited, not applied')).not.toBeInTheDocument();
      });

      it('applies from the keyboard with Ctrl+Enter, and Cmd+Enter', () => {
        const { onReplace } = open({ tab: 'data' });
        fireEvent.change(editor(), { target: { value: 'title: One' } });

        fireEvent.keyDown(editor(), { key: 'Enter', ctrlKey: true });
        fireEvent.change(editor(), { target: { value: 'title: Two' } });
        fireEvent.keyDown(editor(), { key: 'Enter', metaKey: true });

        expect(onReplace).toHaveBeenCalledTimes(2);
      });

      it('does not apply on a plain Enter, which starts a new line', () => {
        const { onReplace } = open({ tab: 'data' });
        fireEvent.change(editor(), { target: { value: 'title: One' } });

        const proceeded = fireEvent.keyDown(editor(), { key: 'Enter' });

        expect(proceeded).toBe(true);
        expect(onReplace).not.toHaveBeenCalled();
      });

      describe('when the YAML is wrong', () => {
        const broken = 'title: Fine\nname: [unclosed\ngroups: []';

        it('says where, and keeps what was typed', async () => {
          const { onReplace } = open({ tab: 'data' });
          fireEvent.change(editor(), { target: { value: broken } });

          await userEvent.click(apply());

          expect(screen.getByRole('alert')).toHaveTextContent(/^Line \d+: /);
          expect(editor()).toHaveAttribute('aria-invalid', 'true');
          expect(editor()).toHaveValue(broken);
          expect(onReplace).not.toHaveBeenCalled();
        });

        it('puts the cursor on the line at fault, selecting it', async () => {
          open({ tab: 'data' });
          fireEvent.change(editor(), { target: { value: broken } });

          await userEvent.click(apply());

          const [, line] = /^Line (\d+): /.exec(screen.getByRole('alert').textContent!)!;
          const lines = broken.split('\n');
          const selected = editor().value.slice(editor().selectionStart, editor().selectionEnd);

          expect(editor()).toHaveFocus();
          expect(lines[Number(line) - 1]).toContain(selected);
          expect(selected.length).toBeGreaterThan(0);
        });

        it('clears the complaint as soon as it is edited again', async () => {
          open({ tab: 'data' });
          fireEvent.change(editor(), { target: { value: broken } });
          await userEvent.click(apply());

          fireEvent.change(editor(), { target: { value: 'title: Fixed' } });

          expect(screen.queryByRole('alert')).not.toBeInTheDocument();
          expect(editor()).not.toHaveAttribute('aria-invalid');
        });

        it('clears it on Revert too', async () => {
          open({ tab: 'data' });
          fireEvent.change(editor(), { target: { value: broken } });
          await userEvent.click(apply());

          await userEvent.click(revert());

          expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        });
      });

      it('goes back to the board’s own YAML on Revert', async () => {
        const config = boardWith();
        open({ config, tab: 'data' });
        fireEvent.change(editor(), { target: { value: 'nonsense' } });

        await userEvent.click(revert());

        expect(editor()).toHaveValue(configToYaml(config));
        expect(screen.queryByText('Edited, not applied')).not.toBeInTheDocument();
      });

      describe('Tab', () => {
        it('indents by two spaces where the cursor is, instead of leaving the editor', () => {
          open({ tab: 'data' });
          const area = editor();
          fireEvent.change(area, { target: { value: 'ab' } });
          area.setSelectionRange(1, 1);

          const proceeded = fireEvent.keyDown(area, { key: 'Tab' });

          expect(proceeded).toBe(false);
          expect(area).toHaveValue('a  b');
          expect(screen.getByText('Edited, not applied')).toBeInTheDocument();
        });

        it('replaces what is selected', () => {
          open({ tab: 'data' });
          const area = editor();
          fireEvent.change(area, { target: { value: 'abcd' } });
          area.setSelectionRange(1, 3);

          fireEvent.keyDown(area, { key: 'Tab' });

          expect(area).toHaveValue('a  d');
        });

        it('puts the cursor after the indent', async () => {
          vi.useFakeTimers();
          open({ tab: 'data' });
          const area = editor();
          fireEvent.change(area, { target: { value: 'ab' } });
          area.setSelectionRange(1, 1);

          fireEvent.keyDown(area, { key: 'Tab' });
          act(() => {
            vi.advanceTimersByTime(20);
          });

          expect(area.selectionStart).toBe(3);
          vi.useRealTimers();
        });

        it('does not indent on Shift+Tab, which is for moving back out of the editor', () => {
          open({ tab: 'data' });
          const area = editor();
          fireEvent.change(area, { target: { value: 'ab' } });
          area.setSelectionRange(1, 1);

          fireEvent.keyDown(area, { key: 'Tab', shiftKey: true });

          expect(area).toHaveValue('ab');
        });
      });

      describe('copying', () => {
        const withClipboard = (writeText: (text: string) => Promise<void>): void => {
          Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText }
          });
        };

        afterEach(() => {
          delete (navigator as { clipboard?: unknown }).clipboard;
        });

        it('copies what is in the editor, edits and all', async () => {
          const writeText = vi.fn().mockResolvedValue(undefined);
          withClipboard(writeText);
          open({ tab: 'data' });
          fireEvent.change(editor(), { target: { value: 'title: Edited' } });

          await userEvent.click(screen.getByRole('button', { name: 'Copy YAML' }));

          expect(writeText).toHaveBeenCalledExactlyOnceWith('title: Edited');
        });

        it('shows a tick for a moment, then the copy icon again', async () => {
          vi.useFakeTimers({ shouldAdvanceTime: true });
          withClipboard(vi.fn().mockResolvedValue(undefined));
          open({ tab: 'data' });
          const button = screen.getByRole('button', { name: 'Copy YAML' });
          expect(button.querySelector('.lucide-clipboard-copy')).not.toBeNull();

          await userEvent.click(button, { advanceTimers: vi.advanceTimersByTime });
          expect(button.querySelector('.lucide-check')).not.toBeNull();

          act(() => {
            vi.advanceTimersByTime(1700);
          });
          expect(button.querySelector('.lucide-clipboard-copy')).not.toBeNull();
          vi.useRealTimers();
        });

        it('selects the text for the visitor to copy when the clipboard is not allowed', async () => {
          withClipboard(vi.fn().mockRejectedValue(new Error('denied')));
          open({ tab: 'data' });
          const select = vi.spyOn(editor(), 'select');

          await userEvent.click(screen.getByRole('button', { name: 'Copy YAML' }));

          expect(select).toHaveBeenCalledTimes(1);
        });
      });

      it('follows changes made on the board while the visitor is not editing', () => {
        const first = boardWith();
        const { rerender } = open({ config: first, tab: 'data' });
        const next = boardWith({ name: 'Riley' });

        rerender(next);

        expect(editor()).toHaveValue(configToYaml(next));
      });

      it('leaves the visitor’s edit alone when the board changes under it', () => {
        const { rerender } = open({ tab: 'data' });
        fireEvent.change(editor(), { target: { value: 'my work in progress' } });

        rerender(boardWith({ name: 'Riley' }));

        expect(editor()).toHaveValue('my work in progress');
      });
    });

    describe('starting over', () => {
      it('asks first', () => {
        open({ tab: 'data' });

        expect(screen.queryByRole('button', { name: 'Example board' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Reset the board…/ })).toBeInTheDocument();
      });

      it.each([
        ['Example board', 'example'],
        ['Empty board', 'empty']
      ] as const)('resets to the %s once confirmed', async (label, kind) => {
        const { onReset } = open({ tab: 'data' });

        await userEvent.click(screen.getByRole('button', { name: /Reset the board…/ }));
        await userEvent.click(screen.getByRole('button', { name: label }));

        expect(onReset).toHaveBeenCalledExactlyOnceWith(kind);
        expect(screen.getByRole('button', { name: /Reset the board…/ })).toBeInTheDocument();
      });

      it('goes back to one button on Cancel, resetting nothing', async () => {
        const { onReset } = open({ tab: 'data' });
        await userEvent.click(screen.getByRole('button', { name: /Reset the board…/ }));

        await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(onReset).not.toHaveBeenCalled();
        expect(screen.queryByRole('button', { name: 'Example board' })).not.toBeInTheDocument();
      });

      it('says a reset can be undone', () => {
        open({ tab: 'data' });

        expect(screen.getByText(/You can undo a reset/)).toBeInTheDocument();
      });
    });
  });
});
