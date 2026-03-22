import { threshold } from "three/examples/jsm/nodes/Nodes.js"
import { PROJECT_SETTINGS } from "../../../../project/project"
import { framesToSeconds } from "../../audio"
import { useCurrentFrame } from "../../frame"
import { DEFAULT_THRESHOLD, resolveSegmentAmplitude } from "../../sound/character"
import { Motion, VoiceMotion } from "./psd-character-component"
import type { Trim } from "../../trim"


export type BasicPsdOptions = {
  eye: EyeOptions4
  mouth: MouthOptions
}

export type EyeOptions4 = { kind: "enum"; options: EyeEnum<EyeShape4> } | { kind: "bool"; options: EyeBool<EyeShape4> }
export type MouthOptions = { kind: "enum"; options: MouthEnum<MouthShapeVowel> } | { kind: "bool"; options: MouthBool<MouthShapeVowel> }
export type SimpleMouthOptions = { kind: "enum"; options: MouthEnum<MouthShape2> } | { kind: "bool"; options: MouthBool<MouthShape2> }

type EyeShape4 = "Open" | "HalfOpen" | "HalfClosed" | "Closed"

/**
 * 目パチに関するag-psd-psdtoolに渡す名前を登録する
 * @property Eye 目の階層までのパス
 * @property Default デフォルトのオプション
 */
export type EyeEnum<T extends string> = {
  Eye: string
  Default: string
} & Record<T, string>

/**
 * 目パチに関するag-psd-psdtoolに渡す名前を登録する
 * Enumになっていないpsdをそのまま利用する用
 * @property Default デフォルトのオプション
 */
export type EyeBool<T extends string> = {
  Default: string
} & Record<T, string>

type MouthShapeVowel = "A" | "I" | "U" | "E" | "O" | "X"
type MouthShape2 = "Open" | "Closed"

/**
 * あいうえお口パクに関するag-psd-psdtoolに渡す名前を登録する
 * @property Mouth 口の階層までのパス
 * @property Default デフォルトのオプション
 * @property X 無声時の口を閉じる形のオプション
 */
export type MouthEnum<T extends string> = {
  Mouth: string
  Default: string
} & Record<T, string>

/**
 * あいうえお口パクに関するag-psd-psdtoolに渡す名前を登録する
 * enumになっていないものをそのまま利用する用
 * @property Default デフォルトのオプション
 * @property X 無声時の口を閉じる形のオプション
 */
export type MouthBool<T extends string> = {
  Default: string
} & Record<T, string>

type HasKey<K extends string, V = unknown> = {
  [P in K]: V
} & Record<string, unknown>


// lip sync --------------------------------

export type LipSyncData  = HasKey<"mouthCues", {start: number, end: number, value: string}[]>

export type LipSyncProps = {
  data: LipSyncData
}

/**
 * Psdに対応した口パク用のコンポーネントを返す。
 * @example
 * const LipSync = createLipSync({
 *   kind: "enum" as const,
 *   options: {
 *     Mouth: "目・口/口", 
 *     Default: "あ",
 *     A: "あ", 
 *     I: "い", 
 *     U: "う", 
 *     E: "え", 
 *     O: "お", 
 *     X: "閉じ", 
 *   }
 * })
 *
 * const data = {
 *   mouthCues: [{start: 0}, {end: 1}, {value: "A"}]
 * }
 * 
 * // 略 --------------------
 *
 * <PsdCharacter psd={psd}>
 *   <Voice voice={voice}/>
 *   <LipSync data={data}/>
 * </PsdCharacter>
 */
export const createLipSync = (mouthOptions: MouthOptions) => {
  return ({ data }: LipSyncProps) => {
    return <Motion motion={(_v, frames) => {
      const t = framesToSeconds(frames[0])
      let shape: MouthShapeVowel | undefined = undefined
      for (let section of data.mouthCues) {
        if (section.start <= t && t < section.end) {
          shape = lipSyncValueToMouthShape(section.value)
          break
        }
      }

      if (!shape) {
        return {}
      }

      return applyOption(mouthOptions, shape)
    }} />
  }
}

const lipSyncValueToMouthShape = (value: string): MouthShapeVowel => {
  switch (value) {
    case "A":
      return "A"
    case "B":
      return "I"
    case "C":
      return "E"
    case "D":
      return "A"
    case "E":
      return "O"
    case "F":
      return "U"
    case "G":
      return "I"
    case "H":
      return "U"
    case "X":
      return "X"
    default:
      return "X"
  }
}

// simple lipsync --------------

/**
 * Psdに対応した音量依存の口パク用のコンポーネントを返す。
 * @example
 * const LipSync = createSimpleLipSync({
 *   kind: "enum" as const,
 *   options: {
 *     Mouth: "目・口/口", 
 *     Default: "あ",
 *     Open: "あ", 
 *     Closed: "閉じ", 
 *   }
 * })
 * 
 * // 略 --------------------
 *
 * <PsdCharacter psd={psd}>
 *   <LipSync voice={voice}/>
 * </PsdCharacter>
 */
type SimpleLipSyncProps = {
  voice: string,
  threshold?: number
  trim?: Trim
  fadeInFrames?: number
  fadeOutFrames?: number
  volume?: number
  showWaveform?: boolean
}

export const createSimpleLipSync = (mouthOptions: SimpleMouthOptions) => {
  return ({
    voice,
    threshold=DEFAULT_THRESHOLD,
    trim,
    fadeInFrames,
    fadeOutFrames,
    volume,
    showWaveform
  }: SimpleLipSyncProps) => {
    return <VoiceMotion
      voice={voice}
      voiceMotion={(audioSegment, waveform, _, frames) => {
        const amp = resolveSegmentAmplitude(audioSegment, waveform, frames[frames.length - 1], PROJECT_SETTINGS.fps)
        return amp > threshold ? applyOption(mouthOptions, "Open") : applyOption(mouthOptions, "Closed")
      }}
      trim={trim}
      fadeInFrames={fadeInFrames}
      fadeOutFrames={fadeOutFrames}
      volume={volume}
      showWaveform={showWaveform}
    />
  }
}



// blink --------------------------------

export type BlinkData = HasKey<"blinkCues", {start: number, end: number, value: string}[]>

export type BlinkProps = {
  data: BlinkData
}

/**
 * Psdに対応した目パチ用のコンポーネントを返す。
 * @example
 * const Blink = createBlink({
 *   kind: "enum" as const,
 *   options: {
 *     Eye: "目・口/目", 
 *     Default: "デフォルト"
 *     Open: "デフォルト",
 *     HalfOpen: "やや閉じ",
 *     HalfClosed: "半目",
 *     Closed: "閉じ"
 *   }
 * })
 *
 * const data = {
 *   blinkCues: [
 *     { start: 0.00, end: 0.40, value: "A" },
 *     { start: 0.40, end: 0.45, value: "B" },
 *     { start: 0.45, end: 0.50, value: "C" },
 *     { start: 0.50, end: 0.55, value: "D" },
 *     { start: 0.55, end: 0.60, value: "C" },
 *     { start: 0.60, end: 0.65, value: "B" },
 *     { start: 0.65, end: 6.65, value: "A" }
 *   ]
 * }
 * 
 * // 略 --------------------
 *
 * <PsdCharacter psd={psd}>
 *   <Voice voice={voice}/>
 *   <Blink data={data}/>
 * </PsdCharacter>
 */
export const createBlink = (eyeOptions: EyeOptions4) => {
  return ({ data }: BlinkProps) => {
    return <Motion motion={(_v, frames) => {

      const t = framesToSeconds(frames[1])
      const sections = data.blinkCues
      
      let lo = 0
      let hi = sections.length - 1
      let idx = -1
      
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
      
        if (sections[mid].start <= t) {
          idx = mid
          lo = mid + 1
        } else {
          hi = mid - 1
        }
      }
      
      let shape: EyeShape4 | undefined = undefined
      if (idx !== -1 && t < sections[idx].end) {
        shape = BlinkValueToEyeShape(sections[idx].value)
      }

      if (!shape) {
        return {}
      }

      return applyOption(eyeOptions, shape)
    }} />
  }
}

const BlinkValueToEyeShape = (value: string): EyeShape4 => {
  switch (value) {
    case "A":
      return "Open"
    case "B":
      return "HalfOpen"
    case "C":
      return "HalfClosed"
    case "D":
      return "Closed"
    default:
      return "Open"
  }
}




function applyOption(optionDict: EyeOptions4, option: EyeShape4): Record<string, any>;
function applyOption(optionDict: MouthOptions, option: MouthShapeVowel): Record<string, any>;
function applyOption(optionDict: SimpleMouthOptions, option: MouthShape2): Record<string, any>;
function applyOption(optionDict: EyeOptions4 | MouthOptions | SimpleMouthOptions, option: EyeShape4 | MouthShapeVowel | MouthShape2): Record<string, any> {
  if (!(option in optionDict.options)) return {}
  const opt = option as keyof typeof optionDict.options
  if (optionDict.kind == "enum") {
    if ("Mouth" in optionDict.options) {
      return {
        [optionDict.options.Mouth]: optionDict.options[opt]
      }
    }
    if ("Eye" in optionDict.options) {
      return {
        [optionDict.options.Eye]: optionDict.options[opt]
      }
    }

    throw "unknown type dict"
  }

  if (option == optionDict.options.Default) {
    return {
      [optionDict.options.Default]: true
    }
  } else {
    return {
      [optionDict.options.Default]: false,
      [optionDict.options[opt]]: true
    }
  }

}
