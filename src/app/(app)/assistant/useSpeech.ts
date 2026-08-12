"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

/**
 * Speech input, where the browser offers it.
 *
 * Warehouse work happens with both hands full, so dictating a question is often
 * the only practical way to ask one. The Web Speech API is Chrome and Safari
 * only, so this reports whether it is available and the interface simply omits
 * the microphone where it is not — rather than showing a button that does
 * nothing.
 */

interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  }
}

const subscribe = () => () => {};
const hasRecognition = () =>
  typeof window !== "undefined" && Boolean(window.SpeechRecognition ?? window.webkitSpeechRecognition);

export function useSpeech(onResult: (text: string) => void) {
  // Whether the browser has the API is a static fact, not state to keep in
  // sync. Reading it through useSyncExternalStore avoids a setState-in-effect
  // and gives the server render a definite `false` rather than a flash.
  const supported = useSyncExternalStore(subscribe, hasRecognition, () => false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  // Kept in a ref so the recognition object is built once rather than being
  // torn down every time the caller passes a new closure. Assigned in an
  // effect, not during render, which is not allowed.
  const resultRef = useRef(onResult);

  useEffect(() => {
    resultRef.current = onResult;
  }, [onResult]);

  useEffect(() => {
    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Recognition) return;

    const recognition = new Recognition();
    // Ghanaian English, so numbers and place names are recognised closer to how
    // they are actually said.
    recognition.lang = "en-GH";
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onresult = (event) => {
      const text = event.results?.[0]?.[0]?.transcript;
      if (text) resultRef.current(text);
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);

    recognitionRef.current = recognition;
    return () => recognition.stop();
  }, []);

  const toggle = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition) return;

    if (listening) {
      recognition.stop();
      setListening(false);
      return;
    }
    try {
      recognition.start();
      setListening(true);
    } catch {
      // Already running, or permission refused. Either way, not listening.
      setListening(false);
    }
  }, [listening]);

  return { supported, listening, toggle };
}
