import { useCallback, useEffect, useRef, useState } from "react";
import { PROJECT, PROJECT_SETTINGS } from "../project/project";
import { WithCurrentFrame } from "./lib/frame"
import { TimelineUI } from "./ui/timeline";
import { ClipVisibilityPanel } from "./ui/clip-visibility";
import { Store } from "./util/state";
import { StudioStateContext } from "./lib/studio-state"

// Back-compat re-exports (avoid HMR issues if some modules still import these from StudioApp).
export { StudioStateContext, useIsPlaying, useIsPlayingStore, useIsRender, useSetIsPlaying } from "./lib/studio-state"

export const StudioApp = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [verticalRatio, setVerticalRatio] = useState(0.6); // top area height ratio
  const [horizontalRatio, setHorizontalRatio] = useState(0.3); // clips width ratio within top area
  const projectWidth = PROJECT_SETTINGS.width || 1920
  const projectHeight = PROJECT_SETTINGS.height || 1080
  const previewAspect = `${projectWidth} / ${projectHeight}`
  const previewAspectValue = projectHeight / projectWidth
  const previewMinWidth = 320;
  const previewMinHeight = previewMinWidth * previewAspectValue;
  const timelineMinHeight = 200;
  const [previewViewport, setPreviewViewport] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const hasPreviewViewport = previewViewport.width > 0 && previewViewport.height > 0;

  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

  const onVerticalDrag = useCallback((clientY: number) => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();

    const minTop = previewMinHeight;
    const minBottom = timelineMinHeight;
    const rawRatio = (clientY - rect.top) / rect.height;
    const ratio = clamp(rawRatio, minTop / rect.height, 1 - minBottom / rect.height);
    setVerticalRatio(ratio);
  }, [previewMinHeight, timelineMinHeight]);

  const onHorizontalDrag = useCallback((clientX: number) => {
    const top = topRef.current;
    if (!top) return;
    const rect = top.getBoundingClientRect();

    const minLeftPx = 220;
    const minRightPx = previewMinWidth;
    const maxLeft = rect.width - minRightPx;
    const nextWidth = clamp(clientX - rect.left, minLeftPx, maxLeft);
    const ratio = clamp(nextWidth / rect.width, 0, 1);
    setHorizontalRatio(ratio);
  }, [previewMinWidth]);

  const startVerticalDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const move = (e: PointerEvent) => onVerticalDrag(e.clientY);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }, [onVerticalDrag]);

  const startHorizontalDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const move = (e: PointerEvent) => onHorizontalDrag(e.clientX);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }, [onHorizontalDrag]);

  useEffect(() => {
    const target = previewRef.current;
    if (!target) return;

    const update = (width: number, height: number) => {
      setPreviewViewport({ width, height });
    }

    update(target.clientWidth, target.clientHeight)

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        update(width, height)
      }
    })
    observer.observe(target);
    return () => observer.disconnect();
  }, [previewAspectValue]);

  const previewScale = useCallback(() => {
    const vw = previewViewport.width
    const vh = previewViewport.height
    if (vw <= 0 || vh <= 0) return 0
    const sx = vw / projectWidth
    const sy = vh / projectHeight
    return Math.max(0.01, Math.min(sx, sy))
  }, [previewViewport.height, previewViewport.width, projectHeight, projectWidth])

  const scale = previewScale()
  const scaledWidth = projectWidth * scale
  const scaledHeight = projectHeight * scale


  const isPlayingStoreRef = useRef<Store<boolean> | null>(null);
  if (isPlayingStoreRef.current == null) {
    isPlayingStoreRef.current = new Store<boolean>(false);
  }
  const isPlayingStore = isPlayingStoreRef.current;

  const [isPlaying, setIsPlayingState] = useState<boolean>(
    () => isPlayingStore.get()
  );

  useEffect(() => {
    const unsubscribe = isPlayingStore.subscribe((value) => {
      setIsPlayingState(value);
    });
    return unsubscribe;
  }, [isPlayingStore]);

  const setIsPlaying = useCallback(
    (flag: boolean) => {
      isPlayingStore.set(flag);
    },
    [isPlayingStore]
  );

  return (
    <StudioStateContext value={{ isPlaying, setIsPlaying, isPlayingStore, isRender: false }}>
      <WithCurrentFrame>
        <div style={{ padding: 16, height: "100vh", boxSizing: "border-box", minHeight: 0 }}>
          <div
            ref={containerRef}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 10,
              width: "100%",
              height: "100%",
              boxSizing: "border-box",
              minHeight: 0,
            }}
          >
            <div
              ref={topRef}
              style={{
                display: "flex",
                gap: 10,
                alignItems: "stretch",
                width: "100%",
                flexBasis: `${verticalRatio * 100}%`,
                minHeight: 240,
                maxHeight: "80%",
                minWidth: 0,
              }}
            >
              <div style={{ flexBasis: `${horizontalRatio * 100}%`, minWidth: 220 }}>
                <ClipVisibilityPanel />
              </div>
              <div
                onPointerDown={startHorizontalDrag}
                style={{
                  width: 6,
                  cursor: "col-resize",
                  background: "linear-gradient(180deg, #1f2937, #111827)",
                  borderRadius: 4,
                  flexShrink: 0,
                }}
              />
              <div style={{ flex: 1, minWidth: 320, display: "flex", alignItems: "center", justifyContent: "center", minHeight: previewMinHeight, position: "relative" }}>
                <div
                  ref={previewRef}
                  style={{
                    width: "100%",
                    height: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxSizing: "border-box",
                  }}
                >
                  <div
                    style={{
                      width: scaledWidth,
                      height: scaledHeight,
                      visibility: hasPreviewViewport ? "visible" : "hidden",
                      aspectRatio: previewAspect,
                      border: "1px solid #444",
                      borderRadius: 1,
                      overflow: "hidden",
                      backgroundColor: "#000",
                      boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
                      position: "relative",
                    }}
                  >
                    <div
                      style={{
                        width: projectWidth,
                        height: projectHeight,
                        transform: `scale(${scale})`,
                        transformOrigin: "top left",
                      }}
                    >
                      <PROJECT />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div
              onPointerDown={startVerticalDrag}
              style={{
                height: 8,
                cursor: "row-resize",
                background: "linear-gradient(90deg, #1f2937, #111827)",
                borderRadius: 4,
                flexShrink: 0,
              }}
            />

            <div style={{ flex: 1, minHeight: 160, display: "flex", minWidth: 0 }}>
              <div style={{ flex: 1, minHeight: 0 }}>
                <TimelineUI />
              </div>
            </div>
          </div>
        </div>
      </WithCurrentFrame>
    </StudioStateContext>
  );
};
