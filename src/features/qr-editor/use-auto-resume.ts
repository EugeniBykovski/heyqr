import { useEffect, useEffectEvent, useRef } from "react";

/**
 * Back from Google sign-in (design 3.3): once the restored draft is complete and its scan check has passed, continue to
 * Export, exactly once. The scan check renders deferred (HEY-41), so `ready` can turn true after the draft is restored;
 * the effect re-runs on it (HEY-193: a slow branded render used to leave the person on Design).
 */
export function useAutoResume(when: { resume: boolean; signedIn: boolean; restored: boolean; ready: boolean }, go: () => void) {
  const done = useRef(false);
  const run = useEffectEvent(() => {
    if (done.current || !when.ready) return;
    done.current = true;
    go();
  });
  const { resume, signedIn, restored, ready } = when;
  useEffect(() => {
    if (resume && signedIn && restored) run();
  }, [resume, signedIn, restored, ready]);
}
