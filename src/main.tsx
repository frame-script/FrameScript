import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter, Route, Routes } from "react-router-dom";
import { StudioApp } from "./StudioApp";
import { RenderSettingsPage } from "./ui/render-settings";
import { RenderProgressPage } from "./ui/render-progress";

const AppShell = () => {
  React.useEffect(() => {
    const splash = document.getElementById("boot-splash");
    if (splash) splash.remove();
  }, []);

  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<StudioApp />} />
        <Route path="/render-settings" element={<RenderSettingsPage />} />
        <Route path="/render-progress" element={<RenderProgressPage />} />
      </Routes>
    </HashRouter>
  );
};

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <AppShell />,
);
