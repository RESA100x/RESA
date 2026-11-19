import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { sampleTasks } from '../lib/sample-data';
import { MatrixWidget } from './MatrixWidget';

function props(overrides: Partial<Parameters<typeof MatrixWidget>[0]> = {}): Parameters<typeof MatrixWidget>[0] {
  return {
    tasks: sampleTasks,
    status: 'ready',
    onRetry: vi.fn(),
    onCreateTask: vi.fn(),
    onOpenTask: vi.fn(),
    onToggleTask: vi.fn(),
    onMoveTask: vi.fn(),
    pendingTaskIds: new Set(),
    completionError: null,
    dragError: null,
    onRetryCompletion: vi.fn(),
    onDismissCompletionError: vi.fn(),
    onDismissDragError: vi.fn(),
    ...overrides
  };
}

describe('MatrixWidget', () => {
  it('renders all quadrants, counts, and internal scroll containers', () => {
    render(<MatrixWidget {...props()} />);

    expect(screen.getByRole('region', { name:'重要且紧急' })).toBeInTheDocument();
    expect(screen.getByText('重要且紧急')).toBeInTheDocument();
    expect(screen.getByText('重要不紧急')).toBeInTheDocument();
    expect(screen.getByText('不重要但紧急')).toBeInTheDocument();
    expect(screen.getByText('不重要不紧急')).toBeInTheDocument();
    expect(screen.getAllByText('1/1')).toHaveLength(4);
    expect(screen.getByRole('button', { name: '编辑任务：发布 v0.1' })).toBeInTheDocument();
    expect(screen.getAllByTestId('quadrant-scroll')).toHaveLength(4);
  });

  it('keeps four quadrants visible when empty and retries module errors', async () => {
    const user = userEvent.setup();
    const retry = vi.fn();
    const { rerender } = render(<MatrixWidget {...props({ tasks: [], onRetry: retry })} />);
    expect(screen.getAllByText('暂无任务')).toHaveLength(4);
    expect(screen.getByRole('button', { name: '新增任务' })).toBeInTheDocument();

    rerender(
      <MatrixWidget
        {...props({ tasks: [], status: 'error', errorMessage: '任务读取失败', onRetry: retry })}
      />
    );
    await user.click(screen.getByRole('button', { name: '重试读取任务' }));
    expect(screen.getByRole('alert')).toHaveTextContent('任务读取失败');
    expect(retry).toHaveBeenCalledOnce();
  });

  it('keeps tasks visible while exposing completion retry, dismissal, and pending state', async () => {
    const user = userEvent.setup();
    const retryCompletion = vi.fn();
    const dismiss = vi.fn();
    const toggle = vi.fn();
    render(
      <MatrixWidget
        {...props({
          pendingTaskIds: new Set(['task-1']),
          completionError: '完成状态保存失败',
          onRetryCompletion: retryCompletion,
          onDismissCompletionError: dismiss,
          onToggleTask: toggle
        })}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent('完成状态保存失败');
    expect(screen.getByRole('button', { name: '编辑任务：发布 v0.1' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '完成任务：发布 v0.1' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '重试完成状态' }));
    expect(retryCompletion).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: '关闭错误提示' }));
    expect(dismiss).toHaveBeenCalledOnce();
  });

  it('forwards independent completion and edit intents', async () => {
    const user = userEvent.setup();
    const toggle = vi.fn();
    const open = vi.fn();
    render(<MatrixWidget {...props({ onToggleTask: toggle, onOpenTask: open })} />);

    await user.click(screen.getByRole('checkbox', { name: '完成任务：发布 v0.1' }));
    expect(toggle).toHaveBeenCalledWith(sampleTasks[0], true);
    expect(open).not.toHaveBeenCalled();

    const title = screen.getByRole('button', { name: '编辑任务：发布 v0.1' });
    await user.click(title);
    expect(open).toHaveBeenCalledWith(sampleTasks[0], title);
  });

  it('shows a static loading message without spinners', () => {
    render(<MatrixWidget {...props({ tasks: [], status: 'loading' })} />);
    expect(screen.getByText('正在读取本地任务')).toBeInTheDocument();
  });

  it('does not offer a priority filter above the four quadrants', () => {
    render(<MatrixWidget {...props()} />);
    expect(screen.queryByRole('combobox', { name: '按优先级筛选' })).not.toBeInTheDocument();
  });

  it('moves a task to another quadrant on drag and drop', () => {
    const move = vi.fn();
    render(<MatrixWidget {...props({ onMoveTask: move })} />);

    const row = screen.getByRole('button', { name: '编辑任务：发布 v0.1' }).closest('.task-row') as HTMLElement;
    const target = screen.getByRole('region', { name: '重要不紧急' });

    fireEvent.dragStart(row);
    fireEvent.dragOver(target);
    fireEvent.drop(target);

    expect(move).toHaveBeenCalledWith(sampleTasks[0], 'important_not_urgent');
  });

  it('does not move a task dropped on its own quadrant', () => {
    const move = vi.fn();
    render(<MatrixWidget {...props({ onMoveTask: move })} />);

    const row = screen.getByRole('button', { name: '编辑任务：发布 v0.1' }).closest('.task-row') as HTMLElement;
    const sameQuadrant = screen.getByRole('region', { name: '重要且紧急' });

    fireEvent.dragStart(row);
    fireEvent.dragOver(sameQuadrant);
    fireEvent.drop(sameQuadrant);

    expect(move).not.toHaveBeenCalled();
  });

  it('surfaces a drag error with a dismiss control', async () => {
    const user = userEvent.setup();
    const dismiss = vi.fn();
    render(<MatrixWidget {...props({ dragError: '移动任务失败', onDismissDragError: dismiss })} />);

    expect(screen.getByRole('alert')).toHaveTextContent('移动任务失败');
    await user.click(screen.getByRole('button', { name: '关闭错误提示' }));
    expect(dismiss).toHaveBeenCalledOnce();
  });

  it('keeps finished tasks out of the quadrants until they are revealed', async () => {
    const user = userEvent.setup();
    const done = { ...sampleTasks[0], completed: true };
    render(<MatrixWidget {...props({ tasks: [done] })} />);

    // The quadrant still counts it, but the row is hidden by default.
    expect(screen.getByText('0/1')).toBeInTheDocument();
    expect(screen.getByLabelText('1 个已完成')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '编辑任务：发布 v0.1' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '显示 1 个已完成任务' }));
    expect(screen.getByRole('button', { name: '编辑任务：发布 v0.1' })).toBeInTheDocument();
  });

  it('archives a finished task from its row', async () => {
    const user = userEvent.setup();
    const archive = vi.fn();
    const done = { ...sampleTasks[0], completed: true };
    render(<MatrixWidget {...props({ tasks: [done], onArchiveTask: archive })} />);

    await user.click(screen.getByRole('button', { name: '显示 1 个已完成任务' }));
    await user.click(screen.getByRole('button', { name: '归档「发布 v0.1」' }));
    expect(archive).toHaveBeenCalledWith(done);
  });
});
