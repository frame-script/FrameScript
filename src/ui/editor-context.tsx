import { createContext, useContext, type ReactNode, useState, useCallback } from "react";

type EditorApi = {
  openFile: (filePath: string, line?: number) => void;
  jumpToLine: (line: number) => void;
  jumpToMatch: (needle: string) => void;
}

interface EditorContextValue {
  openFile: (filePath: string, line?: number) => void;
  jumpToLine: (line: number) => void;
  jumpToMatch: (needle: string) => void;
  registerEditor: (api: EditorApi) => void;
}

const EditorContext = createContext<EditorContextValue | null>(null);

export const EditorProvider = ({ children }: { children: ReactNode }) => {
  const [editorApi, setEditorApi] = useState<EditorApi | null>(null);

  const openFile = useCallback((filePath: string, line?: number) => {
    editorApi?.openFile(filePath, line);
  }, [editorApi]);

  const jumpToLine = useCallback((line: number) => {
    editorApi?.jumpToLine(line);
  }, [editorApi]);

  const jumpToMatch = useCallback((needle: string) => {
    editorApi?.jumpToMatch(needle);
  }, [editorApi]);

  const registerEditor = useCallback((api: EditorApi) => {
    setEditorApi(api);
  }, []);

  return (
    <EditorContext.Provider value={{ openFile, jumpToLine, jumpToMatch, registerEditor }}>
      {children}
    </EditorContext.Provider>
  );
};

export const useEditor = () => {
  const context = useContext(EditorContext);
  if (!context) {
    throw new Error("useEditor must be used within EditorProvider");
  }
  return context;
};
