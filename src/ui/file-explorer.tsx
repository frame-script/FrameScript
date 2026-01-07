import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEditor } from "./editor-context";

type FileNode = {
  path: string;
  name: string;
  type: "file" | "directory";
  children?: FileNode[];
  isLoaded?: boolean;
};

type ContextMenuState = {
  x: number;
  y: number;
  targetPath: string;
  targetType: "file" | "directory" | "root";
};

type DialogState = {
  mode: "new-file" | "new-folder" | "rename" | "delete";
  targetPath: string;
};

const normalizePath = (input: string) => input.replace(/\\/g, "/").replace(/\/+$/, "");

const toFilePath = (filePath: string) => {
  if (!filePath.startsWith("file:")) return filePath;
  try {
    const url = new URL(filePath);
    return decodeURIComponent(url.pathname);
  } catch {
    return filePath.replace(/^file:(\/\/)?/, "");
  }
};

const joinPath = (base: string, name: string) => {
  const normalizedBase = normalizePath(base);
  const normalizedName = name.replace(/^[\\/]+/, "");
  if (!normalizedBase) return normalizedName;
  return `${normalizedBase}/${normalizedName}`;
};

const getParentPath = (input: string) => {
  const normalized = normalizePath(input);
  const idx = normalized.lastIndexOf("/");
  if (idx <= 0) return normalized;
  return normalized.slice(0, idx);
};

const getBaseName = (input: string) => {
  const normalized = normalizePath(input);
  const idx = normalized.lastIndexOf("/");
  if (idx < 0) return normalized;
  return normalized.slice(idx + 1);
};

const sortNodes = (nodes: FileNode[]) => {
  return [...nodes].sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
};

const updateNode = (
  node: FileNode,
  targetPath: string,
  updater: (node: FileNode) => FileNode,
): FileNode => {
  if (node.path === targetPath) return updater(node);
  if (!node.children || node.children.length === 0) return node;
  const nextChildren = node.children.map((child) => updateNode(child, targetPath, updater));
  return nextChildren === node.children ? node : { ...node, children: nextChildren };
};

const buildChildren = (parentPath: string, entries: { name: string; type: "file" | "directory" }[]) => {
  return sortNodes(
    entries
      .filter((entry) => !entry.name.startsWith("."))
      .map((entry) => ({
        path: joinPath(parentPath, entry.name),
        name: entry.name,
        type: entry.type,
        children: entry.type === "directory" ? [] : undefined,
        isLoaded: entry.type === "directory" ? false : undefined,
      })),
  );
};

export const FileExplorerPanel = () => {
  const { openFile, currentFile } = useEditor();
  const [rootPath, setRootPath] = useState<string | null>(null);
  const [tree, setTree] = useState<FileNode | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [dialogValue, setDialogValue] = useState("");
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refreshTimerRef = useRef<number | null>(null);
  const expandedPathsRef = useRef(expandedPaths);

  useEffect(() => {
    expandedPathsRef.current = expandedPaths;
  }, [expandedPaths]);

  const loadDirectory = useCallback(async (dirPath: string) => {
    if (!window.editorAPI?.readdir) {
      setError("Editor API is unavailable.");
      return;
    }
    setLoadingPaths((prev) => new Set(prev).add(dirPath));
    try {
      const entries = await window.editorAPI.readdir(dirPath);
      setTree((prev) => {
        const root = prev ?? {
          path: dirPath,
          name: "project",
          type: "directory",
          children: [],
          isLoaded: false,
        };
        return updateNode(root, dirPath, (node) => ({
          ...node,
          children: buildChildren(dirPath, entries),
          isLoaded: true,
        }));
      });
    } catch (loadError) {
      console.error("Failed to load directory", loadError);
      setError(loadError instanceof Error ? loadError.message : "Failed to load files");
    } finally {
      setLoadingPaths((prev) => {
        const next = new Set(prev);
        next.delete(dirPath);
        return next;
      });
    }
  }, []);

  const refreshTree = useCallback(async () => {
    if (!rootPath) return;
    const paths = Array.from(expandedPathsRef.current);
    if (!paths.includes(rootPath)) {
      paths.unshift(rootPath);
    }
    for (const path of paths) {
      await loadDirectory(path);
    }
  }, [loadDirectory, rootPath]);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current != null) return;
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      void refreshTree();
    }, 250);
  }, [refreshTree]);

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      if (!window.editorAPI?.getProjectRoot) {
        setError("Editor API is unavailable.");
        return;
      }
      try {
        const workspaceRoot = await window.editorAPI.getProjectRoot();
        if (cancelled) return;
        const projectRoot = joinPath(workspaceRoot, "project");
        setRootPath(projectRoot);
        setExpandedPaths(new Set([projectRoot]));
        setTree({
          path: projectRoot,
          name: "project",
          type: "directory",
          children: [],
          isLoaded: false,
        });
        await loadDirectory(projectRoot);
      } catch (initError) {
        console.error("Failed to initialize file explorer", initError);
        setError(initError instanceof Error ? initError.message : "Failed to load project");
      }
    };
    void init();
    return () => {
      cancelled = true;
    };
  }, [loadDirectory]);

  useEffect(() => {
    if (!window.editorAPI?.watchProject || !window.editorAPI?.onProjectFilesChanged) return undefined;
    let unsubscribe: (() => void) | undefined;
    let disposed = false;
    const start = async () => {
      try {
        await window.editorAPI?.watchProject();
      } catch (watchError) {
        console.warn("Failed to start file watcher", watchError);
      }
      if (disposed) return;
      unsubscribe = window.editorAPI?.onProjectFilesChanged?.(() => {
        scheduleRefresh();
      });
    };
    void start();
    return () => {
      disposed = true;
      if (unsubscribe) unsubscribe();
      void window.editorAPI?.unwatchProject?.();
    };
  }, [scheduleRefresh]);

  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = () => setContextMenu(null);
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setContextMenu(null);
    };
    window.addEventListener("click", handleClick);
    window.addEventListener("contextmenu", handleClick);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("click", handleClick);
      window.removeEventListener("contextmenu", handleClick);
      window.removeEventListener("keydown", handleKey);
    };
  }, [contextMenu]);

  const toggleDirectory = useCallback(
    async (node: FileNode) => {
      if (node.type !== "directory") return;
      setExpandedPaths((prev) => {
        const next = new Set(prev);
        if (next.has(node.path)) {
          next.delete(node.path);
        } else {
          next.add(node.path);
        }
        return next;
      });
      if (!node.isLoaded) {
        await loadDirectory(node.path);
      }
    },
    [loadDirectory],
  );

  const openContextMenu = useCallback((event: React.MouseEvent, node?: FileNode, isRoot = false) => {
    event.preventDefault();
    event.stopPropagation();
    if (!rootPath) return;
    const targetPath = node?.path ?? rootPath;
    const targetType = isRoot ? "root" : node?.type ?? "root";
    setContextMenu({ x: event.clientX, y: event.clientY, targetPath, targetType });
  }, [rootPath]);

  const openDialog = useCallback((mode: DialogState["mode"], targetPath: string, initialValue = "") => {
    setDialog({ mode, targetPath });
    setDialogValue(initialValue);
    setDialogError(null);
  }, []);

  const handleDialogConfirm = useCallback(async () => {
    if (!dialog || !rootPath || !window.editorAPI) return;
    const trimmed = dialogValue.trim();
    if (dialog.mode !== "delete" && !trimmed) {
      setDialogError("Name is required.");
      return;
    }
    try {
      if (dialog.mode === "new-file") {
        const newPath = joinPath(dialog.targetPath, trimmed);
        await window.editorAPI.writeFile(newPath, "");
        openFile(newPath);
      } else if (dialog.mode === "new-folder") {
        const newPath = joinPath(dialog.targetPath, trimmed);
        await window.editorAPI.mkdir(newPath);
      } else if (dialog.mode === "rename") {
        const parent = getParentPath(dialog.targetPath);
        const newPath = joinPath(parent, trimmed);
        if (newPath !== dialog.targetPath) {
          await window.editorAPI.rename(dialog.targetPath, newPath);
        }
      } else if (dialog.mode === "delete") {
        await window.editorAPI.delete(dialog.targetPath);
      }
      setDialog(null);
      scheduleRefresh();
    } catch (dialogError) {
      console.error("Failed to apply file operation", dialogError);
      setDialogError(dialogError instanceof Error ? dialogError.message : "Failed to apply change");
    }
  }, [dialog, dialogValue, openFile, rootPath, scheduleRefresh]);

  const menuItems = useMemo(() => {
    if (!contextMenu || !rootPath) return [];
    const targetPath = contextMenu.targetPath;
    const isRoot = contextMenu.targetType === "root";
    const isDirectory = contextMenu.targetType === "directory" || isRoot;
    const parentPath = isDirectory ? targetPath : getParentPath(targetPath);
    const items = [
      {
        label: "New File",
        onClick: () => openDialog("new-file", parentPath),
      },
      {
        label: "New Folder",
        onClick: () => openDialog("new-folder", parentPath),
      },
    ];
    if (!isRoot) {
      items.push(
        {
          label: "Rename",
          onClick: () => openDialog("rename", targetPath, getBaseName(targetPath)),
        },
        {
          label: "Delete",
          onClick: () => openDialog("delete", targetPath),
        },
      );
    }
    return items;
  }, [contextMenu, openDialog, rootPath]);

  const renderNodes = (nodes: FileNode[], depth: number) => {
    return nodes.map((node) => {
      const isExpanded = expandedPaths.has(node.path);
      const isLoading = loadingPaths.has(node.path);
      const hasChildren = node.type === "directory";
      const marker = hasChildren ? (isExpanded ? "-" : "+") : " ";
      const icon = node.type === "directory"
        ? (isExpanded ? "📂" : "📁")
        : "📄";
      const isActive = node.type === "file" &&
        currentFile &&
        normalizePath(toFilePath(currentFile)) === normalizePath(node.path);
      return (
        <div key={node.path}>
          <div
            data-path={node.path}
            onContextMenu={(event) => openContextMenu(event, node)}
            onClick={() => {
              if (node.type === "file") {
                openFile(node.path);
              } else {
                void toggleDirectory(node);
              }
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 8px",
              paddingLeft: 8 + depth * 12,
              borderRadius: 6,
              cursor: "pointer",
              color: node.type === "directory" ? "#e2e8f0" : "#cbd5f5",
              width: "100%",
              boxSizing: "border-box",
              userSelect: "none",
            }}
            className={`fs-explorer-row${isActive ? " is-active" : ""}`}
          >
            <span style={{ width: 14, textAlign: "center", color: "#94a3b8" }}>
              {isLoading ? "*" : marker}
            </span>
            <span style={{ flex: "1 1 auto", fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {icon} {node.name}
            </span>
          </div>
          {hasChildren && isExpanded && node.children && node.children.length > 0 ? (
            <div>{renderNodes(node.children, depth + 1)}</div>
          ) : null}
        </div>
      );
    });
  };

  const content = tree && tree.children ? renderNodes(tree.children, 0) : null;
  const rootReady = Boolean(rootPath);

  return (
    <div
      onContextMenu={(event) => {
        const target = event.target as HTMLElement | null;
        if (target?.closest("[data-path]")) return;
        openContextMenu(event, undefined, true);
      }}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        height: "100%",
        minHeight: 0,
        width: "100%",
        minWidth: 0,
        color: "#e5e7eb",
        userSelect: "none",
      }}
    >
      <style>{`
        .fs-scroll {
          scrollbar-color: #334155 #0f172a;
        }
        .fs-scroll::-webkit-scrollbar {
          width: 8px;
        }
        .fs-scroll::-webkit-scrollbar-track {
          background: #0f172a;
          border-radius: 999px;
        }
        .fs-scroll::-webkit-scrollbar-thumb {
          background: linear-gradient(180deg, #1f2937, #334155);
          border-radius: 999px;
          border: 2px solid #0f172a;
        }
        .fs-scroll::-webkit-scrollbar-thumb:hover {
          background: linear-gradient(180deg, #2b384c, #4b5563);
        }
        .fs-explorer-row {
          background: transparent;
        }
        .fs-explorer-row:hover {
          background: #0f172a;
        }
        .fs-explorer-row.is-active {
          background: #1f2937;
        }
      `}</style>
      {error ? (
        <div
          style={{
            padding: "6px 8px",
            borderRadius: 6,
            border: "1px solid #3f1d1d",
            background: "#1f0f12",
            color: "#fca5a5",
            fontSize: 11,
          }}
        >
          {error}
        </div>
      ) : null}
      <div
        className="fs-scroll"
        style={{
          flex: "1 1 auto",
          minHeight: 0,
          overflow: "auto",
          paddingRight: 2,
          width: "100%",
          minWidth: 0,
        }}
      >
        {!rootReady ? (
          <div style={{ padding: "8px 10px", fontSize: 12, color: "#94a3b8" }}>Loading...</div>
        ) : (
          <div>{content}</div>
        )}
      </div>

      {contextMenu ? (
        <div
          style={{
            position: "fixed",
            top: contextMenu.y,
            left: contextMenu.x,
            background: "#0b1221",
            border: "1px solid #1f2a3c",
            borderRadius: 8,
            boxShadow: "0 16px 30px rgba(0,0,0,0.35)",
            padding: 6,
            zIndex: 1000,
            minWidth: 160,
          }}
        >
          {menuItems.map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => {
                setContextMenu(null);
                item.onClick();
              }}
              style={{
                width: "100%",
                textAlign: "left",
                padding: "6px 10px",
                borderRadius: 6,
                border: "none",
                background: "transparent",
                color: "#e5e7eb",
                cursor: "pointer",
                fontSize: 12,
              }}
              onMouseEnter={(event) => {
                event.currentTarget.style.background = "#111827";
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.background = "transparent";
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}

      {dialog ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(2, 6, 23, 0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              width: 360,
              maxWidth: "90vw",
              background: "#0b1221",
              border: "1px solid #1f2a3c",
              borderRadius: 10,
              padding: 12,
              color: "#e2e8f0",
              boxShadow: "0 20px 40px rgba(0,0,0,0.4)",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div style={{ fontWeight: 600, fontSize: 13 }}>
              {dialog.mode === "new-file" && "Create file"}
              {dialog.mode === "new-folder" && "Create folder"}
              {dialog.mode === "rename" && "Rename"}
              {dialog.mode === "delete" && "Delete"}
            </div>
            {dialog.mode === "delete" ? (
              <div style={{ fontSize: 12, color: "#cbd5e1" }}>
                Delete "{getBaseName(dialog.targetPath)}"?
              </div>
            ) : (
              <input
                value={dialogValue}
                onChange={(event) => setDialogValue(event.target.value)}
                placeholder="Name"
                autoFocus
                style={{
                  padding: "6px 8px",
                  borderRadius: 6,
                  border: "1px solid #1f2a3c",
                  background: "#0f172a",
                  color: "#e2e8f0",
                  fontSize: 12,
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    void handleDialogConfirm();
                  }
                }}
              />
            )}
            {dialogError ? (
              <div style={{ fontSize: 11, color: "#fca5a5" }}>{dialogError}</div>
            ) : null}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                type="button"
                onClick={() => setDialog(null)}
                style={{
                  padding: "6px 10px",
                  borderRadius: 6,
                  border: "1px solid #1f2a3c",
                  background: "#111827",
                  color: "#cbd5e1",
                  cursor: "pointer",
                  fontSize: 12,
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleDialogConfirm()}
                style={{
                  padding: "6px 10px",
                  borderRadius: 6,
                  border: "1px solid #1f2a3c",
                  background: dialog.mode === "delete" ? "#7f1d1d" : "#0e639c",
                  color: "#ffffff",
                  cursor: "pointer",
                  fontSize: 12,
                }}
              >
                {dialog.mode === "delete" ? "Delete" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
