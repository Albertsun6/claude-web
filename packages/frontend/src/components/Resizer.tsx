// Vertical drag handle. Calls onChange(newWidth) while dragging.
// `side` controls direction: "left" handle widens to the right (sidebar),
// "right" handle widens to the left (right panel).

import { useCallback, useEffect, useRef } from "react";

interface ResizerProps {
  side: "left" | "right";
  initial: number;
  min?: number;
  max?: number;
  onChange: (w: number) => void;
}

export function Resizer({ side, initial, min = 200, max = 800, onChange }: ResizerProps) {
  const draggingRef = useRef(false);
  const startXRef = useRef(0);
  const startWRef = useRef(initial);

  const onMove = useCallback(
    (e: PointerEvent) => {
      if (!draggingRef.current) return;
      const dx = e.clientX - startXRef.current;
      let next = side === "left" ? startWRef.current + dx : startWRef.current - dx;
      next = Math.max(min, Math.min(max, next));
      onChange(next);
    },
    [side, min, max, onChange],
  );

  const onUp = useCallback((e: PointerEvent) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    document.body.classList.remove("resizing");
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    (e.target as Element).releasePointerCapture?.(e.pointerId);
  }, [onMove]);

  useEffect(() => () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  }, [onMove, onUp]);

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    draggingRef.current = true;
    startXRef.current = e.clientX;
    startWRef.current = initial;
    document.body.classList.add("resizing");
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div
      className={`resizer resizer-${side}`}
      onPointerDown={onDown}
      role="separator"
      aria-orientation="vertical"
    />
  );
}
