import { useState } from "react";
import { ClipVisibilityContent } from "./clip-visibility";
import { FileExplorerPanel } from "./file-explorer";

type LeftPanelTab = "explorer" | "clips";

export const LeftPanelTabs = () => {
  const [activeTab, setActiveTab] = useState<LeftPanelTab>("explorer");

  const tabButton = (tab: LeftPanelTab, label: string) => {
    const isActive = activeTab === tab;
    return (
      <button
        type="button"
        onClick={() => setActiveTab(tab)}
        style={{
          flex: 1,
          padding: "6px 10px",
          borderRadius: 6,
          border: "1px solid #1f2a3c",
          background: isActive ? "#1f2937" : "#0f172a",
          color: isActive ? "#e2e8f0" : "#94a3b8",
          cursor: "pointer",
          fontSize: 12,
          fontWeight: 600,
        }}
      >
        {label}
      </button>
    );
  };

  return (
    <div
      style={{
        width: "100%",
        minWidth: 0,
        height: "100%",
        padding: 12,
        borderRadius: 8,
        border: "1px solid #1f2a3c",
        background: "#0b1221",
        color: "#e5e7eb",
        boxShadow: "0 8px 20px rgba(0,0,0,0.25)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        boxSizing: "border-box",
        minHeight: 0,
        position: "relative",
      }}
    >
      <div style={{ display: "flex", gap: 8 }}>
        {tabButton("explorer", "Explorer")}
        {tabButton("clips", "Clips")}
      </div>
      <div style={{ flex: 1, minHeight: 0, width: "100%", minWidth: 0 }}>
        <div
          style={{
            display: activeTab === "explorer" ? "flex" : "none",
            height: "100%",
            width: "100%",
            minWidth: 0,
            flex: 1,
          }}
        >
          <FileExplorerPanel />
        </div>
        <div
          style={{
            display: activeTab === "clips" ? "flex" : "none",
            height: "100%",
            width: "100%",
            minWidth: 0,
            flex: 1,
          }}
        >
          <ClipVisibilityContent />
        </div>
      </div>
    </div>
  );
};
