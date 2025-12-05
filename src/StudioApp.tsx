import { PROJECT } from "../project/project";
import { useCurrentFrame, useSetCurrentFrame, WithCurrentFrame } from "./lib/frame"

const SeekBar: React.FC = () => {
  const currentFrame = useCurrentFrame();
  const setCurrentFrame = useSetCurrentFrame();

  // 仮の最大フレーム数（本当は PROJECT のメタデータから持ってくるのが理想）
  const maxFrame = 300;

  return (
    <div style={{ margin: "16px 0" }}>
      <input
        type="range"
        min={0}
        max={maxFrame}
        value={currentFrame}
        onChange={(e) => setCurrentFrame(Number(e.target.value))}
        style={{ width: 640 }}
      />
      <div style={{ color: "#aaa", marginTop: 4 }}>
        frame: {currentFrame} / {maxFrame}
      </div>
    </div>
  );
};

export const StudioApp = () => {
  return (
    <WithCurrentFrame>
      <div style={{ padding: 16 }}>
        <h1>FrameScript Studio</h1>
        <div
          style={{
            width: 640,
            height: 360,
            border: "1px solid #444",
            borderRadius: 1,
            overflow: "hidden",
            backgroundColor: "#000",
          }}
        >
          <PROJECT />
        </div>
        <SeekBar />
      </div>
    </WithCurrentFrame>
  );
};
