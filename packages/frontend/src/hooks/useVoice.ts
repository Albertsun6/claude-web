import { useCallback, useEffect, useRef, useState } from "react";

// Minimal local typings for the Web Speech API (not in lib.dom by default).
interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}
interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}
interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}
interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
  readonly message: string;
}
interface ISpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: ((this: ISpeechRecognition, ev: Event) => unknown) | null;
  onend: ((this: ISpeechRecognition, ev: Event) => unknown) | null;
  onerror:
    | ((this: ISpeechRecognition, ev: SpeechRecognitionErrorEvent) => unknown)
    | null;
  onresult:
    | ((this: ISpeechRecognition, ev: SpeechRecognitionEvent) => unknown)
    | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechRecognitionCtor = new () => ISpeechRecognition;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  }
}

export type VoiceMode = "web-speech" | "unsupported";

export interface UseVoiceReturn {
  mode: VoiceMode;
  isRecording: boolean;
  interimTranscript: string;
  finalTranscript: string;
  start: () => void;
  stop: () => void;
  onFinal: (cb: (text: string) => void) => void;
  speak: (text: string) => void;
  cancelSpeak: () => void;
  feedAssistantChunk: (text: string) => void;
  flushAssistantBuffer: () => void;
  muted: boolean;
  setMuted: (b: boolean) => void;
}

const MUTED_KEY = "claude-web:voice-muted";
const SENTENCE_SPLIT = /([.!?。！？\n]+)/;

function detectMode(): VoiceMode {
  if (typeof window === "undefined") return "unsupported";
  const ctor =
    window.SpeechRecognition ??
    (window as unknown as { webkitSpeechRecognition?: SpeechRecognitionCtor })
      .webkitSpeechRecognition;
  if (!ctor) return "unsupported";

  // iOS standalone PWA does not allow getUserMedia for SpeechRecognition reliably.
  const isIOSStandalone =
    window.matchMedia("(display-mode: standalone)").matches &&
    /iPhone|iPad|iPod/.test(navigator.userAgent);
  if (isIOSStandalone) return "unsupported";

  return "web-speech";
}

function loadMuted(): boolean {
  try {
    return localStorage.getItem(MUTED_KEY) === "1";
  } catch {
    return false;
  }
}

function persistMuted(v: boolean): void {
  try {
    localStorage.setItem(MUTED_KEY, v ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function useVoice(lang: string = "zh-CN"): UseVoiceReturn {
  const [mode, setMode] = useState<VoiceMode>("unsupported");
  const [isRecording, setIsRecording] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [finalTranscript, setFinalTranscript] = useState("");
  const [muted, setMutedState] = useState<boolean>(false);

  const recognitionRef = useRef<ISpeechRecognition | null>(null);
  const finalCbRef = useRef<((text: string) => void) | null>(null);
  const assistantBufRef = useRef<string>("");
  const speakQueueRef = useRef<string[]>([]);
  const speakingRef = useRef<boolean>(false);
  const mutedRef = useRef<boolean>(false);

  // init
  useEffect(() => {
    setMode(detectMode());
    const m = loadMuted();
    setMutedState(m);
    mutedRef.current = m;
  }, []);

  useEffect(() => {
    mutedRef.current = muted;
    if (muted) {
      try {
        window.speechSynthesis?.cancel();
      } catch {
        /* ignore */
      }
      speakQueueRef.current = [];
      speakingRef.current = false;
    }
  }, [muted]);

  // construct recognition lazily
  const ensureRecognition = useCallback((): ISpeechRecognition | null => {
    if (recognitionRef.current) return recognitionRef.current;
    const ctor =
      window.SpeechRecognition ??
      (window as unknown as {
        webkitSpeechRecognition?: SpeechRecognitionCtor;
      }).webkitSpeechRecognition;
    if (!ctor) return null;
    const rec = new ctor();
    rec.lang = lang;
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onstart = () => {
      setIsRecording(true);
      setInterimTranscript("");
    };
    rec.onend = () => {
      setIsRecording(false);
      setInterimTranscript("");
    };
    rec.onerror = (ev) => {
      console.warn("[voice] recognition error", ev.error);
      setIsRecording(false);
      setInterimTranscript("");
    };
    rec.onresult = (ev) => {
      let interim = "";
      let finalText = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        const alt = r[0];
        if (!alt) continue;
        if (r.isFinal) finalText += alt.transcript;
        else interim += alt.transcript;
      }
      if (interim) setInterimTranscript(interim);
      if (finalText) {
        setFinalTranscript(finalText);
        setInterimTranscript("");
        finalCbRef.current?.(finalText);
      }
    };

    recognitionRef.current = rec;
    return rec;
  }, [lang]);

  const start = useCallback(() => {
    if (mode !== "web-speech") return;
    const rec = ensureRecognition();
    if (!rec) return;
    try {
      rec.start();
    } catch (err) {
      // start() throws if already started; safely ignore
      console.warn("[voice] start failed", err);
    }
  }, [mode, ensureRecognition]);

  const stop = useCallback(() => {
    const rec = recognitionRef.current;
    if (!rec) return;
    try {
      rec.stop();
    } catch {
      /* ignore */
    }
  }, []);

  const onFinal = useCallback((cb: (text: string) => void) => {
    finalCbRef.current = cb;
  }, []);

  const drainSpeakQueue = useCallback(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    if (speakingRef.current) return;
    const next = speakQueueRef.current.shift();
    if (!next) return;
    if (mutedRef.current) {
      speakQueueRef.current = [];
      return;
    }
    const u = new SpeechSynthesisUtterance(next);
    u.lang = lang;
    u.onend = () => {
      speakingRef.current = false;
      drainSpeakQueue();
    };
    u.onerror = () => {
      speakingRef.current = false;
      drainSpeakQueue();
    };
    speakingRef.current = true;
    window.speechSynthesis.speak(u);
  }, [lang]);

  const speak = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      if (mutedRef.current) return;
      if (typeof window === "undefined" || !window.speechSynthesis) return;
      speakQueueRef.current.push(trimmed);
      drainSpeakQueue();
    },
    [drainSpeakQueue],
  );

  const cancelSpeak = useCallback(() => {
    speakQueueRef.current = [];
    speakingRef.current = false;
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* ignore */
    }
  }, []);

  const feedAssistantChunk = useCallback(
    (text: string) => {
      if (!text) return;
      assistantBufRef.current += text;
      const buf = assistantBufRef.current;
      const parts = buf.split(SENTENCE_SPLIT);
      // parts: [chunk, sep, chunk, sep, ..., tail]
      let consumed = 0;
      let pending = "";
      for (let i = 0; i + 1 < parts.length; i += 2) {
        const chunk = parts[i] ?? "";
        const sep = parts[i + 1] ?? "";
        const sentence = (chunk + sep).trim();
        if (sentence) speak(sentence);
        consumed += (parts[i] ?? "").length + (parts[i + 1] ?? "").length;
      }
      pending = buf.slice(consumed);
      assistantBufRef.current = pending;
    },
    [speak],
  );

  const flushAssistantBuffer = useCallback(() => {
    const tail = assistantBufRef.current.trim();
    assistantBufRef.current = "";
    if (tail) speak(tail);
  }, [speak]);

  const setMuted = useCallback((b: boolean) => {
    persistMuted(b);
    setMutedState(b);
  }, []);

  return {
    mode,
    isRecording,
    interimTranscript,
    finalTranscript,
    start,
    stop,
    onFinal,
    speak,
    cancelSpeak,
    feedAssistantChunk,
    flushAssistantBuffer,
    muted,
    setMuted,
  };
}
