import { createContext, useContext } from "react"

export interface ProjectSettings {
  name: string
  width: number
  height: number
  fps: number
}

const ProjectSettingContext = createContext<{ settings: ProjectSettings } | null>(null)

type ProjectProps = {
  settings: ProjectSettings
  children: React.ReactNode
}

export const Project = ({ settings, children }: ProjectProps) => {
  return (
    <ProjectSettingContext value={{ settings }}>
      {children}
    </ ProjectSettingContext>
  )
}

export const useProjectSettings = () => {
  const context = useContext(ProjectSettingContext)
  if (!context) throw Error("useProjectSettings must be used inside <Project>")
  return context.settings
}
