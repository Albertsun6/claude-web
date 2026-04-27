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

export type VoiceMode = "web-speech" | "remote-stt" | "unsupported";

const API_BASE =
  (import.meta as any).env?.VITE_API_URL ??
  `http://${typeof window !== "undefined" ? window.location.hostname : "localhost"}:3030`;
const TRANSCRIBE_URL = API_BASE + "/api/voice/transcribe";
const TTS_URL = API_BASE + "/api/voice/tts";

export interface UseVoiceReturn {
  mode: VoiceMode;
  availableModes: VoiceMode[];
  setMode: (m: VoiceMode) => void;
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
  // playback state + replay
  isSpeaking: boolean;
  hasLastTurn: boolean;
  replayLastTurn: () => void;
}

const MUTED_KEY = "claude-web:voice-muted";
const PREFERRED_MODE_KEY = "claude-web:voice-mode";
const SENTENCE_SPLIT = /([.!?。！？\n]+)/;

function hasMediaRecorder(): boolean {
  return typeof window !== "undefined" &&
    typeof window.MediaRecorder !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia;
}

function detectAvailable(): VoiceMode[] {
  if (typeof window === "undefined") return [];
  const out: VoiceMode[] = [];

  const isIOSStandalone =
    window.matchMedia("(display-mode: standalone)").matches &&
    /iPhone|iPad|iPod/.test(navigator.userAgent);

  const ctor =
    window.SpeechRecognition ??
    (window as unknown as { webkitSpeechRecognition?: SpeechRecognitionCtor })
      .webkitSpeechRecognition;
  if (ctor && !isIOSStandalone) out.push("web-speech");
  if (hasMediaRecorder()) out.push("remote-stt");
  return out;
}

function pickDefaultMode(available: VoiceMode[]): VoiceMode {
  if (available.length === 0) return "unsupported";
  // user preference wins if still available
  try {
    const pref = localStorage.getItem(PREFERRED_MODE_KEY) as VoiceMode | null;
    if (pref && available.includes(pref)) return pref;
  } catch {
    /* ignore */
  }
  // default: prefer web-speech (zero latency) when available; else remote-stt
  return available[0]!;
}

function pickRecorderMimeType(): string {
  // iOS Safari supports audio/mp4; Chrome/Firefox prefer webm/opus.
  const candidates = [
    "audio/mp4",
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
  ];
  if (typeof window === "undefined" || !window.MediaRecorder) return "";
  for (const t of candidates) {
    if (window.MediaRecorder.isTypeSupported?.(t)) return t;
  }
  return "";
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
  const [availableModes, setAvailableModes] = useState<VoiceMode[]>([]);
  const [mode, setModeState] = useState<VoiceMode>("unsupported");
  const [isRecording, setIsRecording] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [finalTranscript, setFinalTranscript] = useState("");
  const [muted, setMutedState] = useState<boolean>(false);

  const setMode = useCallback((m: VoiceMode) => {
    try { localStorage.setItem(PREFERRED_MODE_KEY, m); } catch { /* ignore */ }
    setModeState(m);
  }, []);

  const recognitionRef = useRef<ISpeechRecognition | null>(null);
  const finalCbRef = useRef<((text: string) => void) | null>(null);
  const assistantBufRef = useRef<string>("");
  const mutedRef = useRef<boolean>(false);

  // playback (Edge TTS via backend → mp3 → HTMLAudioElement)
  type Pending = { sentence: string; promise: Promise<string | null> };
  const audioQueueRef = useRef<Pending[]>([]);
  const playingAudioRef = useRef<HTMLAudioElement | null>(null);
  const playRunningRef = useRef<boolean>(false);
  const turnSentencesRef = useRef<string[]>([]);
  const generationRef = useRef<number>(0); // bumped on cancel to invalidate in-flight fetches
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [lastTurnText, setLastTurnText] = useState<string>("");

  // remote-stt refs
  const recorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recorderChunksRef = useRef<Blob[]>([]);

  // init
  useEffect(() => {
    const avail = detectAvailable();
    setAvailableModes(avail);
    setModeState(pickDefaultMode(avail));
    const m = loadMuted();
    setMutedState(m);
    mutedRef.current = m;
  }, []);

  useEffect(() => {
    mutedRef.current = muted;
    if (muted) {
      // immediately silence anything playing or queued
      generationRef.current++;
      const a = playingAudioRef.current;
      if (a) { try { a.pause(); a.currentTime = 0; } catch { /* ignore */ } }
      playingAudioRef.current = null;
      audioQueueRef.current = [];
      playRunningRef.current = false;
      setIsSpeaking(false);
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

  // ----- remote-stt: MediaRecorder → backend whisper -----
  const startRemote = useCallback(async () => {
    if (recorderRef.current) return;
    setInterimTranscript("识别中…（录音）");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      console.warn("[voice] mic permission denied", err);
      setInterimTranscript("");
      return;
    }
    mediaStreamRef.current = stream;
    const mimeType = pickRecorderMimeType();
    const recorder = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream);
    recorderChunksRef.current = [];
    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) recorderChunksRef.current.push(ev.data);
    };
    recorder.onstop = async () => {
      const chunks = recorderChunksRef.current;
      recorderChunksRef.current = [];
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
      recorderRef.current = null;
      setIsRecording(false);
      const type = recorder.mimeType || "application/octet-stream";
      const blob = new Blob(chunks, { type });
      if (blob.size === 0) {
        setInterimTranscript("");
        return;
      }
      setInterimTranscript("识别中…（转写）");
      try {
        const res = await fetch(TRANSCRIBE_URL, {
          method: "POST",
          headers: { "content-type": type },
          body: blob,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body: { text?: string; error?: string } = await res.json();
        const text = (body.text ?? "").trim();
        setInterimTranscript("");
        if (text) {
          setFinalTranscript(text);
          finalCbRef.current?.(text);
        }
      } catch (err) {
        console.warn("[voice] transcribe failed", err);
        setInterimTranscript("");
      }
    };
    recorderRef.current = recorder;
    try {
      recorder.start();
      setIsRecording(true);
    } catch (err) {
      console.warn("[voice] recorder start failed", err);
      setIsRecording(false);
      stream.getTracks().forEach((t) => t.stop());
      recorderRef.current = null;
      mediaStreamRef.current = null;
      setInterimTranscript("");
    }
  }, []);

  const stopRemote = useCallback(() => {
    const r = recorderRef.current;
    if (!r) return;
    try {
      if (r.state !== "inactive") r.stop();
    } catch {
      /* ignore */
    }
  }, []);

  const start = useCallback(() => {
    if (mode === "web-speech") {
      const rec = ensureRecognition();
      if (!rec) return;
      try {
        rec.start();
      } catch (err) {
        console.warn("[voice] start failed", err);
      }
    } else if (mode === "remote-stt") {
      void startRemote();
    }
  }, [mode, ensureRecognition, startRemote]);

  const stop = useCallback(() => {
    if (mode === "web-speech") {
      try {
        recognitionRef.current?.stop();
      } catch {
        /* ignore */
      }
    } else if (mode === "remote-stt") {
      stopRemote();
    }
  }, [mode, stopRemote]);

  const onFinal = useCallback((cb: (text: string) => void) => {
    finalCbRef.current = cb;
  }, []);

  // Fetch one sentence's mp3 (returns object URL, or null on error/cancel).
  const fetchTtsBlobUrl = useCallback(async (text: string, gen: number): Promise<string | null> => {
    try {
      const res = await fetch(TTS_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) return null;
      if (gen !== generationRef.current) return null; // cancelled while in flight
      const blob = await res.blob();
      if (gen !== generationRef.current) return null;
      return URL.createObjectURL(blob);
    } catch {
      return null;
    }
  }, []);

  const drainAudioQueue = useCallback(async () => {
    if (playRunningRef.current) return;
    playRunningRef.current = true;
    while (true) {
      if (mutedRef.current) {
        audioQueueRef.current = [];
        break;
      }
      const next = audioQueueRef.current.shift();
      if (!next) break;
      const url = await next.promise;
      if (!url) continue;
      if (mutedRef.current) { URL.revokeObjectURL(url); continue; }
      await new Promise<void>((resolve) => {
        const audio = new Audio(url);
        playingAudioRef.current = audio;
        setIsSpeaking(true);
        const cleanup = () => {
          URL.revokeObjectURL(url);
          if (playingAudioRef.current === audio) playingAudioRef.current = null;
          resolve();
        };
        audio.addEventListener("ended", cleanup);
        audio.addEventListener("error", cleanup);
        audio.play().catch((err) => { console.warn("[voice] play failed", err); cleanup(); });
      });
    }
    playRunningRef.current = false;
    if (audioQueueRef.current.length === 0 && !playingAudioRef.current) {
      setIsSpeaking(false);
    }
  }, []);

  const speak = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (mutedRef.current) return;
    turnSentencesRef.current.push(trimmed);
    const gen = generationRef.current;
    audioQueueRef.current.push({ sentence: trimmed, promise: fetchTtsBlobUrl(trimmed, gen) });
    void drainAudioQueue();
  }, [fetchTtsBlobUrl, drainAudioQueue]);

  const cancelSpeak = useCallback(() => {
    generationRef.current++;
    audioQueueRef.current = [];
    const a = playingAudioRef.current;
    if (a) { try { a.pause(); a.currentTime = 0; } catch { /* ignore */ } }
    playingAudioRef.current = null;
    playRunningRef.current = false;
    setIsSpeaking(false);
  }, []);

  const feedAssistantChunk = useCallback((text: string) => {
    if (!text) return;
    assistantBufRef.current += text;
    const buf = assistantBufRef.current;
    const parts = buf.split(SENTENCE_SPLIT);
    let consumed = 0;
    for (let i = 0; i + 1 < parts.length; i += 2) {
      const chunk = parts[i] ?? "";
      const sep = parts[i + 1] ?? "";
      const sentence = (chunk + sep).trim();
      if (sentence) speak(sentence);
      consumed += (parts[i] ?? "").length + (parts[i + 1] ?? "").length;
    }
    assistantBufRef.current = buf.slice(consumed);
  }, [speak]);

  const flushAssistantBuffer = useCallback(() => {
    const tail = assistantBufRef.current.trim();
    assistantBufRef.current = "";
    if (tail) speak(tail);
    // snapshot what we just spoke for replay
    const joined = turnSentencesRef.current.join(" ").trim();
    if (joined) setLastTurnText(joined);
    turnSentencesRef.current = [];
  }, [speak]);

  const replayLastTurn = useCallback(() => {
    if (!lastTurnText) return;
    cancelSpeak();
    // brief delay to let cancellation propagate before queuing
    setTimeout(() => {
      // split the saved turn back into sentences for sequential playback
      const parts = lastTurnText.split(SENTENCE_SPLIT);
      const sentences: string[] = [];
      for (let i = 0; i + 1 < parts.length; i += 2) {
        const s = ((parts[i] ?? "") + (parts[i + 1] ?? "")).trim();
        if (s) sentences.push(s);
      }
      const tail = parts[parts.length - 1]?.trim();
      if (tail && tail.length && parts.length % 2 === 1) sentences.push(tail);
      if (sentences.length === 0) sentences.push(lastTurnText);
      for (const s of sentences) speak(s);
    }, 30);
  }, [lastTurnText, cancelSpeak, speak]);

  const setMuted = useCallback((b: boolean) => {
    persistMuted(b);
    setMutedState(b);
  }, []);

  return {
    mode,
    availableModes,
    setMode,
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
    isSpeaking,
    hasLastTurn: lastTurnText.length > 0,
    replayLastTurn,
  };
}
