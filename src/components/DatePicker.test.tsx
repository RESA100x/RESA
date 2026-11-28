import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DatePicker } from './DatePicker';
import { setLanguage } from '../i18n';

const today = new Date(2026, 6, 23, 9, 42);

function Harness({
  initialValue = '2026-07-23',
  initiallyOpen = false,
  onChange = vi.fn(),
  onOpenChange = vi.fn(),
  disabled = false
}: {
  initialValue?: string;
  initiallyOpen?: boolean;
  onChange?: (value: string) => void;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
} = {}) {
  const [value, setValue] = useState(initialValue);
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <DatePicker
      id="start-date"
      label="开始日期"
      value={value}
      disabled={disabled}
      open={open}
      today={today}
      onOpenChange={(next) => { setOpen(next); onOpenChange(next); }}
      onChange={(next) => { setValue(next); onChange(next); }}
    />
  );
}

describe('DatePicker', () => {
  it('uses an accessible button trigger instead of a native date input', async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness />);
    const trigger = screen.getByRole('button', { name: '开始日期' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveTextContent('2026 年 7 月 23 日');
    expect(container.querySelector('input[type="date"]')).toBeNull();

    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('dialog', { name: '选择开始日期' })).toBeInTheDocument();
  });

  it('renders Monday-first headings and an accessible 42-day grid', () => {
    render(<Harness initiallyOpen />);
    const dialog = screen.getByRole('dialog', { name: '选择开始日期' });
    const headings = within(dialog).getAllByRole('columnheader').map((heading) => heading.textContent);
    expect(headings).toEqual(['一', '二', '三', '四', '五', '六', '日']);
    expect(within(dialog).getAllByRole('gridcell')).toHaveLength(42);
    expect(within(dialog).getByRole('gridcell', { name: '2026年7月23日 星期四' })).toHaveAttribute('aria-selected', 'true');
    expect(within(dialog).getByRole('gridcell', { name: '2026年7月23日 星期四' })).toHaveAttribute('aria-current', 'date');
  });

  it('points the month chevrons along the reading direction', () => {
    const { unmount } = render(<Harness initiallyOpen />);
    const dialog = screen.getByRole('dialog', { name: '选择开始日期' });
    const leftToRightPrevious = within(dialog).getByRole('button', { name: '上一个月' }).querySelector('svg')!.innerHTML;
    const leftToRightNext = within(dialog).getByRole('button', { name: '下一个月' }).querySelector('svg')!.innerHTML;
    expect(leftToRightPrevious).not.toBe(leftToRightNext);
    unmount();

    setLanguage('fa');
    try {
      render(<Harness initiallyOpen />);
      const monthDialog = screen.getByRole('dialog');
      const rightToLeftPrevious = within(monthDialog).getByRole('button', { name: 'ماه قبل' }).querySelector('svg')!.innerHTML;
      const rightToLeftNext = within(monthDialog).getByRole('button', { name: 'ماه بعد' }).querySelector('svg')!.innerHTML;

      expect(rightToLeftPrevious).toBe(leftToRightNext);
      expect(rightToLeftNext).toBe(leftToRightPrevious);
    } finally {
      setLanguage('zh');
    }
  });

  it('navigates months and selects leading or trailing dates directly', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initiallyOpen onChange={onChange} />);
    expect(screen.getByText('2026 年 7 月')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '下一个月' }));
    expect(screen.getByText('2026 年 8 月')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '上一个月' }));
    const trailingDate = screen.getByRole('gridcell', { name: '2026年8月1日 星期六' });
    await user.click(trailingDate);
    expect(onChange).toHaveBeenCalledWith('2026-08-01');
    expect(screen.queryByRole('dialog', { name: '选择开始日期' })).not.toBeInTheDocument();
  });

  it('supports today and clear actions and restores trigger focus', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initialValue="2026-07-10" initiallyOpen onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: '清除日期' }));
    expect(onChange).toHaveBeenLastCalledWith('');
    expect(screen.getByRole('button', { name: '开始日期' })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: '开始日期' }));
    await user.click(screen.getByRole('button', { name: '今天' }));
    expect(onChange).toHaveBeenLastCalledWith('2026-07-23');
    expect(screen.getByRole('button', { name: '开始日期' })).toHaveFocus();
  });

  it('moves by day, week, and month with the keyboard and selects with Enter or Space', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initiallyOpen onChange={onChange} />);
    const selected = screen.getByRole('gridcell', { name: '2026年7月23日 星期四' });
    selected.focus();

    await user.keyboard('{ArrowRight}{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenLastCalledWith('2026-07-31');

    await user.click(screen.getByRole('button', { name: '开始日期' }));
    screen.getByRole('gridcell', { name: '2026年7月31日 星期五' }).focus();
    await user.keyboard('{PageDown} ');
    expect(onChange).toHaveBeenLastCalledWith('2026-08-31');
  });

  it('closes on Escape and outside pointer input with focus restoration', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<Harness initiallyOpen onOpenChange={onOpenChange} />);
    const trigger = screen.getByRole('button', { name: '开始日期' });

    await user.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog', { name: '选择开始日期' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('supports controlled parent closure and disabled state', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <DatePicker id="date" label="日期" value="" open onOpenChange={vi.fn()} onChange={vi.fn()} today={today} />
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    rerender(
      <DatePicker id="date" label="日期" value="" open={false} onOpenChange={vi.fn()} onChange={vi.fn()} today={today} />
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    rerender(
      <DatePicker id="date" label="日期" value="" disabled open={false} onOpenChange={vi.fn()} onChange={vi.fn()} today={today} />
    );
    const trigger = screen.getByRole('button', { name: '日期' });
    expect(trigger).toBeDisabled();
    await user.click(trigger);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('steps a whole year from the header, so a far date is a few clicks away', async () => {
    const user = userEvent.setup();
    render(<Harness initiallyOpen />);
    expect(screen.getByText('2026 年 7 月')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '下一年' }));
    expect(screen.getByText('2027 年 7 月')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '上一年' }));
    await user.click(screen.getByRole('button', { name: '上一年' }));
    expect(screen.getByText('2025 年 7 月')).toBeInTheDocument();
  });

  it('jumps to a typed year through the year grid', async () => {
    const user = userEvent.setup();
    render(<Harness initiallyOpen />);

    await user.click(screen.getByRole('button', { name: '选择月份和年份' }));
    expect(screen.getByRole('group', { name: '选择年份' })).toBeInTheDocument();

    const yearBox = screen.getByLabelText('年份');
    await user.clear(yearBox);
    await user.type(yearBox, '1990{Enter}');

    // Picking the year lands on the month grid for that year.
    expect(screen.getByRole('group', { name: '选择月份和年份' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '返回日历' }));
    expect(screen.getByText('1990 年 7 月')).toBeInTheDocument();
  });

  it('moves a whole year with Shift+PageDown from the keyboard', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initiallyOpen onChange={onChange} />);

    screen.getByRole('gridcell', { name: '2026年7月23日 星期四' }).focus();
    await user.keyboard('{Shift>}{PageDown}{/Shift} ');
    expect(onChange).toHaveBeenLastCalledWith('2027-07-23');
  });

  it('points the year chevrons the same way as the month chevrons', () => {
    const { unmount } = render(<Harness initiallyOpen />);
    const dialog = screen.getByRole('dialog', { name: '选择开始日期' });
    const previousMonth = within(dialog).getByRole('button', { name: '上一个月' }).querySelector('svg')!.innerHTML;
    const previousYear = within(dialog).getByRole('button', { name: '上一年' }).querySelector('svg')!.innerHTML;
    expect(previousYear).toBe(previousMonth);
    unmount();

    // Right-to-left: both pairs flip together, so "previous" still points the
    // way the reading direction says it should.
    setLanguage('fa');
    try {
      render(<Harness initiallyOpen />);
      const faDialog = screen.getByRole('dialog');
      const faPreviousMonth = within(faDialog).getByRole('button', { name: 'ماه قبل' }).querySelector('svg')!.innerHTML;
      const faPreviousYear = within(faDialog).getByRole('button', { name: 'سال قبل' }).querySelector('svg')!.innerHTML;
      expect(faPreviousYear).toBe(faPreviousMonth);
      expect(faPreviousMonth).not.toBe(previousMonth);
    } finally {
      setLanguage('zh');
    }
  });

  it('anchors the panel to the viewport so a scrolling dialog cannot clip it', () => {
    render(<Harness initiallyOpen />);
    const dialog = screen.getByRole('dialog', { name: '选择开始日期' });
    // jsdom reports a zero rect for the trigger, so the panel must fall back to
    // the viewport gap instead of the trigger's (nonexistent) position.
    expect(dialog.style.position).toBe('fixed');
    expect(dialog.style.left).toBe('8px');
    expect(dialog.style.width).toBe(`${Math.min(320, window.innerWidth - 16)}px`);
    expect(dialog.style.top).toBe('8px');
  });

  it('leaves the phone bottom sheet to CSS instead of inline positioning', () => {
    document.documentElement.classList.add('is-mobile-shell');
    try {
      render(<Harness initiallyOpen />);
      const dialog = screen.getByRole('dialog', { name: '选择开始日期' });
      expect(dialog.style.position).toBe('');
      expect(dialog.style.left).toBe('');
      expect(dialog.style.top).toBe('');
    } finally {
      document.documentElement.classList.remove('is-mobile-shell');
    }
  });
});
