import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  WIDGET_BLURBS,
  WIDGET_LABELS,
  WIDGET_TYPES,
  createWidget,
  type Widget,
  type WidgetType
} from '../lib/model';
import { WidgetDialog, WidgetPicker } from './widget-dialog';

type Of<T extends WidgetType> = Extract<Widget, { type: T }>;

const widgetOf = <T extends WidgetType>(type: T, overrides: Partial<Of<T>> = {}): Of<T> =>
  ({ ...createWidget(type), ...overrides }) as Of<T>;

const open = (
  widget: Widget
): { onSave: ReturnType<typeof vi.fn>; onClose: ReturnType<typeof vi.fn> } => {
  const onSave = vi.fn();
  const onClose = vi.fn();
  render(<WidgetDialog widget={widget} onSave={onSave} onClose={onClose} />);
  return { onSave, onClose };
};

const save = (): Promise<void> => userEvent.click(screen.getByRole('button', { name: 'Save' }));

const saved = (onSave: ReturnType<typeof vi.fn>): Widget => onSave.mock.calls[0]![0] as Widget;

const slider = (name: RegExp): HTMLInputElement => screen.getByLabelText(name) as HTMLInputElement;

const choose = (group: string, option: string): Promise<void> =>
  userEvent.click(
    within(screen.getByRole('radiogroup', { name: group })).getByRole('radio', { name: option })
  );

describe('WidgetPicker', () => {
  it('offers every kind of widget, with what it does', () => {
    render(<WidgetPicker onPick={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByRole('dialog', { name: 'Add a widget' })).toBeInTheDocument();
    expect(
      screen.getAllByRole('button').filter((b) => b.classList.contains('picker-option'))
    ).toHaveLength(WIDGET_TYPES.length);

    for (const type of WIDGET_TYPES) {
      expect(screen.getByText(WIDGET_LABELS[type])).toBeInTheDocument();
      expect(screen.getByText(WIDGET_BLURBS[type])).toBeInTheDocument();
    }
  });

  it('hands over the kind that was picked', async () => {
    const onPick = vi.fn();
    render(<WidgetPicker onPick={onPick} onClose={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: new RegExp(WIDGET_LABELS.clock) }));

    expect(onPick).toHaveBeenCalledExactlyOnceWith('clock');
  });

  it('offers only the widgets whose extensions are on', () => {
    render(<WidgetPicker types={['weather', 'tv']} onPick={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByText(WIDGET_LABELS.weather)).toBeInTheDocument();
    expect(screen.getByText(WIDGET_LABELS.tv)).toBeInTheDocument();
    expect(screen.queryByText(WIDGET_LABELS.clock)).not.toBeInTheDocument();
  });

  it('says where to turn widgets back on when none are', () => {
    render(<WidgetPicker types={[]} onPick={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByText(/Every widget is turned off/)).toBeInTheDocument();
    expect(screen.getByText(/Extensions, in the side bar/)).toBeInTheDocument();
  });

  it('closes from its close button', async () => {
    const onClose = vi.fn();
    render(<WidgetPicker onPick={vi.fn()} onClose={onClose} />);

    await userEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('WidgetDialog', () => {
  describe('every widget', () => {
    it.each(WIDGET_TYPES)('is titled for a %s widget', (type) => {
      open(widgetOf(type));

      expect(screen.getByRole('dialog', { name: WIDGET_LABELS[type] })).toBeInTheDocument();
    });

    it.each(WIDGET_TYPES)('saves a %s widget untouched, as it came', async (type) => {
      const widget = widgetOf(type);
      const { onSave } = open(widget);

      await save();

      expect(saved(onSave)).toEqual(widget);
    });

    it('closes without saving, from Cancel or the close button', async () => {
      const { onSave, onClose } = open(widgetOf('hackernews'));

      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      await userEvent.click(screen.getByRole('button', { name: 'Close' }));

      expect(onClose).toHaveBeenCalledTimes(2);
      expect(onSave).not.toHaveBeenCalled();
    });

    it('keeps the widget’s id and type when it is saved', async () => {
      const widget = widgetOf('calendar');
      const { onSave } = open(widget);

      await choose('Weeks start on', 'Sunday');
      await save();

      expect(saved(onSave)).toMatchObject({ id: widget.id, type: 'calendar' });
    });
  });

  describe('width', () => {
    it('offers the board’s usual widths, with the current one chosen', () => {
      open(widgetOf('hackernews', { width: 6 }));
      const radios = within(screen.getByRole('radiogroup', { name: 'Width' })).getAllByRole(
        'radio'
      );

      expect(radios.map((radio) => radio.textContent)).toEqual(['¼', '⅓', '½', '⅔', 'Full']);
      expect(radios.map((radio) => radio.getAttribute('aria-checked'))).toEqual([
        'false',
        'false',
        'true',
        'false',
        'false'
      ]);
    });

    it('saves the width that was chosen', async () => {
      const { onSave } = open(widgetOf('hackernews', { width: 4 }));

      await choose('Width', 'Full');
      await save();

      expect(saved(onSave)).toMatchObject({ width: 12 });
    });

    it('shows a width the usual choices do not include, rather than losing it', () => {
      open(widgetOf('hackernews', { width: 5 }));

      expect(
        within(screen.getByRole('radiogroup', { name: 'Width' })).getByRole('radio', {
          name: '5/12'
        })
      ).toBeChecked();
    });
  });

  describe('weather', () => {
    it('shows the place and the units', () => {
      open(widgetOf('weather', { location: 'Cape Town', units: 'imperial' }));

      expect(screen.getByLabelText(/^Place/)).toHaveValue('Cape Town');
      expect(screen.getByRole('radio', { name: '°F, mph' })).toBeChecked();
      expect(screen.getByRole('radio', { name: '°C, km/h' })).not.toBeChecked();
    });

    it('starts with the cursor in the place', () => {
      open(widgetOf('weather'));

      expect(screen.getByLabelText(/^Place/)).toHaveFocus();
    });

    it('saves a new place and units', async () => {
      const { onSave } = open(widgetOf('weather', { location: 'London', units: 'metric' }));

      await userEvent.clear(screen.getByLabelText(/^Place/));
      await userEvent.type(screen.getByLabelText(/^Place/), 'Paris, Île-de-France, France');
      await choose('Units', '°F, mph');
      await save();

      expect(saved(onSave)).toMatchObject({
        location: 'Paris, Île-de-France, France',
        units: 'imperial'
      });
    });

    it('trims the place', async () => {
      const { onSave } = open(widgetOf('weather'));

      await userEvent.clear(screen.getByLabelText(/^Place/));
      await userEvent.type(screen.getByLabelText(/^Place/), '   Oslo  ');
      await save();

      expect(saved(onSave)).toMatchObject({ location: 'Oslo' });
    });

    it('asks for a place rather than saving without one', async () => {
      const { onSave } = open(widgetOf('weather'));

      await userEvent.clear(screen.getByLabelText(/^Place/));
      await save();

      expect(screen.getByRole('alert')).toHaveTextContent('Choose a place.');
      expect(onSave).not.toHaveBeenCalled();
    });

    it('treats a place of only spaces as no place', async () => {
      const { onSave } = open(widgetOf('weather'));

      await userEvent.clear(screen.getByLabelText(/^Place/));
      await userEvent.type(screen.getByLabelText(/^Place/), '   ');
      await save();

      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(onSave).not.toHaveBeenCalled();
    });

    it('clears the complaint as soon as the place is edited', async () => {
      open(widgetOf('weather'));
      await userEvent.clear(screen.getByLabelText(/^Place/));
      await save();
      expect(screen.getByRole('alert')).toBeInTheDocument();

      await userEvent.type(screen.getByLabelText(/^Place/), 'R');

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  describe('markets', () => {
    const symbols = (): string[] =>
      screen.getAllByLabelText('Symbol').map((input) => (input as HTMLInputElement).value);

    it('lists each symbol with its name', () => {
      open(
        widgetOf('markets', {
          symbols: [
            { symbol: 'AAPL', name: 'Apple' },
            { symbol: 'BTC-USD', name: '' }
          ]
        })
      );

      expect(symbols()).toEqual(['AAPL', 'BTC-USD']);
      expect(
        screen.getAllByLabelText('Name').map((input) => (input as HTMLInputElement).value)
      ).toEqual(['Apple', '']);
    });

    it('starts with the cursor in the first symbol only', () => {
      open(widgetOf('markets'));

      expect(screen.getAllByLabelText('Symbol')[0]).toHaveFocus();
    });

    it('adds a blank row, which can be filled in', async () => {
      const { onSave } = open(
        widgetOf('markets', { symbols: [{ symbol: 'AAPL', name: 'Apple' }] })
      );

      await userEvent.click(screen.getByRole('button', { name: /Add symbol/ }));
      await userEvent.type(screen.getAllByLabelText('Symbol')[1]!, 'msft');
      await userEvent.type(screen.getAllByLabelText('Name')[1]!, 'Microsoft');
      await save();

      expect((saved(onSave) as Of<'markets'>).symbols).toEqual([
        { symbol: 'AAPL', name: 'Apple' },
        { symbol: 'MSFT', name: 'Microsoft' }
      ]);
    });

    it('stops offering to add once there are twelve', () => {
      open(
        widgetOf('markets', {
          symbols: Array.from({ length: 12 }, (_unused, index) => ({
            symbol: `S${index}`,
            name: ''
          }))
        })
      );

      expect(screen.queryByRole('button', { name: /Add symbol/ })).not.toBeInTheDocument();
    });

    it('removes the row that was asked to go, and no other', async () => {
      const { onSave } = open(
        widgetOf('markets', {
          symbols: [
            { symbol: 'AAPL', name: '' },
            { symbol: 'MSFT', name: '' },
            { symbol: 'TSLA', name: '' }
          ]
        })
      );

      await userEvent.click(screen.getByRole('button', { name: 'Remove MSFT' }));
      await save();

      expect((saved(onSave) as Of<'markets'>).symbols.map((item) => item.symbol)).toEqual([
        'AAPL',
        'TSLA'
      ]);
    });

    it('names a blank row’s remove button plainly', () => {
      open(widgetOf('markets', { symbols: [{ symbol: '', name: '' }] }));

      expect(screen.getByRole('button', { name: 'Remove symbol' })).toBeInTheDocument();
    });

    it('upper-cases and trims symbols and names, and drops blank rows, when saved', async () => {
      const { onSave } = open(
        widgetOf('markets', {
          symbols: [
            { symbol: ' aapl ', name: '  Apple ' },
            { symbol: '   ', name: 'Nameless' },
            { symbol: 'eurusd=x', name: '' }
          ]
        })
      );

      await save();

      expect((saved(onSave) as Of<'markets'>).symbols).toEqual([
        { symbol: 'AAPL', name: 'Apple' },
        { symbol: 'EURUSD=X', name: '' }
      ]);
    });

    it('edits one row without touching the others', async () => {
      open(
        widgetOf('markets', {
          symbols: [
            { symbol: 'AAPL', name: '' },
            { symbol: 'MSFT', name: '' }
          ]
        })
      );

      await userEvent.type(screen.getAllByLabelText('Symbol')[1]!, 'X');

      expect(symbols()).toEqual(['AAPL', 'MSFTX']);
    });
  });

  describe('clock', () => {
    const zones = (): string[] =>
      screen.getAllByLabelText('Time zone').map((input) => (input as HTMLInputElement).value);

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('lists each zone with its label', () => {
      open(
        widgetOf('clock', {
          zones: [
            { zone: 'Asia/Tokyo', label: 'Tokyo' },
            { zone: 'Europe/Paris', label: '' }
          ]
        })
      );

      expect(zones()).toEqual(['Asia/Tokyo', 'Europe/Paris']);
      expect(
        screen.getAllByLabelText('Label').map((input) => (input as HTMLInputElement).value)
      ).toEqual(['Tokyo', '']);
    });

    it('suggests every zone the browser knows about', () => {
      open(widgetOf('clock'));
      const options = [...document.querySelectorAll('datalist option')].map((option) =>
        option.getAttribute('value')
      );

      expect(options).toContain('Europe/London');
      expect(options.length).toBeGreaterThan(50);
    });

    it('suggests a handful of zones in a browser that cannot list them', () => {
      vi.spyOn(
        Intl as unknown as { supportedValuesOf: () => string[] },
        'supportedValuesOf'
      ).mockImplementation(() => {
        throw new Error('unsupported');
      });
      open(widgetOf('clock'));

      expect(
        [...document.querySelectorAll('datalist option')].map((option) =>
          option.getAttribute('value')
        )
      ).toEqual(['UTC', 'Europe/London', 'America/New_York', 'Asia/Tokyo']);
    });

    it('changes the label of the zone it was typed in, and no other', async () => {
      const { onSave } = open(
        widgetOf('clock', {
          zones: [
            { zone: 'Asia/Tokyo', label: 'Tokyo' },
            { zone: 'Europe/Paris', label: '' }
          ]
        })
      );

      const labels = screen.getAllByLabelText('Label');
      await userEvent.clear(labels[1]!);
      await userEvent.type(labels[1]!, 'Paris');
      await save();

      expect((saved(onSave) as Of<'clock'>).zones).toEqual([
        { zone: 'Asia/Tokyo', label: 'Tokyo' },
        { zone: 'Europe/Paris', label: 'Paris' }
      ]);
    });

    it('adds a blank zone, and stops offering at eight', async () => {
      open(widgetOf('clock', { zones: [{ zone: 'UTC', label: '' }] }));

      for (let added = 0; added < 7; added += 1) {
        await userEvent.click(screen.getByRole('button', { name: /Add time zone/ }));
      }

      expect(zones()).toHaveLength(8);
      expect(screen.queryByRole('button', { name: /Add time zone/ })).not.toBeInTheDocument();
    });

    it('removes the zone that was asked to go, naming it by its label, then its zone', async () => {
      const { onSave } = open(
        widgetOf('clock', {
          zones: [
            { zone: 'Asia/Tokyo', label: 'Tokyo' },
            { zone: 'Europe/Paris', label: '' },
            { zone: '', label: '' }
          ]
        })
      );

      expect(screen.getByRole('button', { name: 'Remove zone' })).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Remove Europe/Paris' }));
      await userEvent.click(screen.getByRole('button', { name: 'Remove Tokyo' }));
      await save();

      expect((saved(onSave) as Of<'clock'>).zones).toEqual([]);
    });

    it('drops blank zone rows when saved', async () => {
      const { onSave } = open(
        widgetOf('clock', {
          zones: [
            { zone: 'Asia/Tokyo', label: 'Tokyo' },
            { zone: '  ', label: 'Blank' }
          ]
        })
      );

      await save();

      expect((saved(onSave) as Of<'clock'>).zones).toEqual([
        { zone: 'Asia/Tokyo', label: 'Tokyo' }
      ]);
    });

    it('refuses a zone that does not exist, saying which, and does not save', async () => {
      const { onSave } = open(
        widgetOf('clock', { zones: [{ zone: 'Mars/Olympus_Mons', label: '' }] })
      );

      await save();

      expect(screen.getByRole('alert')).toHaveTextContent(
        '“Mars/Olympus_Mons” isn’t a time zone. Try one like Europe/Paris.'
      );
      expect(onSave).not.toHaveBeenCalled();
    });

    it('still refuses a zone that does not exist when a blank row sits beside it', async () => {
      const { onSave } = open(
        widgetOf('clock', {
          zones: [
            { zone: '', label: '' },
            { zone: 'Not/Real', label: '' }
          ]
        })
      );

      await save();

      expect(screen.getByRole('alert')).toHaveTextContent('“Not/Real” isn’t a time zone.');
      expect(onSave).not.toHaveBeenCalled();
    });

    it('clears the complaint once the zone is corrected, and then saves', async () => {
      const { onSave } = open(widgetOf('clock', { zones: [{ zone: 'Mars/Olympus', label: '' }] }));
      await save();
      expect(screen.getByRole('alert')).toBeInTheDocument();

      await userEvent.clear(screen.getByLabelText('Time zone'));
      await userEvent.type(screen.getByLabelText('Time zone'), 'Asia/Tokyo');
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      await save();

      expect((saved(onSave) as Of<'clock'>).zones[0]).toMatchObject({ zone: 'Asia/Tokyo' });
    });
  });

  describe('Hacker News', () => {
    it('shows how many stories, on a slider from 3 to 15', () => {
      open(widgetOf('hackernews', { count: 8 }));

      const range = slider(/Stories: 8/);
      expect(range).toHaveValue('8');
      expect(range).toHaveAttribute('min', '3');
      expect(range).toHaveAttribute('max', '15');
      expect(range).toHaveFocus();
    });

    it('saves a new number, and shows it as the slider moves', () => {
      const { onSave } = open(widgetOf('hackernews', { count: 8 }));

      fireEvent.change(slider(/Stories/), { target: { value: '12' } });

      expect(screen.getByText('Stories: 12')).toBeInTheDocument();
      fireEvent.submit(document.getElementById('widget-form')!);
      expect(saved(onSave)).toMatchObject({ count: 12 });
    });
  });

  describe('AI Leaderboard', () => {
    it('shows the ranking, the lab and how many models', () => {
      open(widgetOf('benchlm', { surface: 'coding', creator: 'Anthropic', count: 7 }));

      expect(screen.getByRole('radiogroup', { name: 'Ranking' })).toBeInTheDocument();
      expect(screen.getByLabelText(/Only from/)).toHaveValue('Anthropic');
      expect(slider(/Models: 7/)).toHaveAttribute('max', '15');
    });

    it('saves a different ranking, lab and number', async () => {
      const { onSave } = open(widgetOf('benchlm'));
      const radios = within(screen.getByRole('radiogroup', { name: 'Ranking' })).getAllByRole(
        'radio'
      );

      await userEvent.click(radios[1]!);
      await userEvent.type(screen.getByLabelText(/Only from/), 'Google');
      fireEvent.change(slider(/Models/), { target: { value: '10' } });
      await save();

      expect(saved(onSave)).toMatchObject({ creator: 'Google', count: 10 });
      expect((saved(onSave) as Of<'benchlm'>).surface).not.toBe('overall');
    });

    it('limits the lab to forty characters', () => {
      open(widgetOf('benchlm'));

      expect(screen.getByLabelText(/Only from/)).toHaveAttribute('maxlength', '40');
    });

    it('offers two presets, and marks the one the settings amount to', () => {
      const { unmount } = render(
        <WidgetDialog widget={widgetOf('benchlm')} onSave={vi.fn()} onClose={vi.fn()} />
      );
      expect(screen.getByRole('radio', { name: 'Frontier' })).toBeChecked();
      expect(screen.getByRole('radio', { name: 'Budget' })).not.toBeChecked();
      unmount();

      open(widgetOf('benchlm', { surface: 'coding', maxPrice: 2, count: 9 }));
      expect(screen.getByRole('radio', { name: 'Budget' })).toBeChecked();
    });

    it('marks neither preset once the settings are something else', () => {
      open(widgetOf('benchlm', { surface: 'agentic', creator: 'Google' }));

      expect(screen.getByRole('radio', { name: 'Frontier' })).not.toBeChecked();
      expect(screen.getByRole('radio', { name: 'Budget' })).not.toBeChecked();
    });

    it('fills in the ranking, lab, count and price for the budget preset, width untouched', async () => {
      const { onSave } = open(widgetOf('benchlm', { creator: 'Anthropic', width: 6 }));

      await choose('Preset', 'Budget');

      expect(screen.getByRole('radio', { name: 'Coding' })).toBeChecked();
      expect(screen.getByLabelText(/Only from/)).toHaveValue('');
      expect(screen.getByText('Models: 5')).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: '$2' })).toBeChecked();

      await save();
      expect(saved(onSave)).toMatchObject({
        surface: 'coding',
        creator: '',
        count: 5,
        maxPrice: 2,
        width: 6
      });
    });

    it('goes back to the frontier, with no price limit', async () => {
      const { onSave } = open(widgetOf('benchlm', { surface: 'coding', maxPrice: 2, count: 5 }));

      await choose('Preset', 'Frontier');
      await save();

      expect(saved(onSave)).toMatchObject({
        surface: 'overall',
        creator: '',
        count: 5,
        maxPrice: 0
      });
    });

    it('shows the price limit, and saves a different one', async () => {
      const { onSave } = open(widgetOf('benchlm'));
      const options = within(screen.getByRole('radiogroup', { name: 'Max price' })).getAllByRole(
        'radio'
      );

      expect(options.map((option) => option.textContent)).toEqual([
        'Any',
        '$0.50',
        '$1',
        '$2',
        '$5'
      ]);
      expect(screen.getByRole('radio', { name: 'Any' })).toBeChecked();

      await choose('Max price', '$0.50');
      await save();

      expect(saved(onSave)).toMatchObject({ maxPrice: 0.5 });
    });
  });

  describe('Popular TV', () => {
    it('shows the window and how many shows, on a slider from 3 to 12', () => {
      open(widgetOf('tv', { window: 'day', count: 4 }));

      expect(screen.getByRole('radio', { name: 'Today' })).toBeChecked();
      const range = slider(/Shows: 4/);
      expect(range).toHaveAttribute('min', '3');
      expect(range).toHaveAttribute('max', '12');
    });

    it('saves a different window and number', async () => {
      const { onSave } = open(widgetOf('tv', { window: 'week', count: 5 }));

      await choose('Trending', 'Today');
      fireEvent.change(slider(/Shows/), { target: { value: '9' } });
      await save();

      expect(saved(onSave)).toMatchObject({ window: 'day', count: 9 });
    });
  });

  describe('GitHub Trending', () => {
    it('shows the language, the period and how many repositories', () => {
      open(widgetOf('github', { language: 'rust', since: 'weekly', count: 9 }));

      expect(screen.getByLabelText(/Language/)).toHaveValue('rust');
      expect(screen.getByRole('radio', { name: 'This week' })).toBeChecked();
      expect(slider(/Repositories: 9/)).toBeInTheDocument();
    });

    it('offers all three periods', () => {
      open(widgetOf('github'));

      expect(
        within(screen.getByRole('radiogroup', { name: 'Trending' }))
          .getAllByRole('radio')
          .map((radio) => radio.textContent)
      ).toEqual(['Today', 'This week', 'This month']);
    });

    it('suggests the popular languages', () => {
      open(widgetOf('github'));

      expect(document.querySelectorAll('#github-languages option').length).toBeGreaterThan(5);
    });

    it('tidies the language into GitHub’s own form as the field is left', async () => {
      open(widgetOf('github', { language: 'all' }));
      const input = screen.getByLabelText(/Language/);

      await userEvent.clear(input);
      await userEvent.type(input, '  Jupyter Notebook ');
      // Leaving the field: pressing Tab would be caught by the dialog's tab trap, which in jsdom sees nothing else to focus.
      await userEvent.click(screen.getByRole('heading'));

      expect(input).toHaveValue('jupyter-notebook');
    });

    it('saves the language in that form, and “all” for none', async () => {
      const first = open(widgetOf('github'));
      await userEvent.clear(screen.getByLabelText(/Language/));
      await userEvent.type(screen.getByLabelText(/Language/), 'C Sharp');
      await save();
      expect(saved(first.onSave)).toMatchObject({ language: 'c-sharp' });
    });

    it('saves “all” when the language is cleared', async () => {
      const { onSave } = open(widgetOf('github', { language: 'rust' }));

      await userEvent.clear(screen.getByLabelText(/Language/));
      await save();

      expect(saved(onSave)).toMatchObject({ language: 'all' });
    });

    it('saves a different period and number', async () => {
      const { onSave } = open(widgetOf('github', { since: 'daily', count: 6 }));

      await choose('Trending', 'This month');
      fireEvent.change(slider(/Repositories/), { target: { value: '12' } });
      await save();

      expect(saved(onSave)).toMatchObject({ since: 'monthly', count: 12 });
    });
  });

  describe('agenda', () => {
    it('shows the number of events and what is shown', () => {
      open(widgetOf('agenda', { count: 8, month: true }));

      expect(slider(/Events/)).toHaveValue('8');
      expect(screen.getByRole('radio', { name: 'Month and list' })).toBeChecked();
      expect(screen.getByRole('radio', { name: 'Monday' })).toBeChecked();
    });

    const HOME =
      'https://calendar.google.com/calendar/ical/sam%40example.com/private-aaa111/basic.ics';
    const WORK =
      'https://calendar.google.com/calendar/ical/work%40example.com/private-bbb222/basic.ics';
    const address = (n: number): HTMLInputElement =>
      screen.getByLabelText(`Calendar ${n} address`) as HTMLInputElement;

    it('has room for three calendar addresses, filled in with the ones it has', () => {
      open(widgetOf('agenda', { calendars: [HOME, WORK] }));

      expect(address(1)).toHaveValue(HOME);
      expect(address(2)).toHaveValue(WORK);
      expect(address(3)).toHaveValue('');
      expect(screen.queryByLabelText('Calendar 4 address')).not.toBeInTheDocument();
    });

    it('says where to find an address, and that it is private and goes with the YAML', () => {
      open(widgetOf('agenda'));

      expect(
        screen.getByText(/Secret address in iCal format/, { selector: 'span' })
      ).toBeInTheDocument();
      expect(screen.getByText(/YAML export too/)).toBeInTheDocument();
      expect(screen.queryByText(/CALENDAR_ICAL_URL/)).not.toBeInTheDocument();
    });

    it('saves the addresses typed, in the form they are kept in', async () => {
      const { onSave } = open(widgetOf('agenda'));

      await userEvent.type(address(1), `  ${HOME.replace('https:', 'webcal:')}?hl=en `);
      await userEvent.type(address(3), WORK);
      await save();

      // The gap between them closes, so the second is the second.
      expect(saved(onSave)).toMatchObject({ type: 'agenda', calendars: [HOME, WORK] });
    });

    it('saves none when none are given', async () => {
      const { onSave } = open(widgetOf('agenda', { calendars: [] }));
      await save();

      expect(saved(onSave)).toMatchObject({ calendars: [] });
    });

    it('keeps an address once when it is typed twice', async () => {
      const { onSave } = open(widgetOf('agenda'));

      await userEvent.type(address(1), HOME);
      await userEvent.type(address(2), HOME);
      await save();

      expect(saved(onSave)).toMatchObject({ calendars: [HOME] });
    });

    it('lets an address be changed or cleared', async () => {
      const { onSave } = open(widgetOf('agenda', { calendars: [HOME, WORK] }));

      await userEvent.clear(address(1));
      await userEvent.clear(address(2));
      await userEvent.type(address(2), HOME);
      await save();

      expect(saved(onSave)).toMatchObject({ calendars: [HOME] });
    });

    it('turns away an address that is not Google Calendar’s, without saving or repeating it', async () => {
      const { onSave } = open(widgetOf('agenda'));

      await userEvent.type(address(1), 'https://example.com/private/basic.ics');
      await save();

      expect(onSave).not.toHaveBeenCalled();
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent(
        'That isn’t a Google Calendar secret address in iCal format.'
      );
      expect(alert).not.toHaveTextContent('example.com');
    });

    it('lets the mistake be mended, and saves once it is', async () => {
      const { onSave } = open(widgetOf('agenda'));

      await userEvent.type(address(1), 'nonsense');
      await save();
      expect(screen.getByRole('alert')).toBeInTheDocument();

      await userEvent.clear(address(1));
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      await userEvent.type(address(1), HOME);
      await save();

      expect(saved(onSave)).toMatchObject({ calendars: [HOME] });
    });

    it('saves a different number of events', async () => {
      const { onSave } = open(widgetOf('agenda', { count: 5 }));

      fireEvent.change(slider(/Events/), { target: { value: '10' } });
      await save();

      expect(saved(onSave)).toMatchObject({ type: 'agenda', count: 10 });
    });

    it('saves the list alone, which has no use for the day the weeks start on', async () => {
      const { onSave } = open(widgetOf('agenda', { month: true, weekStart: 1 }));

      await choose('Show', 'List only');
      expect(screen.queryByRole('radiogroup', { name: 'Weeks start on' })).not.toBeInTheDocument();
      await save();

      expect(saved(onSave)).toMatchObject({ month: false });
    });

    it('saves the month and list, and weeks that start on Sunday', async () => {
      const { onSave } = open(widgetOf('agenda', { month: false, weekStart: 1 }));

      await choose('Show', 'Month and list');
      await choose('Weeks start on', 'Sunday');
      await save();

      expect(saved(onSave)).toMatchObject({ month: true, weekStart: 0 });
    });
  });

  describe('calendar', () => {
    it('shows which day the weeks start on', () => {
      open(widgetOf('calendar', { weekStart: 0 }));

      expect(screen.getByRole('radio', { name: 'Sunday' })).toBeChecked();
      expect(screen.getByRole('radio', { name: 'Monday' })).not.toBeChecked();
    });

    it.each([
      ['Sunday', 0],
      ['Monday', 1]
    ] as const)('saves weeks starting on %s', async (day, weekStart) => {
      const { onSave } = open(widgetOf('calendar', { weekStart: weekStart === 0 ? 1 : 0 }));

      await choose('Weeks start on', day);
      await save();

      expect(saved(onSave)).toMatchObject({ weekStart });
    });
  });
});
