import { useCallback, useEffect, useRef, useState } from "react";
import { PROJECT, PROJECT_SETTINGS } from "../project/project";
import { WithCurrentFrame } from "./lib/frame"
import { TimelineUI } from "./ui/timeline";
import { ClipVisibilityPanel } from "./ui/clip-visibility";

export const StudioApp = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [verticalRatio, setVerticalRatio] = useState(0.6); // top area height ratio
  const [horizontalRatio, setHorizontalRatio] = useState(0.3); // clips width ratio within top area
  const previewAspect = PROJECT_SETTINGS.width && PROJECT_SETTINGS.height
    ? `${PROJECT_SETTINGS.width} / ${PROJECT_SETTINGS.height}`
    : "16 / 9";
  const previewAspectValue =
    PROJECT_SETTINGS.width && PROJECT_SETTINGS.height
      ? PROJECT_SETTINGS.height / PROJECT_SETTINGS.width
      : 9 / 16;
  const previewMinWidth = 320;
  const previewMinHeight = previewMinWidth * previewAspectValue;
  const timelineMinHeight = 200;
  const [previewSize, setPreviewSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

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
      const aspect = previewAspectValue;
      let w = width;
      let h = width * aspect;
      if (h > height) {
        h = height;
        w = height / aspect;
      }
      setPreviewSize({ width: w, height: h });
    };

    const rect = target.getBoundingClientRect();
    update(rect.width, rect.height);

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        update(width, height);
      }
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [previewAspectValue]);

  return (
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
                    width: previewSize.width || "100%",
                    height: previewSize.height || "100%",
                    aspectRatio: previewAspect,
                    border: "1px solid #444",
                    borderRadius: 1,
                    overflow: "hidden",
                    backgroundColor: "#000",
                    boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
                  }}
                >
                  <PROJECT />
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
  );
};
