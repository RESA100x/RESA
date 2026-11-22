import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  ModuleLayoutEntry,
  MonitorInfo,
  MonitorWallpaperArea,
  NowlyRepository
} from '../../data/nowly-repository';
import { RepositoryProvider } from '../../data/RepositoryContext';
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
  const areas: MonitorWallpaperArea[] = [
    {
      id: 'A',
      positionX: 0,
      positionY: 0,
      width: 1920,
      height: 1080,
      left: 0,
      top: 0,
      right: 1920,
      bottom: 1032
    },
    {
      id: 'B',
      positionX: 1920,
      positionY: 0,
      width: 1280,
      height: 1024,
      left: 1920,
      top: 0,
      right: 3200,
      bottom: 976
    }
  ];
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
        mode="wallpaper"
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

describe('DesktopShell multi-monitor wallpaper', () => {
  it('splits the wallpaper into one layout per monitor when enabled', async () => {
    const repository = mount({ multiMonitorWallpaper: true });
    await waitFor(() => expect(screen.getByTestId('wallpaper-monitor-A')).toBeInTheDocument());
    const first = screen.getByTestId('wallpaper-monitor-A');
    const second = screen.getByTestId('wallpaper-monitor-B');
    expect(first).toHaveTextContent('calendar region');
    expect(first).not.toHaveTextContent('notes region');
    expect(second).toHaveTextContent('notes region');
    expect(second).not.toHaveTextContent('calendar region');
    // The panels stop at each monitor's work area, so modules never sit behind
    // the taskbar.
    expect(first).toHaveStyle({ height: '1032px' });
    expect(second).toHaveStyle({ height: '976px', left: '1920px' });
    expect(repository.listModuleLayout).toHaveBeenCalledWith('A');
    expect(repository.listModuleLayout).toHaveBeenCalledWith('B');
  });

  it('keeps the single-monitor shell when the option is off', async () => {
    const repository = mount({ multiMonitorWallpaper: false });
    await waitFor(() => expect(screen.getByTestId('module-grid')).toBeInTheDocument());
    expect(screen.queryByTestId('wallpaper-span')).not.toBeInTheDocument();
    expect(screen.queryByTestId('wallpaper-monitor-A')).not.toBeInTheDocument();
    // The untouched path still asks for the single global layout.
    expect(repository.listModuleLayout).toHaveBeenCalledWith();
  });

  it('stays single-monitor when the monitors use different scales', async () => {
    mount({
      multiMonitorWallpaper: true,
      monitors: [monitors[0], { ...monitors[1], scaleFactor: 1.25 }]
    });
    await waitFor(() => expect(screen.getByTestId('module-grid')).toBeInTheDocument());
    expect(screen.queryByTestId('wallpaper-span')).not.toBeInTheDocument();
  });
});
