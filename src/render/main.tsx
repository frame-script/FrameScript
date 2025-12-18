import React, { useCallback, useRef } from "react"
import ReactDOM from "react-dom/client"
import { PROJECT } from "../../project/project"
import { Store } from "../util/state"
import { StudioStateContext } from "../lib/studio-state"
import { WithCurrentFrame } from "../lib/frame"

const RanderRoot = () => {
  const storeRef = useRef(new Store(false))
  const setIsPlaying = useCallback((flag: boolean) => {
    storeRef.current.set(flag)
  }, [])

  return (
    <StudioStateContext.Provider value={{ isPlaying: false, setIsPlaying, isPlayingStore: storeRef.current, isRender: true }}>
      <WithCurrentFrame>
        <PROJECT />
      </WithCurrentFrame>
    </StudioStateContext.Provider>
  )
}

const root = document.getElementById("root")!

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <RanderRoot />
  </React.StrictMode>
)
