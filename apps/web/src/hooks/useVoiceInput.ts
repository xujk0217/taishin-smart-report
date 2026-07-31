/**
 * useVoiceInput — singleton wrapper around the Web Speech API.
 *
 * The browser only allows ONE active SpeechRecognition session at a time.
 * This module shares a single instance across all consumers. When one
 * component calls toggle(), any other active consumer is implicitly stopped.
 *
 * Chrome fires `onend` even with continuous=true on brief silence — we
 * auto-restart unless the user explicitly stopped.
 */
import { useState, useCallback, useEffect, useRef } from 'react';

interface VoiceInput {
  supported: boolean;
  listening: boolean;
  transcript: string;
  interim: string;
  toggle: () => void;
  stop: () => void;
}

// ─── Singleton recognition instance ──────────────────────────

let sharedRec: any = null;
let sharedSupported = false;
let sharedWantListening = false;
let sharedListeners = new Set<() => void>();

function getOrCreateRec(lang: string) {
  if (sharedRec) return sharedRec;

  const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
  if (!SR) return null;

  sharedSupported = true;
  const rec = new SR();
  rec.lang = lang;
  rec.continuous = true;
  rec.interimResults = true;
  sharedRec = rec;
  return rec;
}

function notifyAll() {
  sharedListeners.forEach(fn => fn());
}

// ─── Hook ────────────────────────────────────────────────────

export function useVoiceInput(lang = 'zh-TW'): VoiceInput {
  const [supported, setSupported] = useState(sharedSupported);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interim, setInterim] = useState('');
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const rec = getOrCreateRec(lang);
    if (!rec) return;

    setSupported(true);

    // Wire event handlers (idempotent — last one wins, which is fine for a
    // singleton since only one consumer should be "active" at a time).
    rec.onresult = (e: any) => {
      let finalText = '';
      let interimText = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) {
          finalText += r[0].transcript;
        } else {
          interimText += r[0].transcript;
        }
      }
      if (finalText) setTranscript(finalText);
      setInterim(interimText);
    };

    rec.onend = () => {
      if (sharedWantListening) {
        // Auto-restart on silence
        try {
          rec.start();
        } catch {
          sharedWantListening = false;
          setListening(false);
          notifyAll();
        }
      } else {
        setListening(false);
        notifyAll();
      }
    };

    rec.onerror = (e: any) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      console.warn('[Voice] Error:', e.error);
      sharedWantListening = false;
      setListening(false);
      notifyAll();
    };

    // Subscribe to state changes from other consumers
    const syncState = () => {
      if (mountedRef.current) {
        setListening(sharedWantListening);
      }
    };
    sharedListeners.add(syncState);

    return () => {
      mountedRef.current = false;
      sharedListeners.delete(syncState);
    };
  }, [lang]);

  const toggle = useCallback(() => {
    const rec = sharedRec;
    if (!rec) return;

    if (sharedWantListening) {
      // Stop
      sharedWantListening = false;
      rec.stop();
      setInterim('');
      setListening(false);
    } else {
      // Start
      sharedWantListening = true;
      setTranscript('');
      setInterim('');
      try {
        rec.start();
        setListening(true);
      } catch {
        // Already running — just claim it
        setListening(true);
      }
    }
    notifyAll();
  }, []);

  const stop = useCallback(() => {
    sharedWantListening = false;
    sharedRec?.stop();
    setInterim('');
    setListening(false);
    notifyAll();
  }, []);

  return { supported, listening, transcript, interim, toggle, stop };
}
