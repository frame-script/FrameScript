import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter, Route, Routes } from "react-router-dom";
import { StudioApp } from "./StudioApp";
import { RenderSettingsPage } from "./ui/render-settings";
import { RenderProgressPage } from "./ui/render-progress";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <HashRouter>
      <Routes>
        <Route path="/" element={<StudioApp />} />
        <Route path="/render-settings" element={<RenderSettingsPage />} />
        <Route path="/render-progress" element={<RenderProgressPage />} />
      </Routes>
    </HashRouter>
  </React.StrictMode>,
);
