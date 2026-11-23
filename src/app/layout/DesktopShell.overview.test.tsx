import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ModuleLayoutEntry,
  MonitorInfo,
  MonitorWallpaperArea,
  NowlyRepository
} from '../../data/nowly-repository';
import { RepositoryProvider } from '../../data/RepositoryContext';
import { t } from '../../i18n';
import { DesktopShell } from './DesktopShell';

const monitors: MonitorInfo[] = [
  {
    id: 'A',
    name: 'A',
    isPrimary: true,
    positionX: 0,
    positionY: 0,
    width: 1920,
    height: 1080,
    scaleFactor: 1
  },
  {
    id: 'B',
    name: 'B',
    isPrimary: false,
    positionX: 1920,
    positionY: 0,
    width: 1280,
    height: 1024,
    scaleFactor: 1
  }
];

function repositoryFor(layouts: Record<string, ModuleLayoutEntry[]>) {
  const listModuleLayout = vi.fn(async (monitor?: string | null) => layouts[monitor ?? ''] ?? []);
  const areas: MonitorWallpaperArea[] = [];
  return {
    listModuleLayout,
    listMonitorWallpaperAreas: vi.fn(async () => areas),
    saveModuleLayout: vi.fn(async (layout: ModuleLayoutEntry[]) => layout)
  } as unknown as NowlyRepository;
}

function mount(props: { multiMonitorWallpaper: boolean; monitors?: MonitorInfo[] }) {
  const repository = repositoryFor({
    '': [{ id: 'calendar', x: 0, y: 0, w: 12, h: 8 }],
    A: [{ id: 'calendar', x: 0, y: 0, w: 12, h: 8 }],
    B: [{ id: 'notes', x: 0, y: 0, w: 12, h: 8 }]
  });
  render(
    <RepositoryProvider repository={repository}>
      <DesktopShell
        mode="foreground"
        time="09:41"
        dateText="today"
        summary=""
        multiMonitorWallpaper={props.multiMonitorWallpaper}
        monitors={props.monitors ?? monitors}
        modules={{
          calendar: <div>calendar region</div>,
          notes: <div>notes region</div>
        }}
      />
    </RepositoryProvider>
  );
  return repository;
}

afterEach(() => localStorage.removeItem('resa.showAllMonitors'));

describe('DesktopShell foreground all-displays overview', () => {
  it('is off by default and keeps the single-monitor shell', async () => {
    const repository = mount({ multiMonitorWallpaper: true });
    await waitFor(() => expect(screen.getByTestId('module-grid')).toBeInTheDocument());
    expect(screen.queryByTestId('monitor-overview')).not.toBeInTheDocument();
    expect(repository.listModuleLayout).toHaveBeenCalledWith();
  });

  it('shows every monitor side by side when toggled on', async () => {
    const repository = mount({ multiMonitorWallpaper: true });
    fireEvent.click(screen.getByRole('button', { name: t('shell.showAllMonitors') }));
    await waitFor(() => expect(screen.getByTestId('monitor-overview')).toBeInTheDocument());
    const first = screen.getByTestId('wallpaper-monitor-A');
    const second = screen.getByTestId('wallpaper-monitor-B');
    expect(first).toHaveTextContent('calendar region');
    expect(second).toHaveTextContent('notes region');
    expect(repository.listModuleLayout).toHaveBeenCalledWith('A');
    expect(repository.listModuleLayout).toHaveBeenCalledWith('B');
    expect(localStorage.getItem('resa.showAllMonitors')).toBe('1');
  });

  it('exposes per-monitor editing controls in overview mode', async () => {
    mount({ multiMonitorWallpaper: true });
    fireEvent.click(screen.getByRole('button', { name: t('shell.showAllMonitors') }));
    await waitFor(() => expect(screen.getByTestId('monitor-overview')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: t('shell.editLayout') }));
    const addButtons = await screen.findAllByRole('button', { name: t('shell.addModule') });
    expect(addButtons.length).toBe(2);
  });

  it('is unavailable when the option is off or the scales differ', async () => {
    mount({ multiMonitorWallpaper: false });
    expect(screen.queryByRole('button', { name: t('shell.showAllMonitors') })).not.toBeInTheDocument();
  });
});

describe('DesktopShell single-view monitor switch', () => {
  it('switches the window between monitors at their real size', async () => {
    const repository = mount({ multiMonitorWallpaper: true });
    const group = screen.getByRole('group', { name: t('shell.viewMonitor') });
    expect(group).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'B' }));
    await waitFor(() => expect(repository.listModuleLayout).toHaveBeenCalledWith('B'));
    await waitFor(() => expect(screen.getByTestId('module-grid')).toHaveTextContent('notes region'));
    expect(screen.queryByTestId('monitor-overview')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'A' }));
    await waitFor(() => expect(screen.getByTestId('module-grid')).toHaveTextContent('calendar region'));
  });

  it('hides the switch while every monitor is shown at once', async () => {
    mount({ multiMonitorWallpaper: true });
    fireEvent.click(screen.getByRole('button', { name: t('shell.showAllMonitors') }));
    await waitFor(() => expect(screen.getByTestId('monitor-overview')).toBeInTheDocument());
    expect(screen.queryByRole('group', { name: t('shell.viewMonitor') })).not.toBeInTheDocument();
  });
});
