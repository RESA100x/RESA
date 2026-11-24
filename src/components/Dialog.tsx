import {
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useRef
} from 'react';
import { createPortal } from 'react-dom';

const focusableSelector =
  'button:not([disabled]),[href],input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

export type DialogProps = {
  title: string;
  ariaLabelledBy: string;
  isTopLayer?: boolean;
  // Renders the dialog as a full page inside the module area instead of a
  // floating overlay. The phone shell has no window to float over: a launcher
  // module becomes the page itself, with its own header and scrolling body.
  inline?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  restoreFocusRef?: RefObject<HTMLElement | null>;
  onRequestClose: () => void;
  headerActions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function Dialog({
  title,
  ariaLabelledBy,
  isTopLayer = true,
  inline = false,
  initialFocusRef,
  restoreFocusRef,
  onRequestClose,
  headerActions,
  footer,
  children,
  className
}: DialogProps) {
  const generatedId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = ariaLabelledBy || generatedId;

  useEffect(() => {
    if (inline) return;
    const target = initialFocusRef?.current ?? dialogRef.current?.querySelector<HTMLElement>(focusableSelector);
    target?.focus();
  }, [initialFocusRef, inline]);

  useEffect(() => {
    return () => restoreFocusRef?.current?.focus();
  }, [restoreFocusRef]);

  useEffect(() => {
    if (!isTopLayer || inline) return;

    function handleKeyDown(event: KeyboardEvent) {
      const overlays = document.querySelectorAll('.overlay');
      if (event.defaultPrevented || dialogRef.current?.parentElement !== overlays[overlays.length - 1]) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        onRequestClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? []
      ).filter((element) => !element.hasAttribute('disabled'));
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isTopLayer, inline, onRequestClose]);

  const surface = (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal={inline ? undefined : 'true'}
      aria-labelledby={titleId}
      tabIndex={-1}
      className={`good-dialog${inline ? ' good-dialog--inline' : ''}${className ? ` ${className}` : ''}`}
    >
      <header className="good-dialog__header">
        <h2 id={titleId}>{title}</h2>
        {headerActions ? <div className="good-dialog__header-actions">{headerActions}</div> : null}
      </header>
      <div className="good-dialog__body">{children}</div>
      {footer ? <footer className="good-dialog__footer">{footer}</footer> : null}
    </div>
  );

  if (inline) return surface;
  return createPortal(<div className="overlay">{surface}</div>, document.body);
}
