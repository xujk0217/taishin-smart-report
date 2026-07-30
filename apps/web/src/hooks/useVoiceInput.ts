/**
 * useVoiceInput — wrapper around the Web Speech API.
 *
 * Key fix: Chrome fires `onend` even with continuous=true when there's
 * a brief silence or a network hiccup. We auto-restart unless the user
 * explicitly stopped via toggle() or stop().
 */
import { useState, useRef, useCallback, useEffect } from 'react';

interface VoiceInput {
  supported: boolean;
  listening: boolean;
  transcript: string;
  interim: string;
  toggle: () => void;
  stop: () => void;
}

export function useVoiceInput(lang = 'zh-TW'): VoiceInput {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interim, setInterim] = useState('');
  const recRef = useRef<any>(null);
  // Track whether the user *wants* to be listening.
  const wantListeningRef = useRef(false);

  useEffect(() => {
    const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!SR) return;

    setSupported(true);
    const rec = new SR();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;

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
      // Chrome fires onend even with continuous=true.
      // If user still wants to listen, restart immediately.
      if (wantListeningRef.current) {
        try {
          rec.start();
        } catch {
          // If restart fails (e.g. permission revoked), give up.
          wantListeningRef.current = false;
          setListening(false);
        }
      } else {
        setListening(false);
      }
    };

    rec.onerror = (e: any) => {
      // 'no-speech' and 'aborted' are non-fatal — Chrome fires these often.
      if (e.error === 'no-speech' || e.error === 'aborted') {
        // onend will handle restart
        return;
      }
      console.warn('[Voice] Error:', e.error);
      wantListeningRef.current = false;
      setListening(false);
    };

    recRef.current = rec;

    return () => {
      wantListeningRef.current = false;
      rec.abort();
    };
  }, [lang]);

  const toggle = useCallback(() => {
    const rec = recRef.current;
    if (!rec) return;

    if (wantListeningRef.current) {
      // User wants to stop
      wantListeningRef.current = false;
      rec.stop();
      setInterim('');
    } else {
      // User wants to start
      wantListeningRef.current = true;
      setTranscript('');
      setInterim('');
      try {
        rec.start();
        setListening(true);
      } catch {
        // Already running (shouldn't happen but be safe)
        setListening(true);
      }
    }
  }, []);

  const stop = useCallback(() => {
    wantListeningRef.current = false;
    recRef.current?.stop();
    setInterim('');
  }, []);

  return { supported, listening, transcript, interim, toggle, stop };
}
