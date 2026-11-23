import { Check, LayoutGrid, MonitorDown, Mosaic, Plus, Search, Settings } from '../../components/icons';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  builtinDefinitions,
  getWidgetDefinition,
  type WidgetDefinition,
  type WidgetId
} from '../../widgets/widget-registry';
import type { MonitorInfo, MonitorWallpaperArea, UpdateInfo } from '../../data/nowly-repository';
import { useNowlyRepository } from '../../data/RepositoryContext';
import { useModuleLayout } from '../../widgets/useModuleLayout';
import { TemplatePickerDialog } from '../../widgets/TemplatePickerDialog';
import { AboutDialog } from '../../settings/AboutDialog';
import { ModuleGrid, type ModuleGridItem } from './ModuleGrid';
import { Tip } from '../../components/Tip';
import { BlurControl } from '../BlurControl';
import { DEFAULT_BLUR, useBlur } from '../useBlur';
import { t } from '../../i18n';
import { WelcomeSticker } from '../../stickers/WelcomeSticker';

type DesktopShellProps = {
  mode?: 'foreground' | 'wallpaper';
  time: string;
  dateText: string;
  summary: string;
  modules: Partial<Record<WidgetId, ReactNode>>;
  definitions?: WidgetDefinition[];
  isModeSwitching?: boolean;
  onSetWallpaper?: () => void;
  onWallpaperDoubleClick?: () => void;
  onOpenSettings?: () => void;
  // Opens the command palette (Ctrl+K); the topbar button keeps it discoverable.
  onOpenSearch?: () => void;
  configurations?: Partial<Record<WidgetId, () => void>>;
  // Hide the topbar and module headers as wallpaper. Defaults on; all headers
  // return in the foreground.
  hideTopbarInWallpaper?: boolean;
  hideModuleBackgroundInWallpaper?: boolean;
  // Opt-in per-monitor wallpaper. When off (the default) nothing below changes.
  multiMonitorWallpaper?: boolean;
  monitors?: MonitorInfo[];
  // Which monitor's layout the foreground window edits (undefined = the single
  // global layout).
  monitorKey?: string | null;
  // Human-readable name of the monitor being edited, shown while editing.
  layoutTargetLabel?: string;
  overlay?: ReactNode;
  // The launch-time update check result. When it reports a newer release the
  // logo button shows a red dot, and the About dialog surfaces the changelog.
  update?: UpdateInfo | null;
};

// Render today's accumulated focus time as a compact, human-friendly label for
// The wallpaper layer sits behind the app content. It stays hidden until a
// wallpaper source is configured; for now it only anchors the stacking order
// so the blur filter can soften the modules over the desktop wallpaper.
function WallpaperLayer() {
  return <div className="wallpaper-layer" data-testid="wallpaper-layer" aria-hidden="true" hidden />;
}

// One monitor's slice of the shell. Each slice owns its own layout, so a module
// can sit on one screen without appearing on the others. In the wallpaper the
// slices are read-only; in the foreground overview they stay editable.
function MonitorPanel({
  monitorId,
  style,
  modules,
  definitions,
  editing = false,
  label,
  className
}: {
  monitorId: string;
  style?: CSSProperties;
  modules: Partial<Record<WidgetId, ReactNode>>;
  definitions: WidgetDefinition[];
  editing?: boolean;
  label?: string;
  className?: string;
}) {
  const { layout, loaded, move, resize, addWidget, removeWidget, presentIds } =
    useModuleLayout(definitions, monitorId);
  const [pickerOpen, setPickerOpen] = useState(false);
  const items: ModuleGridItem[] = layout
    .filter(
      (entry) => modules[entry.id] !== undefined && getWidgetDefinition(entry.id, definitions) !== undefined
    )
    .map((entry) => ({
      id: entry.id,
      rect: { x: entry.x, y: entry.y, w: entry.w, h: entry.h },
      content: modules[entry.id]
    }));
  return (
    <div
      className={className ? `wallpaper-monitor ${className}` : 'wallpaper-monitor'}
      data-testid={`wallpaper-monitor-${monitorId}`}
      style={style}
    >
      {editing ? (
        <div className="monitor-panel__label">
          <span className="monitor-panel__name">{label ?? monitorId}</span>
          <button
            type="button"
            className="monitor-panel__add"
            aria-label={t('shell.addModule')}
            disabled={!loaded}
            onClick={() => setPickerOpen(true)}
          >
            <Plus aria-hidden="true" />
          </button>
        </div>
      ) : null}
      <main className="workspace" aria-busy={!loaded}>
        {loaded ? (
          <ModuleGrid
            items={items}
            editing={editing}
            definitions={definitions}
            onMove={move}
            onResize={resize}
            onRemove={editing ? removeWidget : undefined}
          />
        ) : null}
      </main>
      {pickerOpen ? (
        <TemplatePickerDialog
          presentIds={presentIds}
          onClose={() => setPickerOpen(false)}
          onAdd={(id) => addWidget(id)}
          onRemove={(id) => removeWidget(id)}
        />
      ) : null}
    </div>
  );
}

// The wallpaper window spans the whole virtual desktop; every monitor is placed
// at its own offset inside it. Positions are physical pixels, converted to CSS
// pixels with the device pixel ratio the webview was pinned to.
function WallpaperSpan({
  monitors,
  modules,
  definitions,
  style
}: {
  monitors: MonitorInfo[];
  modules: Partial<Record<WidgetId, ReactNode>>;
  definitions: WidgetDefinition[];
  style?: CSSProperties;
}) {
  const repository = useNowlyRepository();
  // Work areas (taskbar excluded) so modules never end up behind a taskbar.
  const [areas, setAreas] = useState<MonitorWallpaperArea[] | null>(null);
  useEffect(() => {
    let active = true;
    void repository
      .listMonitorWallpaperAreas?.()
      .then((list) => {
        if (active) setAreas(list);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [repository]);
  const left = Math.min(...monitors.map((monitor) => monitor.positionX));
  const top = Math.min(...monitors.map((monitor) => monitor.positionY));
  const scale = typeof window !== 'undefined' && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
  return (
    <div className="wallpaper-span" style={style}>
      {monitors.map((monitor) => {
        const area = areas?.find(
          (item) =>
            item.id === monitor.id ||
            (item.positionX === monitor.positionX &&
              item.positionY === monitor.positionY &&
              item.width === monitor.width &&
              item.height === monitor.height)
        );
        const rect = area
          ? {
              left: area.left - left,
              top: area.top - top,
              width: area.right - area.left,
              height: area.bottom - area.top
            }
          : {
              left: monitor.positionX - left,
              top: monitor.positionY - top,
              width: monitor.width,
              height: monitor.height
            };
        return (
          <MonitorPanel
            key={monitor.id}
            monitorId={monitor.id}
            modules={modules}
            definitions={definitions}
            style={{
              left: rect.left / scale,
              top: rect.top / scale,
              width: rect.width / scale,
              height: rect.height / scale
            }}
          />
        );
      })}
    </div>
  );
}

const OVERVIEW_STORAGE_KEY = 'resa.showAllMonitors';

// Windows reports monitors as device paths (`\\.\DISPLAY1`). Those are useless
// as a heading, so fall back to a numbered label whenever the name is not a
// human-friendly one.
function monitorDisplayName(monitor: MonitorInfo, index: number) {
  const name = monitor.name?.trim() ?? '';
  if (!name || name.startsWith('\\\\.\\') || name.startsWith('display:')) {
    return t('shell.displayNumber', { number: index + 1 });
  }
  return name;
}

function readOverviewPreference() {
  try {
    return window.localStorage.getItem(OVERVIEW_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeOverviewPreference(enabled: boolean) {
  try {
    window.localStorage.setItem(OVERVIEW_STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    // A blocked storage API only costs the preference, never the view.
  }
}

// Foreground "all displays" view. The real window can only sit on one screen at
// a time, so instead of a second native window we draw the whole virtual desktop
// inside this one: every monitor keeps its true size and offset, and the whole
// stage is scaled down to fit. Each slice stays editable, so modules on the
// other screen can be moved, resized, added and removed without dragging the
// window over first.
function MonitorOverview({
  monitors,
  modules,
  definitions,
  editing
}: {
  monitors: MonitorInfo[];
  modules: Partial<Record<WidgetId, ReactNode>>;
  definitions: WidgetDefinition[];
  editing: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const ratio = typeof window !== 'undefined' && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
  const left = Math.min(...monitors.map((monitor) => monitor.positionX));
  const top = Math.min(...monitors.map((monitor) => monitor.positionY));
  const right = Math.max(...monitors.map((monitor) => monitor.positionX + monitor.width));
  const bottom = Math.max(...monitors.map((monitor) => monitor.positionY + monitor.height));
  const stageWidth = Math.max(1, (right - left) / ratio);
  const stageHeight = Math.max(1, (bottom - top) / ratio);
  const inset = 24;
  // Before the first measurement (and in environments without layout, such as
  // tests) fall back to the viewport so the stage still renders.
  const availableWidth = size.width > 0 ? size.width : typeof window !== 'undefined' ? window.innerWidth : 0;
  const availableHeight = size.height > 0 ? size.height : typeof window !== 'undefined' ? window.innerHeight : 0;
  const fit =
    availableWidth > 0 && availableHeight > 0
      ? Math.min(
          (availableWidth - inset * 2) / stageWidth,
          (availableHeight - inset * 2) / stageHeight
        )
      : 0;
  // Never blow a small monitor up past 1:1; this is a preview, not a zoom.
  const scale = fit > 0 ? Math.min(fit, 1) : 0;
  return (
    <div className="monitor-overview" data-testid="monitor-overview" ref={containerRef}>
      {scale > 0 ? (
        <div
          className="monitor-overview__stage"
          style={
            {
              width: stageWidth,
              height: stageHeight,
              transform: `scale(${scale})`,
              '--overview-scale': scale
            } as CSSProperties
          }
        >
          {monitors.map((monitor, index) => (
            <MonitorPanel
              key={monitor.id}
              monitorId={monitor.id}
              className="monitor-overview__panel"
              label={monitorDisplayName(monitor, index)}
              editing={editing}
              modules={modules}
              definitions={definitions}
              style={{
                left: (monitor.positionX - left) / ratio,
                top: (monitor.positionY - top) / ratio,
                width: monitor.width / ratio,
                height: monitor.height / ratio
              }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function DesktopShell({
  mode = 'foreground',
  dateText,
  summary,
  modules,
  definitions = builtinDefinitions,
  isModeSwitching = false,
  onSetWallpaper,
  onWallpaperDoubleClick,
  onOpenSettings,
  onOpenSearch,
  configurations,
  hideTopbarInWallpaper = true,
  hideModuleBackgroundInWallpaper = false,
  multiMonitorWallpaper = false,
  monitors = [],
  monitorKey,
  layoutTargetLabel,
  overlay,
  update
}: DesktopShellProps) {
  const foreground = mode === 'foreground';
  // A single WebView2 cannot render two different DPI scales correctly, so the
  // spanning mode is only used when every monitor shares one scale factor.
  const sharedScale =
    monitors.length > 1 &&
    monitors.every((monitor) => Math.abs(monitor.scaleFactor - monitors[0].scaleFactor) < 0.001);
  const spanMode = !foreground && multiMonitorWallpaper && sharedScale;
  // Opt-in foreground overview: the same per-monitor layouts, drawn side by side
  // inside the normal window. Off by default so the single-monitor shell is
  // untouched until the user asks for it.
  const canOverview = foreground && multiMonitorWallpaper && sharedScale;
  const [showAllMonitors, setShowAllMonitors] = useState(readOverviewPreference);
  const overviewMode = canOverview && showAllMonitors;
  // In the single view the window shows whichever monitor it physically sits
  // on. This lets the user pin the view to another monitor's layout without
  // dragging the window across, so each screen can be seen at its real size.
  const [viewMonitorId, setViewMonitorId] = useState<string | null>(null);
  const canSwitchMonitor = foreground && multiMonitorWallpaper && monitors.length > 1;
  const effectiveMonitorKey = viewMonitorId ?? monitorKey;
  const activeMonitor = monitors.find((monitor) => monitor.id === effectiveMonitorKey);
  const activeMonitorLabel = activeMonitor
    ? monitorDisplayName(activeMonitor, monitors.indexOf(activeMonitor))
    : layoutTargetLabel;
  // Moving the window to another screen means "show me this screen", so an
  // explicit pin only lasts until the window itself moves.
  useEffect(() => {
    setViewMonitorId(null);
  }, [monitorKey]);
  // The no-topbar shell state also hides module headers via workspace CSS.
  // A double-click anywhere in wallpaper mode still returns to the foreground.
  const showTopbar = foreground || !hideTopbarInWallpaper;
  const { layout, loaded, move, resize, addWidget, removeWidget, presentIds } =
    useModuleLayout(definitions, spanMode || overviewMode ? undefined : effectiveMonitorKey);
  const { blur, setBlur } = useBlur();
  const [isEditing, setIsEditing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const updateAvailable = update?.updateAvailable ?? false;
  const [previewingBlur, setPreviewingBlur] = useState(false);

  // Blur persists as a wallpaper-only look. As the wallpaper it softens the
  // whole app content, topbar included, so the modules read as a frosted layer
  // over the desktop. While the slider popover is open we also preview the blur
  // live in foreground, but only on the workspace — leaving the topbar (and the
  // slider itself) crisp so you never lose the control you're dragging.
  const blurred = blur > DEFAULT_BLUR;
  const blurFilter = `blur(${blur}px)`;
  const topbarStyle = !foreground && blurred ? { filter: blurFilter } : undefined;
  const workspaceStyle =
    (!foreground || previewingBlur) && blurred ? { filter: blurFilter } : undefined;

  const items: ModuleGridItem[] = layout
    .filter(
      (entry) => modules[entry.id] !== undefined && getWidgetDefinition(entry.id, definitions) !== undefined
    )
    .map((entry) => ({
      id: entry.id,
      rect: { x: entry.x, y: entry.y, w: entry.w, h: entry.h },
      content: modules[entry.id]
    }));

  return (
    <div
      data-testid="desktop-root"
      onDoubleClickCapture={foreground ? undefined : onWallpaperDoubleClick}
      className={`app-shell${showTopbar ? '' : ' app-shell--no-topbar'}${!foreground && hideModuleBackgroundInWallpaper ? ' app-shell--transparent-modules' : ''}`}
    >
      <WallpaperLayer />
      {showTopbar ? (
      <header className="topbar" style={topbarStyle}>
        <div className="date-copy">
          <strong>{dateText}</strong>
          <p>{summary}</p>
        </div>
        <div className="top-actions">
          {foreground && isEditing && activeMonitorLabel && !overviewMode ? (
            <span className="layout-target" title={activeMonitorLabel}>
              {t('shell.layoutForMonitor', { name: activeMonitorLabel })}
            </span>
          ) : null}
          {foreground ? (
            <Tip content={t('commandPalette.openHint')}>
              <button type="button" className="btn btn-icon topbar-search" aria-label={t('commandPalette.open')} onClick={onOpenSearch}>
                <Search aria-hidden="true" />
                <kbd className="topbar-search__kbd" aria-hidden="true">Ctrl K</kbd>
              </button>
            </Tip>
          ) : null}
          {foreground ? (
            <Tip content={t('about.open')}>
              <button type="button" className="btn btn-icon about-button" aria-label={t('about.open')} onClick={() => setAboutOpen(true)}>
                <img src="/logo.png" alt="" className="about-button__logo" aria-hidden="true" />
                {updateAvailable ? <span className="about-button__dot" aria-hidden="true" /> : null}
              </button>
            </Tip>
          ) : null}
          {foreground ? (
            <BlurControl blur={blur} onChange={setBlur} onOpenChange={setPreviewingBlur} tipContent={t('blur.adjust')} />
          ) : null}
          {foreground && isEditing && !overviewMode ? (
            <Tip content={t('shell.addModule')}>
              <button type="button" className="btn" aria-label={t('shell.addModule')} disabled={!loaded} onClick={() => setPickerOpen(true)}>
                <Plus aria-hidden="true" />
                {t('shell.addModule')}
              </button>
            </Tip>
          ) : null}
          {canSwitchMonitor && !overviewMode ? (
            <div className="monitor-switch" role="group" aria-label={t('shell.viewMonitor')}>
              {monitors.map((monitor, index) => {
                const active = monitor.id === effectiveMonitorKey;
                const name = monitorDisplayName(monitor, index);
                return (
                  <button
                    key={monitor.id}
                    type="button"
                    className={`monitor-switch__item${active ? ' is-active' : ''}`}
                    aria-pressed={active}
                    title={name}
                    onClick={() => setViewMonitorId(monitor.id)}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
          ) : null}
          {canOverview ? (
            <Tip content={showAllMonitors ? t('shell.hideAllMonitors') : t('shell.showAllMonitors')}>
              <button
                type="button"
                className={`btn btn-icon${showAllMonitors ? ' is-active' : ''}`}
                aria-label={showAllMonitors ? t('shell.hideAllMonitors') : t('shell.showAllMonitors')}
                aria-pressed={showAllMonitors}
                onClick={() =>
                  setShowAllMonitors((current) => {
                    writeOverviewPreference(!current);
                    return !current;
                  })
                }
              >
                <Mosaic aria-hidden="true" />
              </button>
            </Tip>
          ) : null}
          {foreground ? (
            <Tip content={isEditing ? t('shell.finishEditing') : t('shell.editLayout')}>
              <button type="button" data-guide="edit-layout" className={`btn btn-icon${isEditing ? ' is-active' : ''}`} disabled={!loaded} aria-label={isEditing ? t('shell.finishEditing') : t('shell.editLayout')} aria-pressed={isEditing} onClick={() => setIsEditing((current) => !current)}>
                {isEditing ? <Check aria-hidden="true" /> : <LayoutGrid aria-hidden="true" />}
              </button>
            </Tip>
          ) : null}
          {foreground ? (
            <Tip content={t('shell.openSettings')}>
              <button type="button" data-guide="settings" className="btn btn-icon" aria-label={t('shell.openSettings')} onClick={onOpenSettings}>
                <Settings aria-hidden="true" />
              </button>
            </Tip>
          ) : null}
          {foreground ? (
            <Tip content={t('shell.setWallpaper')} align="end">
              <button type="button" data-guide="wallpaper" className="btn btn-icon btn-primary" aria-label={t('shell.setWallpaper')} disabled={isModeSwitching} onClick={onSetWallpaper}>
                <MonitorDown aria-hidden="true" />
              </button>
            </Tip>
          ) : null}
        </div>
      </header>
      ) : null}
      {overviewMode ? (
        <MonitorOverview
          monitors={monitors}
          modules={modules}
          definitions={definitions}
          editing={isEditing}
        />
      ) : spanMode ? (
        <WallpaperSpan
          monitors={monitors}
          modules={modules}
          definitions={definitions}
          style={workspaceStyle}
        />
      ) : (
        <main className="workspace" data-guide="workspace" aria-busy={!loaded} style={workspaceStyle}>
          {!loaded || items.length === 0 ? <WelcomeSticker loading={!loaded} /> : <ModuleGrid
            items={items}
            editing={foreground && isEditing}
            definitions={definitions}
            onMove={move}
            onResize={resize}
            onRemove={removeWidget}
            configurations={configurations}
          />}
        </main>
      )}
      {overlay}

      {foreground && pickerOpen && !overviewMode ? (
        <TemplatePickerDialog
          presentIds={presentIds}
          onClose={() => setPickerOpen(false)}
          onAdd={(id) => addWidget(id)}
          onRemove={(id) => removeWidget(id)}
        />
      ) : null}

      {foreground && aboutOpen ? (
        <AboutDialog update={update} onClose={() => setAboutOpen(false)} />
      ) : null}
    </div>
  );
}
