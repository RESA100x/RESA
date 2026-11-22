import { useEffect, useState } from 'react';
import type { UpdateInfo } from '../data/nowly-repository';
import { useNowlyRepository } from '../data/RepositoryContext';

// How often a long-running window re-asks GitHub. The first check happens on
// launch; without this a desktop app left open for days would never notice a
// release published after it started.
const RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

// Check GitHub for a newer release on launch and every few hours. The result
// feeds both the About dialog (current version + latest changelog) and the
// topbar logo badge (a red dot when a newer version exists). A failed check
// keeps the previous result (or leaves `info` null on the first failure), so
// the UI falls back to the injected build version — reaching GitHub is
// best-effort, never blocking.
export function useUpdateCheck() {
  const repository = useNowlyRepository();
  const [info, setInfo] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    const checkForUpdate = repository.checkForUpdate;
    if (!checkForUpdate) return;
    let cancelled = false;
    const run = () => {
      void checkForUpdate()
        .then((result) => {
          if (!cancelled) setInfo(result);
        })
        .catch(() => undefined);
    };
    run();
    const timer = window.setInterval(run, RECHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [repository]);

  return info;
}
