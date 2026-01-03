import { useCallback, useEffect, useRef, type ImgHTMLAttributes, type SyntheticEvent } from "react"

type ImageTracker = {
  pending: number
  start: () => () => void
  wait: () => Promise<void>
}

const IMAGE_TRACKER_KEY = "__frameScript_ImageTracker"

const getImageTracker = (): ImageTracker => {
  const g = globalThis as unknown as Record<string, unknown>
  const existing = g[IMAGE_TRACKER_KEY] as ImageTracker | undefined
  if (existing) return existing

  let pending = 0
  const waiters = new Set<() => void>()

  const notifyIfReady = () => {
    if (pending !== 0) return
    for (const resolve of Array.from(waiters)) {
      resolve()
    }
    waiters.clear()
  }

  const tracker: ImageTracker = {
    get pending() {
      return pending
    },
    start: () => {
      pending += 1
      let done = false
      return () => {
        if (done) return
        done = true
        pending = Math.max(0, pending - 1)
        notifyIfReady()
      }
    },
    wait: () => {
      if (pending === 0) return Promise.resolve()
      return new Promise<void>((resolve) => {
        waiters.add(resolve)
      })
    },
  }

  g[IMAGE_TRACKER_KEY] = tracker
  return tracker
}

const waitForAnimationTick = () =>
  new Promise<void>((resolve) => {
    if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
      setTimeout(resolve, 0)
      return
    }
    window.requestAnimationFrame(() => resolve())
  })

const installImageApi = () => {
  if (typeof window === "undefined") return
  const tracker = getImageTracker()
  const waitImagesReady = async () => {
    while (true) {
      if (tracker.pending === 0) {
        await waitForAnimationTick()
        if (tracker.pending === 0) return
      }
      await tracker.wait()
    }
  }

  ;(window as any).__frameScript = {
    ...(window as any).__frameScript,
    waitImagesReady,
    getImagesPending: () => tracker.pending,
  }
}

if (typeof window !== "undefined") {
  installImageApi()
}

const useImagePending = () => {
  const loadIdRef = useRef(0)
  const pendingFinishRef = useRef<(() => void) | null>(null)

  const beginPending = useCallback(() => {
    loadIdRef.current += 1
    if (!pendingFinishRef.current) {
      pendingFinishRef.current = getImageTracker().start()
    }
    return loadIdRef.current
  }, [])

  const endPending = useCallback(() => {
    if (pendingFinishRef.current) {
      pendingFinishRef.current()
      pendingFinishRef.current = null
    }
  }, [])

  useEffect(() => () => endPending(), [endPending])

  return { beginPending, endPending, loadIdRef }
}

export type ImgProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src: string
}

/**
 * Image component that waits for decode before rendering in headless mode.
 *
 * デコード完了まで待機する <Img> です。
 */
export const Img = ({ src, onLoad, onError, ...props }: ImgProps) => {
  const imgRef = useRef<HTMLImageElement | null>(null)
  const { beginPending, endPending, loadIdRef } = useImagePending()

  useEffect(() => {
    const img = imgRef.current
    if (!img || !src) return

    const loadId = beginPending()
    let done = false

    const finalize = () => {
      if (done) return
      done = true
      if (loadId === loadIdRef.current) {
        endPending()
      }
    }

    const handleLoad = (event: Event) => {
      onLoad?.(event as unknown as SyntheticEvent<HTMLImageElement>)
      const decode = typeof img.decode === "function" ? img.decode() : Promise.resolve()
      decode.catch(() => {}).finally(finalize)
    }

    const handleError = (event: Event) => {
      onError?.(event as unknown as SyntheticEvent<HTMLImageElement>)
      finalize()
    }

    if (img.complete && img.naturalWidth > 0) {
      const decode = typeof img.decode === "function" ? img.decode() : Promise.resolve()
      decode.catch(() => {}).finally(finalize)
    } else {
      img.addEventListener("load", handleLoad)
      img.addEventListener("error", handleError)
    }

    return () => {
      img.removeEventListener("load", handleLoad)
      img.removeEventListener("error", handleError)
      if (loadId === loadIdRef.current) {
        endPending()
      }
    }
  }, [src, onLoad, onError, beginPending, endPending])

  return <img ref={imgRef} src={src} {...props} />
}
