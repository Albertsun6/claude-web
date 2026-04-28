import { useCallback, useEffect, useRef, useState } from "react";
import { authFetch } from "../auth";
import { useStore } from "../store";
import { cueListening, cueSubmit, cueStop, cueError, cuePause, cueResume, cueClear } from "../audio/cues";

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

const API_BASE = (import.meta as any).env?.VITE_API_URL ?? "";
const TRANSCRIBE_URL = API_BASE + "/api/voice/transcribe";
const TTS_URL = API_BASE + "/api/voice/tts";
const SUMMARIZE_URL = API_BASE + "/api/voice/summarize";

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
  // speaking style: short Haiku summary (default) vs verbatim per-sentence
  speakStyle: SpeakStyle;
  setSpeakStyle: (s: SpeakStyle) => void;
  // conversation mode: continuous listen, "发送" trigger submits, auto-restart after each turn
  conversationMode: boolean;
  setConversationMode: (b: boolean) => void;
  /** Live transcript while in convo mode: convoBuf + interim, for showing in input. */
  liveTranscript: string;
  /** Re-arm continuous mic after assistant turn ends (called by App on session_ended). */
  resumeConversation: () => void;
  /** Slower TTS for walking / headphones. */
  slowTts: boolean;
  setSlowTts: (b: boolean) => void;
  /** Whether convo mode is currently paused by the user (via "暂停"). */
  userPaused: boolean;
  /** Manually flip pause state (UI button mirrors voice command). */
  setUserPaused: (b: boolean) => void;
  /** Wipe convoBuf — same as the "清除" voice command. */
  clearConvoBuffer: () => void;
  /** Available audio input devices (mic), populated after first permission grant. */
  inputDevices: MediaDeviceInfo[];
  /** Available audio output devices (speaker / headphones). Empty on Safari. */
  outputDevices: MediaDeviceInfo[];
  /** Re-query the device list (e.g. after plugging in headphones). */
  refreshDevices: () => Promise<void>;
  /** Whether `audio.setSinkId` is supported (Safari does not). */
  outputSelectionSupported: boolean;
}

/**
 * Strip markdown / code / table syntax so TTS doesn't read "**" as 星号星号 etc.
 * Idempotent. Applied at the speak() boundary so EVERY path (summary, summary
 * fallback, verbatim, replay) is covered.
 */
export function stripForSpeech(s: string): string {
  return s
    // fenced code blocks → just say "代码块"
    .replace(/```[\s\S]*?```/g, " 代码块。 ")
    // inline `code` → keep content
    .replace(/`([^`\n]+)`/g, "$1")
    // images ![alt](url) → "图：alt" (keep alt text)
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, (_, alt) => (alt ? `图：${alt}` : "图"))
    // links [text](url) → text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // bold/italic markers
    .replace(/\*\*\*([^*\n]+)\*\*\*/g, "$1")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/__([^_\n]+)__/g, "$1")
    .replace(/(?<![A-Za-z0-9_])\*([^*\n]+)\*(?![A-Za-z0-9_])/g, "$1")
    .replace(/(?<![A-Za-z0-9_])_([^_\n]+)_(?![A-Za-z0-9_])/g, "$1")
    // strikethrough
    .replace(/~~([^~\n]+)~~/g, "$1")
    // headings: drop leading # marks
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, "")
    // list bullets and numbered list markers
    .replace(/^[ \t]*[-*+][ \t]+/gm, "")
    .replace(/^[ \t]*\d+\.[ \t]+/gm, "")
    // blockquote
    .replace(/^[ \t]*>+[ \t]?/gm, "")
    // table separator rows (e.g. |---|---|)
    .replace(/^[ \t]*\|?[ \t]*[:\-]+[ \t]*(\|[ \t]*[:\-]+[ \t]*)+\|?[ \t]*$/gm, "")
    // remaining table pipes — drop the bars but keep cell contents joined
    .replace(/^[ \t]*\|(.+)\|[ \t]*$/gm, (_, row: string) =>
      row.split("|").map((c) => c.trim()).filter(Boolean).join("，"),
    )
    // any leftover horizontal rule
    .replace(/^[ \t]*[-*_]{3,}[ \t]*$/gm, "")
    // any HTML-ish tags (Claude rarely emits but defense)
    .replace(/<[^>]+>/g, "")
    // collapse runs of whitespace / blank lines into a single space
    .replace(/\s+/g, " ")
    .trim();
}

const MUTED_KEY = "claude-web:voice-muted";
const PREFERRED_MODE_KEY = "claude-web:voice-mode";
const SPEAK_STYLE_KEY = "claude-web:voice-speak-style";
const CONVO_KEY = "claude-web:conversation-mode";
const SLOW_TTS_KEY = "claude-web:slow-tts";

export type SpeakStyle = "summary" | "verbatim";

// Voice commands recognized at the end of a final-transcript segment.
// Order matters: longer / more specific phrases first so e.g. "继续录音"
// doesn't get caught by "录" alone in some dialect form.
type ConvoCommand = "submit" | "pause" | "resume" | "clear";
const COMMAND_PATTERNS: Array<{ cmd: ConvoCommand; re: RegExp }> = [
  { cmd: "submit", re: /(发送|发出去|发出|提交|send)$/i },
  { cmd: "resume", re: /(继续录音|继续监听|恢复录音|继续|恢复)$/i },
  { cmd: "pause",  re: /(暂停录音|暂停监听|暂停)$/i },
  { cmd: "clear",  re: /(清除|清空|重来|重新说|擦掉)$/i },
];

interface ParsedCommand {
  cmd: ConvoCommand | null;
  /** Text before the command word; should be appended to convoBuf. */
  prefix: string;
}

export function parseConvoCommand(text: string): ParsedCommand {
  // strip trailing punctuation/whitespace before matching the trigger
  const trimmed = text.trim().replace(/[\s,，。.！!？?]+$/u, "");
  for (const { cmd, re } of COMMAND_PATTERNS) {
    const m = re.exec(trimmed);
    if (m) {
      // m.index is where the command word starts within `trimmed`
      const prefix = trimmed.slice(0, m.index).replace(/[\s,，。.！!？?]+$/u, "").trim();
      return { cmd, prefix };
    }
  }
  return { cmd: null, prefix: trimmed };
}
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
  const [speakStyle, setSpeakStyleState] = useState<SpeakStyle>("summary");
  const [conversationMode, setConversationModeState] = useState<boolean>(false);
  const conversationModeRef = useRef(false);
  useEffect(() => { conversationModeRef.current = conversationMode; }, [conversationMode]);
  const [slowTts, setSlowTtsState] = useState<boolean>(false);
  const slowTtsRef = useRef(false);
  useEffect(() => { slowTtsRef.current = slowTts; }, [slowTts]);

  // Audio device selection — refs so getUserMedia / setSinkId always read latest.
  const audioInputId = useStore((s) => s.audioInputId);
  const audioOutputId = useStore((s) => s.audioOutputId);
  const audioInputIdRef = useRef(audioInputId);
  const audioOutputIdRef = useRef(audioOutputId);
  useEffect(() => { audioInputIdRef.current = audioInputId; }, [audioInputId]);
  useEffect(() => { audioOutputIdRef.current = audioOutputId; }, [audioOutputId]);
  const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const outputSelectionSupported =
    typeof window !== "undefined" &&
    typeof HTMLAudioElement !== "undefined" &&
    "setSinkId" in HTMLAudioElement.prototype;

  const refreshDevices = useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      const list = await navigator.mediaDevices.enumerateDevices();
      setInputDevices(list.filter((d) => d.kind === "audioinput"));
      setOutputDevices(list.filter((d) => d.kind === "audiooutput"));
    } catch (err) {
      console.warn("[voice] enumerateDevices failed", err);
    }
  }, []);

  useEffect(() => {
    void refreshDevices();
    const onChange = () => { void refreshDevices(); };
    navigator.mediaDevices?.addEventListener?.("devicechange", onChange);
    return () => {
      navigator.mediaDevices?.removeEventListener?.("devicechange", onChange);
    };
  }, [refreshDevices]);

  const setMode = useCallback((m: VoiceMode) => {
    try { localStorage.setItem(PREFERRED_MODE_KEY, m); } catch { /* ignore */ }
    setModeState(m);
  }, []);
  const setSpeakStyle = useCallback((s: SpeakStyle) => {
    try { localStorage.setItem(SPEAK_STYLE_KEY, s); } catch { /* ignore */ }
    setSpeakStyleState(s);
  }, []);
  // declared early; assigned inside the closure further below so we can call
  // start()/stop() safely without circular hoisting headaches
  const startRef = useRef<() => void>(() => {});
  const stopRef = useRef<() => void>(() => {});

  const setConversationMode = useCallback((b: boolean) => {
    try { localStorage.setItem(CONVO_KEY, b ? "1" : "0"); } catch { /* ignore */ }
    conversationModeRef.current = b;
    setConversationModeState(b);
    // Auto start/stop the mic so user doesn't have to tap.
    if (b) {
      // small delay so the new mode flag propagates into ensureRecognition.continuous
      setTimeout(() => startRef.current(), 0);
    } else {
      convoBufRef.current = "";
      setLiveTranscript("");
      userPausedRef.current = false;
      setUserPaused(false);
      stopRef.current();
      cueStop();
    }
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

  // remote-stt refs (push-to-talk single-shot)
  const recorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recorderChunksRef = useRef<Blob[]>([]);

  // remote-stt convo mode (VAD + continuous PCM ring buffer)
  const vadActiveRef = useRef(false);
  const vadAudioCtxRef = useRef<AudioContext | null>(null);
  const vadAnalyserRef = useRef<AnalyserNode | null>(null);
  const vadTimerRef = useRef<number | null>(null);
  const vadNoiseFloorRef = useRef(0);
  const vadCalibratedRef = useRef(false);
  const vadCalibStartRef = useRef(0);
  const vadInSpeechRef = useRef(false);
  const vadSpeechStartRef = useRef(0);
  const vadLastVoiceRef = useRef(0);
  // PCM ring buffer captured by AudioWorklet — replaces per-segment MediaRecorder.
  // Eliminates 50-200ms speech-onset loss from MediaRecorder + WebM/Opus header init.
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const pcmRingRef = useRef<Float32Array | null>(null);
  const pcmWritePosRef = useRef(0);
  const pcmTotalRef = useRef(0); // monotonic sample counter
  const pcmSampleRateRef = useRef(48000);
  const pcmSegmentStartTotalRef = useRef(0);
  const pcmLastTranscriptRef = useRef<string>(""); // for whisper context across segments

  // iOS Safari / PWA standalone autoplay unlock.
  // On these browsers, audio.play() triggered by an async event (WebSocket
  // message, fetch resolution) is silently rejected. The fix: prime a single
  // long-lived <audio> element by playing a tiny silent clip during the
  // user's FIRST gesture. After that the same element can play TTS clips
  // via src-swapping without further unlocks.
  useEffect(() => {
    if (playingAudioRef.current) return; // already exists
    const audio = new Audio();
    audio.preload = "auto";
    audio.crossOrigin = "anonymous";
    // Stash on the same ref drainAudioQueue uses; it'll src-swap below.
    playingAudioRef.current = audio;

    const unlock = () => {
      // 0.05s of silence — base64 mp3 silence is portable across iOS/Safari.
      audio.src =
        "data:audio/mp3;base64,SUQzBAAAAAABEVRYWFgAAAAtAAADY29tbWVudABCaWdTb3VuZEJhbmsuY29tIC8gTGFTb25vdGhlcXVlLm9yZwBURU5DAAAAHQAAA1N3aXRjaCBQbHVzIMKpIE5DSCBTb2Z0d2FyZQBUSVQyAAAABgAAAzIyMzUAVFNTRQAAAA8AAANMYXZmNTcuODMuMTAwAAAAAAAAAAAAAAD/80DEAAAAA0gAAAAATEFNRTMuMTAwVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//MUZAAAAAGkAAAAAAAAA0gAAAAATEFN";
      audio.muted = true;
      audio.play()
        .then(() => { audio.pause(); audio.muted = false; })
        .catch(() => { /* will be unlocked on next gesture */ });
    };
    document.addEventListener("touchstart", unlock, { once: true, passive: true });
    document.addEventListener("click", unlock, { once: true });
    document.addEventListener("keydown", unlock, { once: true });
    return () => {
      document.removeEventListener("touchstart", unlock);
      document.removeEventListener("click", unlock);
      document.removeEventListener("keydown", unlock);
    };
  }, []);

  // init
  useEffect(() => {
    const avail = detectAvailable();
    setAvailableModes(avail);
    setModeState(pickDefaultMode(avail));
    const m = loadMuted();
    setMutedState(m);
    mutedRef.current = m;
    try {
      const v = localStorage.getItem(SPEAK_STYLE_KEY);
      if (v === "verbatim" || v === "summary") setSpeakStyleState(v);
    } catch { /* ignore */ }
    try {
      const v = localStorage.getItem(CONVO_KEY);
      if (v === "1") {
        setConversationModeState(true);
        conversationModeRef.current = true;
      }
    } catch { /* ignore */ }
    try {
      const v = localStorage.getItem(SLOW_TTS_KEY);
      if (v === "1") {
        setSlowTtsState(true);
        slowTtsRef.current = true;
      }
    } catch { /* ignore */ }
  }, []);

  const setSlowTts = useCallback((b: boolean) => {
    try { localStorage.setItem(SLOW_TTS_KEY, b ? "1" : "0"); } catch { /* ignore */ }
    setSlowTtsState(b);
  }, []);

  useEffect(() => {
    mutedRef.current = muted;
    if (muted) {
      // immediately silence anything playing or queued
      generationRef.current++;
      const a = playingAudioRef.current;
      // Keep the element alive (preserves iOS unlock); just stop playback.
      if (a) { try { a.pause(); a.currentTime = 0; } catch { /* ignore */ } }
      audioQueueRef.current = [];
      playRunningRef.current = false;
      setIsSpeaking(false);
    }
  }, [muted]);

  /**
   * Process a final-transcript segment in convo mode. Recognizes the four
   * voice commands (submit / pause / resume / clear) and otherwise just
   * appends to the running buffer. `onSubmit` is invoked when a submit
   * action fires so the caller can stop its specific recognition stream.
   */
  const handleConvoSegmentRef = useRef<(text: string, onSubmit?: () => void) => void>(() => {});

  // accumulator for continuous mode — buffers final segments until trigger
  const convoBufRef = useRef<string>("");
  // when user just submitted via trigger, suppress auto-restart in onend until
  // session_ended fires and resumeAfterTurn() is called
  const conversationPausedRef = useRef<boolean>(false);
  // user-initiated pause via "暂停" — different from conversationPausedRef.
  // While true, mic is still listening but content is dropped (only "继续"/"清除" act).
  const userPausedRef = useRef<boolean>(false);
  const [userPaused, setUserPaused] = useState(false);
  // live = buffer + current interim, exposed for the input box during convo mode
  const [liveTranscript, setLiveTranscript] = useState("");

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
      // keep convoBuf across silences within the same convo session — only reset on submit
      if (!conversationModeRef.current) convoBufRef.current = "";
      if (conversationModeRef.current) setLiveTranscript(convoBufRef.current);
    };
    rec.onend = () => {
      setIsRecording(false);
      setInterimTranscript("");
      // After silence, browsers stop recognition even with continuous=true.
      // In convo mode, auto-restart unless we paused for assistant turn or user muted.
      if (
        conversationModeRef.current &&
        !mutedRef.current &&
        !conversationPausedRef.current
      ) {
        try { rec.start(); } catch { /* already starting */ }
      }
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
      // live = buffer + current interim, for displaying in the input
      if (conversationModeRef.current) {
        const live = userPausedRef.current
          ? convoBufRef.current
          : (convoBufRef.current + " " + interim).trim();
        setLiveTranscript(live);
      }
      if (finalText) {
        setFinalTranscript(finalText);
        setInterimTranscript("");

        if (conversationModeRef.current) {
          handleConvoSegmentRef.current(finalText, () => {
            // when "submit" was the action, also stop the recognition so onend's
            // auto-restart respects conversationPausedRef
            try { rec.stop(); } catch { /* ignore */ }
          });
          return;
        }

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
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(audioInputIdRef.current
            ? { deviceId: { exact: audioInputIdRef.current } }
            : {}),
          // Browser-side DSP — big quality bump on mobile + noisy environments.
          // Browsers ignore unsupported keys, so this is safe across Chrome/Safari/iOS.
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (err) {
      console.warn("[voice] mic permission denied", err);
      setInterimTranscript("");
      return;
    }
    mediaStreamRef.current = stream;
    void refreshDevices();
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
        const res = await authFetch(TRANSCRIBE_URL, {
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

  // Shared command processor for both Web Speech and VAD remote-stt paths.
  const handleConvoSegment = useCallback((text: string, onSubmit?: () => void) => {
    const { cmd, prefix } = parseConvoCommand(text);

    // Paused: only resume / clear act, everything else is dropped.
    if (userPausedRef.current) {
      if (cmd === "resume") {
        userPausedRef.current = false;
        setUserPaused(false);
        cueResume();
      } else if (cmd === "clear") {
        convoBufRef.current = "";
        setLiveTranscript("");
        cueClear();
      }
      // any other command (submit/pause/none) silently ignored while paused
      return;
    }

    // Append the prefix (text before the command word, if any) to the buffer.
    if (prefix) {
      convoBufRef.current = (convoBufRef.current + " " + prefix).trim();
      setLiveTranscript(convoBufRef.current);
    }

    if (cmd === "submit") {
      const payload = convoBufRef.current;
      convoBufRef.current = "";
      setLiveTranscript("");
      conversationPausedRef.current = true;
      if (payload) {
        cueSubmit();
        finalCbRef.current?.(payload);
      } else {
        cueError(); // said only the trigger with nothing before
      }
      onSubmit?.();
    } else if (cmd === "pause") {
      userPausedRef.current = true;
      setUserPaused(true);
      cuePause();
    } else if (cmd === "resume") {
      // already not paused — small acknowledge
      cueResume();
    } else if (cmd === "clear") {
      convoBufRef.current = "";
      setLiveTranscript("");
      cueClear();
    }
  }, []);

  useEffect(() => { handleConvoSegmentRef.current = handleConvoSegment; }, [handleConvoSegment]);

  // ----- VAD-driven remote-stt convo mode -----
  // Constants tuned for typical phone-mic, indoor speech.
  const VAD_TICK_MS = 50;
  const VAD_CALIBRATION_MS = 500;
  const VAD_SILENCE_END_MS = 1500; // bumped from 1200ms — natural pauses no longer cut sentences
  const VAD_MIN_SPEECH_MS = 250;
  const VAD_MIN_THRESHOLD = 8;     // RMS units; floor so dead-quiet rooms don't false-trigger
  const VAD_PRE_ROLL_MS = 300;     // include this much audio BEFORE VAD trigger fires
  const VAD_RING_SECONDS = 30;     // max segment we'll buffer before forced cut
  const VAD_NOISE_EWMA = 0.05;     // adaptation rate for ambient noise floor (per 50ms tick)

  // Inline AudioWorklet that pumps Float32 PCM frames back to the main thread.
  // Loaded as a Blob URL so we don't need a separate static asset.
  const PCM_PROCESSOR_CODE = `
    class PcmCapture extends AudioWorkletProcessor {
      process(inputs) {
        const ch = inputs[0] && inputs[0][0];
        if (ch && ch.length) this.port.postMessage(new Float32Array(ch));
        return true;
      }
    }
    registerProcessor('pcm-capture', PcmCapture);
  `;

  // Encode mono Float32 samples as 16-bit PCM WAV (whisper / ffmpeg native input).
  const encodeWav = useCallback((samples: Float32Array, sampleRate: number): Blob => {
    const buf = new ArrayBuffer(44 + samples.length * 2);
    const v = new DataView(buf);
    const writeStr = (off: number, s: string) => {
      for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
    };
    writeStr(0, "RIFF");
    v.setUint32(4, 36 + samples.length * 2, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);             // PCM
    v.setUint16(22, 1, true);             // mono
    v.setUint32(24, sampleRate, true);
    v.setUint32(28, sampleRate * 2, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    writeStr(36, "data");
    v.setUint32(40, samples.length * 2, true);
    let off = 44;
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]!));
      v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
    return new Blob([buf], { type: "audio/wav" });
  }, []);

  // Slice samples [fromTotal, toTotal) out of the ring buffer (handling wrap).
  const sliceRing = useCallback((fromTotal: number, toTotal: number): Float32Array | null => {
    const ring = pcmRingRef.current;
    if (!ring) return null;
    const total = pcmTotalRef.current;
    const ringLen = ring.length;
    // Clamp to what we still have
    const oldest = Math.max(0, total - ringLen);
    const from = Math.max(fromTotal, oldest);
    const to = Math.min(toTotal, total);
    const len = to - from;
    if (len <= 0) return null;
    const out = new Float32Array(len);
    // ring index of `from`: writePos points to where the NEXT sample lands,
    // so the most-recent sample is at writePos-1.
    const writePos = pcmWritePosRef.current;
    const offsetFromEnd = total - from; // how many samples back from "now"
    let readPos = (writePos - offsetFromEnd + ringLen) % ringLen;
    for (let i = 0; i < len; i++) {
      out[i] = ring[readPos]!;
      readPos = (readPos + 1) % ringLen;
    }
    return out;
  }, []);

  const processVadSegment = useCallback(async (blob: Blob) => {
    if (blob.size < 4000) return; // <4KB at 16-bit/16kHz ≈ 125ms — likely noise
    try {
      // Pass last transcript as `prev` so backend can extend whisper's --prompt
      // with context from prior segment (improves coherence in multi-utterance turns).
      const params = new URLSearchParams();
      const prev = pcmLastTranscriptRef.current;
      if (prev) params.set("prev", prev.slice(-200));
      const url = params.size ? `${TRANSCRIBE_URL}?${params.toString()}` : TRANSCRIBE_URL;
      const res = await authFetch(url, {
        method: "POST",
        headers: { "content-type": blob.type || "audio/wav" },
        body: blob,
      });
      if (!res.ok) return;
      const body: { text?: string } = await res.json();
      const text = (body.text ?? "").trim();
      if (!text) return;
      pcmLastTranscriptRef.current = text;
      handleConvoSegmentRef.current(text);
    } catch (err) {
      console.warn("[vad] transcribe failed", err);
    }
  }, []);

  const onVadSpeechStart = useCallback(() => {
    if (conversationPausedRef.current) return;
    // Anchor segment start at VAD trigger MINUS pre-roll, so the first phoneme
    // (which VAD takes 50-100ms to detect) is preserved.
    const sr = pcmSampleRateRef.current;
    const preRoll = Math.floor((sr * VAD_PRE_ROLL_MS) / 1000);
    pcmSegmentStartTotalRef.current = Math.max(0, pcmTotalRef.current - preRoll);
  }, []);

  const onVadSpeechEnd = useCallback((tooShort: boolean) => {
    if (tooShort) return; // <250ms speech — discard, no transcribe
    const samples = sliceRing(pcmSegmentStartTotalRef.current, pcmTotalRef.current);
    if (!samples || samples.length === 0) return;
    const wav = encodeWav(samples, pcmSampleRateRef.current);
    void processVadSegment(wav);
  }, [encodeWav, processVadSegment, sliceRing]);

  const stopVadConvo = useCallback(() => {
    vadActiveRef.current = false;
    if (vadTimerRef.current !== null) {
      clearInterval(vadTimerRef.current);
      vadTimerRef.current = null;
    }
    try { workletNodeRef.current?.disconnect(); } catch { /* ignore */ }
    workletNodeRef.current = null;
    pcmRingRef.current = null;
    pcmWritePosRef.current = 0;
    pcmTotalRef.current = 0;
    pcmSegmentStartTotalRef.current = 0;
    vadInSpeechRef.current = false;
    vadCalibratedRef.current = false;
    vadAnalyserRef.current = null;
    vadAudioCtxRef.current?.close().catch(() => {});
    vadAudioCtxRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
    setIsRecording(false);
  }, []);

  const startVadConvo = useCallback(async () => {
    if (vadActiveRef.current) return;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(audioInputIdRef.current
            ? { deviceId: { exact: audioInputIdRef.current } }
            : {}),
          // Browser-side DSP — big quality bump on mobile + noisy environments.
          // Browsers ignore unsupported keys, so this is safe across Chrome/Safari/iOS.
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (err) {
      console.warn("[vad] mic denied", err);
      return;
    }
    mediaStreamRef.current = stream;
    void refreshDevices();
    // @ts-expect-error webkit prefix on older Safari
    const C = window.AudioContext ?? window.webkitAudioContext;
    if (!C) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    const ctx = new C();
    const source = ctx.createMediaStreamSource(stream);

    // ---------- AudioWorklet PCM capture ----------
    // Loads our inline processor, connects it to source, allocates a 30s
    // ring buffer at the context's native sample rate (typ. 48kHz). All
    // audio flowing through here is Float32 mono — VAD reads RMS via the
    // Analyser branch (cheap), segmenting reads from the ring buffer.
    const sampleRate = ctx.sampleRate;
    pcmSampleRateRef.current = sampleRate;
    const ringSize = sampleRate * VAD_RING_SECONDS;
    pcmRingRef.current = new Float32Array(ringSize);
    pcmWritePosRef.current = 0;
    pcmTotalRef.current = 0;
    try {
      const blob = new Blob([PCM_PROCESSOR_CODE], { type: "application/javascript" });
      const moduleUrl = URL.createObjectURL(blob);
      await ctx.audioWorklet.addModule(moduleUrl);
      URL.revokeObjectURL(moduleUrl);
      const node = new AudioWorkletNode(ctx, "pcm-capture");
      node.port.onmessage = (e: MessageEvent<Float32Array>) => {
        const ring = pcmRingRef.current;
        if (!ring) return;
        const samples = e.data;
        let pos = pcmWritePosRef.current;
        for (let i = 0; i < samples.length; i++) {
          ring[pos] = samples[i]!;
          pos = (pos + 1) % ring.length;
        }
        pcmWritePosRef.current = pos;
        pcmTotalRef.current += samples.length;
      };
      source.connect(node);
      // Worklet must be in the audio graph to actually run. Connecting to a
      // muted GainNode is safer than ctx.destination (no risk of feedback).
      const sink = ctx.createGain();
      sink.gain.value = 0;
      node.connect(sink);
      sink.connect(ctx.destination);
      workletNodeRef.current = node;
    } catch (err) {
      console.warn("[vad] AudioWorklet setup failed; convo mode unavailable", err);
      stream.getTracks().forEach((t) => t.stop());
      ctx.close().catch(() => {});
      return;
    }

    // ---------- VAD branch (RMS via Analyser) ----------
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    vadAudioCtxRef.current = ctx;
    vadAnalyserRef.current = analyser;
    vadCalibratedRef.current = false;
    vadNoiseFloorRef.current = 0;
    vadCalibStartRef.current = Date.now();
    vadInSpeechRef.current = false;
    vadActiveRef.current = true;
    setIsRecording(true);
    setLiveTranscript(convoBufRef.current);
    cueListening();

    const buf = new Uint8Array(analyser.frequencyBinCount);
    vadTimerRef.current = window.setInterval(() => {
      if (!vadActiveRef.current || !vadAnalyserRef.current) return;
      vadAnalyserRef.current.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const c = buf[i]! - 128;
        sum += c * c;
      }
      const rms = Math.sqrt(sum / buf.length);
      const now = Date.now();

      // Initial fast calibration: take MAX of first 500ms as noise floor.
      // Using max (not avg) is conservative — if user starts talking during
      // calibration, the high RMS lifts the floor temporarily; the EWMA
      // below corrects it within a second of true silence.
      if (!vadCalibratedRef.current) {
        vadNoiseFloorRef.current = Math.max(vadNoiseFloorRef.current, rms);
        if (now - vadCalibStartRef.current >= VAD_CALIBRATION_MS) {
          vadCalibratedRef.current = true;
        }
        return;
      }

      const threshold = Math.max(vadNoiseFloorRef.current * 2.5, VAD_MIN_THRESHOLD);
      const isVoice = rms > threshold;

      // EWMA noise floor: update during quiet, hold during speech. This
      // self-corrects if calibration started while user was already talking.
      if (!isVoice && !vadInSpeechRef.current) {
        vadNoiseFloorRef.current =
          vadNoiseFloorRef.current * (1 - VAD_NOISE_EWMA) + rms * VAD_NOISE_EWMA;
      }

      if (isVoice) {
        vadLastVoiceRef.current = now;
        if (!vadInSpeechRef.current && !conversationPausedRef.current && !mutedRef.current) {
          vadInSpeechRef.current = true;
          vadSpeechStartRef.current = now;
          onVadSpeechStart();
        }
      } else if (vadInSpeechRef.current && now - vadLastVoiceRef.current > VAD_SILENCE_END_MS) {
        vadInSpeechRef.current = false;
        const tooShort = now - vadSpeechStartRef.current < VAD_MIN_SPEECH_MS;
        onVadSpeechEnd(tooShort);
      }
    }, VAD_TICK_MS);
  }, [onVadSpeechStart, onVadSpeechEnd, PCM_PROCESSOR_CODE]);

  const start = useCallback(() => {
    if (mode === "web-speech") {
      const rec = ensureRecognition();
      if (!rec) return;
      // In convo mode keep listening across silences.
      rec.continuous = !!conversationModeRef.current;
      conversationPausedRef.current = false;
      if (!conversationModeRef.current) {
        convoBufRef.current = "";
        setLiveTranscript("");
      }
      try {
        rec.start();
      } catch (err) {
        console.warn("[voice] start failed", err);
      }
    } else if (mode === "remote-stt") {
      conversationPausedRef.current = false;
      if (conversationModeRef.current) {
        void startVadConvo();
      } else {
        void startRemote();
      }
    }
  }, [mode, ensureRecognition, startRemote, startVadConvo]);
  useEffect(() => { startRef.current = start; }, [start]);

  const stop = useCallback(() => {
    if (mode === "web-speech") {
      // signal "user actually wants this off" so onend doesn't restart
      conversationPausedRef.current = true;
      try {
        recognitionRef.current?.stop();
      } catch {
        /* ignore */
      }
    } else if (mode === "remote-stt") {
      conversationPausedRef.current = true;
      if (vadActiveRef.current) {
        stopVadConvo();
      } else {
        stopRemote();
      }
    }
  }, [mode, stopRemote, stopVadConvo]);
  useEffect(() => { stopRef.current = stop; }, [stop]);

  const onFinal = useCallback((cb: (text: string) => void) => {
    finalCbRef.current = cb;
  }, []);

  // Fetch one sentence's mp3 (returns object URL, or null on error/cancel).
  const fetchTtsBlobUrl = useCallback(async (text: string, gen: number): Promise<string | null> => {
    try {
      const res = await authFetch(TTS_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text,
          ...(slowTtsRef.current ? { rate: "-15%" } : {}),
        }),
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
    // Reuse the (possibly user-gesture-unlocked) single audio element rather
    // than creating a new one per clip. iOS PWA otherwise re-locks per element.
    const audio = playingAudioRef.current ?? new Audio();
    if (!playingAudioRef.current) playingAudioRef.current = audio;
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
        setIsSpeaking(true);
        const cleanup = () => {
          URL.revokeObjectURL(url);
          audio.removeEventListener("ended", cleanup);
          audio.removeEventListener("error", cleanup);
          resolve();
        };
        audio.addEventListener("ended", cleanup, { once: true });
        audio.addEventListener("error", cleanup, { once: true });
        audio.src = url;
        const startPlay = () => {
          audio.play().catch((err) => { console.warn("[voice] play failed", err); cleanup(); });
        };
        const sinkId = audioOutputIdRef.current;
        const setSinkId = (audio as unknown as { setSinkId?: (id: string) => Promise<void> }).setSinkId;
        if (sinkId && typeof setSinkId === "function") {
          setSinkId.call(audio, sinkId).then(startPlay).catch((err) => {
            console.warn("[voice] setSinkId failed, falling back to default", err);
            startPlay();
          });
        } else {
          startPlay();
        }
      });
    }
    playRunningRef.current = false;
    if (audioQueueRef.current.length === 0) {
      setIsSpeaking(false);
    }
  }, []);

  const speak = useCallback((text: string) => {
    // Defense-in-depth: strip every markdown/code/table token from anything
    // headed for TTS. This is the *only* path to the audio queue, so summary,
    // summary-fallback, verbatim, replay, and short-skip all benefit.
    const cleaned = stripForSpeech(text);
    if (!cleaned) return;
    if (mutedRef.current) return;
    turnSentencesRef.current.push(cleaned);
    const gen = generationRef.current;
    audioQueueRef.current.push({ sentence: cleaned, promise: fetchTtsBlobUrl(cleaned, gen) });
    void drainAudioQueue();
  }, [fetchTtsBlobUrl, drainAudioQueue]);

  const cancelSpeak = useCallback(() => {
    generationRef.current++;
    audioQueueRef.current = [];
    const a = playingAudioRef.current;
    // Keep the long-lived element alive — nulling it would force a fresh
    // (still-locked) Audio() on the next iOS PWA playback.
    if (a) { try { a.pause(); a.currentTime = 0; } catch { /* ignore */ } }
    playRunningRef.current = false;
    setIsSpeaking(false);
  }, []);

  const speakStyleRef = useRef<SpeakStyle>("summary");
  useEffect(() => { speakStyleRef.current = speakStyle; }, [speakStyle]);

  // In summary mode we just buffer; speaking happens once at flush.
  // In verbatim mode we keep the legacy per-sentence streaming.
  const feedAssistantChunk = useCallback((text: string) => {
    if (!text) return;
    assistantBufRef.current += text;
    if (speakStyleRef.current === "summary") return;
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
    const full = assistantBufRef.current.trim();
    assistantBufRef.current = "";
    if (!full) return;
    if (mutedRef.current) return;

    if (speakStyleRef.current === "verbatim") {
      // verbatim: speak whatever sentence tail is left
      speak(full);
      const joined = turnSentencesRef.current.join(" ").trim();
      if (joined) setLastTurnText(joined);
      turnSentencesRef.current = [];
      return;
    }

    // summary mode: send full text to backend → speak the short version
    const gen = generationRef.current;
    void (async () => {
      let summary = full;
      try {
        const res = await authFetch(SUMMARIZE_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: full }),
        });
        if (gen !== generationRef.current || mutedRef.current) return;
        if (res.ok) {
          const body: { summary?: string; fallback?: boolean } = await res.json();
          if (body.summary && !body.fallback) summary = body.summary.trim();
        }
      } catch { /* fall through with full text */ }
      if (gen !== generationRef.current || mutedRef.current) return;
      speak(summary);
      setLastTurnText(summary);
      turnSentencesRef.current = [];
    })();
  }, [speak]);

  // Resume continuous listening after the assistant turn (and TTS) finishes.
  // App.tsx hooks this to session_ended via the voiceSink.
  const resumeConversation = useCallback(() => {
    if (!conversationModeRef.current || mutedRef.current) return;
    // wait for any pending speak/audio to drain before re-arming the mic
    const wait = setInterval(() => {
      if (audioQueueRef.current.length === 0 && !playingAudioRef.current) {
        clearInterval(wait);
        conversationPausedRef.current = false;
        convoBufRef.current = "";
        if (mode === "web-speech") {
          const rec = ensureRecognition();
          if (!rec) return;
          rec.continuous = true;
          try { rec.start(); } catch { /* already running */ }
        } else if (mode === "remote-stt") {
          // VAD loop may have stopped on submit (no — stays running with mediaStream alive,
          // we only stopped per-segment recorders). If the whole VAD loop was torn down,
          // restart it. If still alive, just clear the paused flag and let the next speech
          // segment fire normally.
          if (!vadActiveRef.current) void startVadConvo();
        }
      }
    }, 250);
    setTimeout(() => clearInterval(wait), 30_000);
  }, [mode, ensureRecognition, startVadConvo]);

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
    speakStyle,
    setSpeakStyle,
    conversationMode,
    setConversationMode,
    liveTranscript,
    resumeConversation,
    slowTts,
    setSlowTts,
    userPaused,
    setUserPaused: (b: boolean) => {
      userPausedRef.current = b;
      setUserPaused(b);
      if (b) cuePause(); else cueResume();
    },
    clearConvoBuffer: () => {
      convoBufRef.current = "";
      setLiveTranscript("");
      cueClear();
    },
    inputDevices,
    outputDevices,
    refreshDevices,
    outputSelectionSupported,
  };
}
