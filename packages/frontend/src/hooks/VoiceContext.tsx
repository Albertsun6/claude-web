import { createContext, useContext, type ReactNode } from "react";
import { useVoice, type UseVoiceReturn } from "./useVoice";

const VoiceContext = createContext<UseVoiceReturn | null>(null);

export function VoiceProvider({ children }: { children: ReactNode }) {
  const voice = useVoice();
  return <VoiceContext.Provider value={voice}>{children}</VoiceContext.Provider>;
}

export function useVoiceCtx(): UseVoiceReturn {
  const v = useContext(VoiceContext);
  if (!v) throw new Error("useVoiceCtx must be used within VoiceProvider");
  return v;
}
