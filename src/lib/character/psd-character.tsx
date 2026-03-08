import React, { useEffect, useState } from "react"

import { PsdCharacterElement as PsdElm, type CharacterNode } from "./ast"
import { readPsd, type Psd } from "ag-psd"
import { parsePsdCharacter } from "./parser"

type PsdCharacterProps = {
  psd: string
  children: React.ReactNode
}

type PsdPath = {
  path: string
}

export const PsdCharacter = ({
  psd,
  children
}: PsdCharacterProps) => {
  const [myPsd, setPsd] = useState<Psd | undefined>(undefined)
  const [ast, setAst] = useState<CharacterNode | undefined>(undefined)

  useEffect(() => {
    fetchPsd(normalizePsdPath(psd)).then(p => setPsd(p))
    setAst(parsePsdCharacter(children))
  }, [])

  return null
}

const psdCache = new Map<string, Psd>()
const psdPending = new Map<string, Promise<Psd>>()

const fetchPsd = async (psd: PsdPath): Promise<Psd> => {
  const cached = psdCache.get(psd.path)
  if (cached != null) return cached

  const pending = psdPending.get(psd.path)
  if (pending) return pending

  const next = (async () => {
    const res = await fetch(buildPsdUrl(psd))
    if (!res.ok) {
      throw new Error("failed to fetch psd file")
    }
  
    const file = readPsd(await res.arrayBuffer())
    psdCache.set(psd.path, file)
    return file
  })().finally(() => {
    psdPending.delete(psd.path)
  })

  psdPending.set(psd.path, next)
  return next
}

const normalizePsdPath = (psd: PsdPath | string): PsdPath => {
  if (typeof psd === "string") return { path: psd }
  return psd
}

const buildPsdUrl = (pad: PsdPath) => {
  const url = new URL("http://localhost:3000/file")
  url.searchParams.set("path", pad.path)
  return url.toString()
}
