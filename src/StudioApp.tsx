import { PROJECT } from "../project/project";
import { WithCurrentFrame } from "./lib/frame"
import { TimelineUI } from "./ui/timeline";
import { ClipVisibilityPanel } from "./ui/clip-visibility";

export const StudioApp = () => {
  return (
    <WithCurrentFrame>
      <div style={{ padding: 16 }}>
        <h1>FrameScript Studio</h1>
        <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
          <ClipVisibilityPanel />
          <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 960 }}>
            <div
              style={{
                width: 640,
                height: 360,
                border: "1px solid #444",
                borderRadius: 1,
                overflow: "hidden",
                backgroundColor: "#000",
                boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
              }}
            >
              <PROJECT />
            </div>
            <TimelineUI />
          </div>
        </div>
      </div>
    </WithCurrentFrame>
  );
};
