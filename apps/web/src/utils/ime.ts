/**
 * IME-safe Enter detection.
 *
 * With Chinese, Japanese, and Korean input methods the first Enter press
 * confirms the highlighted candidate. Treating that keystroke as "submit"
 * sends half-finished text, so submission has to wait until composition ends.
 *
 * Three signals are checked because no single one covers every browser:
 *   - nativeEvent.isComposing — the standard flag (Chrome, Firefox, Safari 16+)
 *   - keyCode === 229 — what older IMEs report while composing
 *   - an explicit composing flag tracked by the caller, for browsers that
 *     clear isComposing before the keydown fires
 */
import { useRef, useCallback } from 'react';
import type { KeyboardEvent, CompositionEvent } from 'react';

/** True when this Enter keypress belongs to IME candidate selection. */
export function isComposingEnter(
  e: KeyboardEvent<HTMLElement>,
  composingFlag = false,
): boolean {
  const native = e.nativeEvent as KeyboardEvent<HTMLElement>['nativeEvent'] & {
    isComposing?: boolean;
  };
  return Boolean(native.isComposing) || e.keyCode === 229 || composingFlag;
}

/**
 * Wires up composition tracking plus an IME-safe Enter handler.
 *
 * Usage:
 *   const enter = useEnterSubmit(runEdit);
 *   <input {...enter} />
 */
export function useEnterSubmit(onSubmit: () => void) {
  const composing = useRef(false);

  const onCompositionStart = useCallback(() => {
    composing.current = true;
  }, []);

  const onCompositionEnd = useCallback(() => {
    // Chrome fires compositionend before the Enter keydown; defer clearing so
    // that keydown still sees the composing state and skips submitting.
    setTimeout(() => { composing.current = false; }, 0);
  }, []);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      if (e.key !== 'Enter') return;
      if (isComposingEnter(e, composing.current)) return;
      e.preventDefault();
      onSubmit();
    },
    [onSubmit],
  );

  return { onKeyDown, onCompositionStart, onCompositionEnd };
}

export type { CompositionEvent };
