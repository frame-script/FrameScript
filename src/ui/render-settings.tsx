import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { PROJECT_SETTINGS } from "../../project/project";
import { PROJECT } from "../../project/project";
import { StudioStateContext } from "../lib/studio-state";
import { WithCurrentFrame } from "../lib/frame";
import { useTimelineClips } from "../lib/timeline";
import { Store } from "../util/state";
import { useAudioSegments } from "../lib/audio-plan";

const presets = ["medium", "slow", "fast"];
const encodeOptions = [
  { value: "H264", label: "H264 (software)" },
  { value: "H265", label: "H265 (software)" },
];

const containerStyle: CSSProperties = {
  padding: 20,
  background: "#0b1221",
  color: "#e5e7eb",
  fontFamily: "Inter, 'Segoe UI', system-ui, -apple-system, sans-serif",
  minHeight: "100vh",
  boxSizing: "border-box",
};

const fieldStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const inputStyle: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #1f2a3c",
  background: "#0f172a",
  color: "#e5e7eb",
};

export const RenderSettingsPage = () => {
  const [width, setWidth] = useState(PROJECT_SETTINGS.width ?? 1920);
  const [height, setHeight] = useState(PROJECT_SETTINGS.height ?? 1080);
  const [fps, setFps] = useState(PROJECT_SETTINGS.fps ?? 60);
  const [frames, setFrames] = useState(Math.round((PROJECT_SETTINGS.fps ?? 60) * 5));
  const [workers, setWorkers] = useState(() => {
    if (typeof navigator !== "undefined" && navigator.hardwareConcurrency) {
      return Math.max(1, navigator.hardwareConcurrency / 2);
    }
    return 2;
  });
  const [encode, setEncode] = useState<"H264" | "H265">("H264");
  const [preset, setPreset] = useState("medium");
  const [cacheGiB, setCacheGiB] = useState(4);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [platformLabel, setPlatformLabel] = useState("(detecting)");
  const [platformBinPath, setPlatformBinPath] = useState<string | null>(null);
  const [isDevMode, setIsDevMode] = useState(false);
  const audioSegments = useAudioSegments();

  const commandPreview = useMemo(() => {
    return `${width}:${height}:${fps}:${frames}:${workers}:${encode}:${preset}`;
  }, [width, height, fps, frames, workers, encode, preset]);

  const commandLineText = useMemo(() => {
    if (isDevMode) {
      return `render/ (cargo run) -- ${commandPreview}`;
    }
    if (!platformBinPath) {
      return `bin/${platformLabel}/render ${commandPreview}`;
    }
    const normalized = platformBinPath.replace(/\\/g, "/");
    const marker = "/frame-script/";
    const idx = normalized.lastIndexOf(marker);
    const displayPath =
      idx >= 0 ? `frame-script/${normalized.slice(idx + marker.length)}` : platformBinPath;
    return `${displayPath} ${commandPreview}`;
  }, [commandPreview, platformBinPath, platformLabel, isDevMode]);

  useEffect(() => {
    const loadPlatform = async () => {
      if (!window.renderAPI?.getPlatform) {
        setPlatformLabel("(unknown)");
        return;
      }
      try {
        const info = await window.renderAPI.getPlatform();
        setPlatformLabel(info.platform || "(unknown)");
        setPlatformBinPath(info.binPath || null);
        setIsDevMode(Boolean(info.isDev));
      } catch (_error) {
        setPlatformLabel("(unknown)");
      }
    };
    void loadPlatform();
  }, []);

  const handleDurationUpdate = useCallback(
    (value: number) => {
      if (value > 0) {
        setFrames(value);
      }
    },
    [setFrames],
  );

  const startRender = async () => {
    if (!window.renderAPI) {
      setStatus("Render API is unavailable (preload not loaded).");
      return;
    }

    setBusy(true);
    setStatus(null);
    try {
      try {
        await fetch("http://127.0.0.1:3000/reset", {
          method: "POST",
        });
      } catch (_error) {
        // ignore; still try to start render
      }
      try {
        await fetch("http://127.0.0.1:3000/render_audio_plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fps: Number(fps),
            segments: audioSegments,
          }),
        });
      } catch (_error) {
        // ignore; still try to start render
      }
      try {
        await fetch("http://127.0.0.1:3000/set_cache_size", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ gib: Number(cacheGiB) }),
        });
      } catch (_error) {
        // ignore; still try to start render
      }
      try {
        await fetch("http://127.0.0.1:3000/render_progress", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ completed: 0, total: Number(frames) }),
        });
      } catch (_error) {
        // ignore
      }
      const result = await window.renderAPI.startRender({
        width: Number(width),
        height: Number(height),
        fps: Number(fps),
        totalFrames: Number(frames),
        workers: Number(workers),
        encode,
        preset,
      });
      void window.renderAPI?.openProgress();
      window.close();
      setStatus(`Spawned: ${result.cmd}${result.pid ? ` (pid=${result.pid})` : ""}`);
    } catch (error: unknown) {
      console.error(error);
      if (error instanceof Error) {
        setStatus(error.message);
      } else {
        setStatus("Failed to start render process.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={containerStyle}>
      <HiddenTimelineDurationProbe onDuration={handleDurationUpdate} />
      <h1 style={{ margin: "0 0 12px", fontSize: 18 }}>Render Settings</h1>
      <p style={{ margin: "0 0 16px", color: "#94a3b8", fontSize: 13 }}>
        {`Assemble arguments passed to bin/${platformLabel}/render.`}
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        <div style={fieldStyle}>
          <label style={{ fontSize: 12, color: "#cbd5e1" }}>Width (px)</label>
          <input
            type="number"
            min={1}
            value={width}
            onChange={(e) => setWidth(Number(e.target.value))}
            style={inputStyle}
          />
        </div>
        <div style={fieldStyle}>
          <label style={{ fontSize: 12, color: "#cbd5e1" }}>Height (px)</label>
          <input
            type="number"
            min={1}
            value={height}
            onChange={(e) => setHeight(Number(e.target.value))}
            style={inputStyle}
          />
        </div>
        <div style={fieldStyle}>
          <label style={{ fontSize: 12, color: "#cbd5e1" }}>FPS</label>
          <input
            type="number"
            min={1}
            value={fps}
            onChange={(e) => setFps(Number(e.target.value))}
            style={inputStyle}
          />
        </div>
        <div style={fieldStyle}>
          <label style={{ fontSize: 12, color: "#cbd5e1" }}>Total frames</label>
          <input
            type="number"
            min={1}
            value={frames}
            onChange={(e) => setFrames(Number(e.target.value))}
            style={inputStyle}
          />
        </div>
        <div style={fieldStyle}>
          <label style={{ fontSize: 12, color: "#cbd5e1" }}>Workers</label>
          <input
            type="number"
            min={1}
            value={workers}
            onChange={(e) => setWorkers(Number(e.target.value))}
            style={inputStyle}
          />
        </div>
        <div style={fieldStyle}>
          <label style={{ fontSize: 12, color: "#cbd5e1" }}>Preset</label>
          <select value={preset} onChange={(e) => setPreset(e.target.value)} style={{ ...inputStyle, padding: "10px 10px" }}>
            {presets.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div style={fieldStyle}>
          <label style={{ fontSize: 12, color: "#cbd5e1" }}>Cache size (GiB)</label>
          <input
            type="number"
            min={1}
            max={128}
            value={cacheGiB}
            onChange={(e) => setCacheGiB(Number(e.target.value))}
            style={inputStyle}
          />
        </div>
      </div>

      <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {encodeOptions.map((option) => (
            <label
              key={option.value}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid #1f2a3c",
                background: encode === option.value ? "linear-gradient(90deg, #1f2937, #0f172a)" : "#0f172a",
                cursor: "pointer",
                userSelect: "none",
              }}
            >
              <input
                type="radio"
                value={option.value}
                checked={encode === option.value}
                onChange={() => setEncode(option.value as "H264" | "H265")}
                style={{ accentColor: "#5bd5ff" }}
              />
              {option.label}
            </label>
          ))}
        </div>

        <div
          style={{
            fontSize: 12,
            color: "#a5b4fc",
            background: "#111827",
            border: "1px solid #1f2a3c",
            borderRadius: 8,
            padding: "10px 12px",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
          }}
        >
          {commandLineText}
        </div>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
          <button
            type="button"
            onClick={() => window.close()}
            style={{
              padding: "10px 14px",
              borderRadius: 8,
              background: "#1f2937",
              color: "#e5e7eb",
              border: "1px solid #334155",
              cursor: "pointer",
            }}
          >
            Close
          </button>
          <button
            type="button"
            onClick={startRender}
            disabled={busy}
            style={{
              padding: "10px 16px",
              borderRadius: 8,
              background: busy ? "#1d4ed8" : "#2563eb",
              color: "#f8fafc",
              border: "1px solid #1d4ed8",
              cursor: busy ? "wait" : "pointer",
              minWidth: 120,
              fontWeight: 600,
            }}
          >
            {busy ? "Starting..." : "Start render!"}
          </button>
        </div>

        {status ? (
          <div
            style={{
              marginTop: 4,
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid #1f2a3c",
              background: "#0f172a",
              color: "#cbd5e1",
              fontSize: 12,
            }}
          >
            {status}
          </div>
        ) : null}
      </div>
    </div>
  );
};

const HiddenTimelineDurationProbe = ({ onDuration }: { onDuration: (frames: number) => void }) => {
  const clips = useTimelineClips();
  const lastSent = useRef(0);

  useEffect(() => {
    const maxEnd = clips.reduce((max, clip) => Math.max(max, clip.end + 1), 0);
    if (maxEnd > 0 && maxEnd !== lastSent.current) {
      lastSent.current = maxEnd;
      onDuration(maxEnd);
    }
  }, [clips, onDuration]);

  const dummyStoreRef = useRef(new Store(false));
  const setIsPlaying = useCallback((flag: boolean) => {
    dummyStoreRef.current.set(flag);
  }, []);

  return (
    <StudioStateContext.Provider
      value={{
        isPlaying: false,
        setIsPlaying,
        isPlayingStore: dummyStoreRef.current,
        isRender: false,
      }}
    >
      <WithCurrentFrame>
        <div style={{ display: "none" }}>
          <PROJECT />
        </div>
      </WithCurrentFrame>
    </StudioStateContext.Provider>
  );
};
