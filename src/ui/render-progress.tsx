import { useEffect, useState } from "react";

type Progress = {
  completed: number;
  total: number;
};

export const RenderProgressPage = () => {
  const [progress, setProgress] = useState<Progress>({ completed: 0, total: 0 });
  const isCompleted = progress.total > 0 && progress.completed >= progress.total;

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch("http://127.0.0.1:3000/render_progress");
        if (res.ok) {
          const data = (await res.json()) as Progress;
          if (!cancelled) {
            setProgress(data);
          }
        }
      } catch (_error) {
        // ignore
      }
    };

    tick();
    const timer = window.setInterval(tick, 100);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const pct =
    progress.total > 0 ? Math.min(100, Math.round((progress.completed / progress.total) * 100)) : 0;

  return (
    <div
      style={{
        padding: 24,
        background: "#0b1221",
        color: "#e5e7eb",
        fontFamily: "Inter, 'Segoe UI', system-ui, -apple-system, sans-serif",
        minHeight: "100vh",
        boxSizing: "border-box",
      }}
    >
      <h1 style={{ margin: "0 0 12px", fontSize: 18 }}>Rendering...</h1>
      <p style={{ margin: "0 0 20px", color: "#cbd5e1", fontSize: 13 }}>
        Please wait until rendering is finished.
      </p>

      <div
        style={{
          background: "#111827",
          border: "1px solid #1f2937",
          borderRadius: 10,
          padding: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", marginBottom: 8, gap: 8 }}>
          <span style={{ fontSize: 12, color: "#94a3b8" }}>Progress</span>
          <span style={{ fontSize: 12, color: "#e5e7eb", marginLeft: "auto" }}>{pct}%</span>
        </div>
        <div
          style={{
            position: "relative",
            height: 16,
            borderRadius: 999,
            background: "#0f172a",
            overflow: "hidden",
            border: "1px solid #1f2937",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              bottom: 0,
              width: `${pct}%`,
              background: "linear-gradient(90deg, #2563eb, #22d3ee)",
              transition: "width 200ms ease",
            }}
          />
        </div>
        <div style={{ marginTop: 10, fontSize: 12, color: "#cbd5e1" }}>
          {isCompleted ? "Completed!" : `${progress.completed} / ${progress.total} frames`}
        </div>
      </div>
      <div style={{ marginTop: 20, display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          disabled={!isCompleted}
          onClick={() => window.close()}
          style={{
            padding: "10px 14px",
            borderRadius: 8,
            border: "1px solid #1f2937",
            background: isCompleted ? "#2563eb" : "#1f2937",
            color: isCompleted ? "#f8fafc" : "#9ca3af",
            cursor: isCompleted ? "pointer" : "not-allowed",
            minWidth: 100,
            fontWeight: 600,
            boxShadow: isCompleted ? "0 6px 14px rgba(0,0,0,0.25)" : "none",
            transition: "background 120ms ease, color 120ms ease, box-shadow 120ms ease",
          }}
        >
          Close
        </button>
      </div>
    </div>
  );
};
