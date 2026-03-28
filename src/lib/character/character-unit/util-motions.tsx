import { PROJECT_SETTINGS } from "../../../../project/project"
import { framesToSeconds } from "../../audio"
import { DEFAULT_THRESHOLD, resolveSegmentAmplitude } from "../../sound/character"
import { Motion, VoiceMotion } from "./psd-character-component"
import type { Trim } from "../../trim"

// ================================
// 型定義（PSDパーツの指定方法）
// ================================

export type BasicPsdOptions = {
  eye: EyeOptions4
  mouth: MouthOptions
}

// enum型 or bool型（レイヤーON/OFF）のどちらでも扱えるようにする
export type EyeOptions4 =
  | { kind: "enum"; options: EyeEnum<EyeShape4> }
  | { kind: "bool"; options: EyeBool<EyeShape4> }

export type MouthOptions =
  | { kind: "enum"; options: MouthEnum<MouthShapeVowel> }
  | { kind: "bool"; options: MouthBool<MouthShapeVowel> }

export type SimpleMouthOptions =
  | { kind: "enum"; options: MouthEnum<MouthShape2> }
  | { kind: "bool"; options: MouthBool<MouthShape2> }

// 目の状態（4段階）
type EyeShape4 = "Open" | "HalfOpen" | "HalfClosed" | "Closed"

/**
 * enum形式の目指定
 * PSDのパス + 各状態のレイヤー名
 */
export type EyeEnum<T extends string> = {
  Eye: string
  Default: string
} & Record<T, string>

/**
 * bool形式の目指定（レイヤーON/OFF）
 */
export type EyeBool<T extends string> = {
  Default: string
} & Record<T, string>

// 口の形（母音ベース）
type MouthShapeVowel = "A" | "I" | "U" | "E" | "O" | "X"
type MouthShape2 = "Open" | "Closed"

/**
 * enum形式の口指定
 */
export type MouthEnum<T extends string> = {
  Mouth: string
  Default: string
} & Record<T, string>

/**
 * bool形式の口指定
 */
export type MouthBool<T extends string> = {
  Default: string
} & Record<T, string>

// 任意キーを必須にするユーティリティ型
type HasKey<K extends string, V = unknown> = {
  [P in K]: V
} & Record<string, unknown>


// ================================
// LipSync（音素ベース口パク）
// ================================

export type LipSyncData  = HasKey<"mouthCues", {start: number, end: number, value: string}[]>

export type LipSyncProps = {
  data: LipSyncData
}

/**
 * 音素データに基づいて口パクを行うコンポーネントを生成
 * 時刻tに対応するmouthCuesを探して、そのvalueから口形を決定する
 * * Psdに対応した口パク用のコンポーネントを返す。
 *
 * @example
 * ```typescript
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
 * ```
 */
export const createLipSync = (mouthOptions: MouthOptions) => {
  return ({ data }: LipSyncProps) => {
    return <Motion motion={(_v, frames) => {

      // 現在フレームを秒に変換
      const t = framesToSeconds(frames[0])

      let shape: MouthShapeVowel | undefined = undefined

      // 現在時刻に該当するセクションを線形探索
      for (let section of data.mouthCues) {
        if (section.start <= t && t < section.end) {
          shape = lipSyncValueToMouthShape(section.value)
          break
        }
      }

      // 該当なし → 何も変更しない
      if (!shape) {
        return {}
      }

      // PSDのレイヤー指定に変換
      return applyOption(mouthOptions, shape)
    }} />
  }
}

/**
 * 音素ラベル → 母音口形に変換
 * (A,B,C...などの外部フォーマットに対応)
 */
const lipSyncValueToMouthShape = (value: string): MouthShapeVowel => {
  switch (value) {
    case "A": return "A"
    case "B": return "I"
    case "C": return "E"
    case "D": return "A"
    case "E": return "O"
    case "F": return "U"
    case "G": return "I"
    case "H": return "U"
    case "X": return "X"
    default:  return "X" // 未知値は閉じ口扱い
  }
}


// ================================
// Simple LipSync（音量ベース）
// ================================

type SimpleLipSyncProps = {
  voice: string,
  threshold?: number
  trim?: Trim
  fadeInFrames?: number
  fadeOutFrames?: number
  volume?: number
  showWaveform?: boolean
}

/**
 * 音量に応じて口の開閉を行う簡易口パク
 * 一定以上の音量 → Open、それ以外 → Closed
 *
 * @example
 * ```typescript
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
 * ```
 */
export const createSimpleLipSync = (mouthOptions: SimpleMouthOptions) => {
  return ({
    voice,
    threshold = DEFAULT_THRESHOLD,
    trim,
    fadeInFrames,
    fadeOutFrames,
    volume,
    showWaveform
  }: SimpleLipSyncProps) => {
    return <VoiceMotion
      voice={voice}
      voiceMotion={(audioSegment, waveform, _, frames) => {

        // 現在フレーム時点の音量を取得
        const amp = resolveSegmentAmplitude(
          audioSegment,
          waveform,
          frames[frames.length - 1],
          PROJECT_SETTINGS.fps
        )

        // 閾値で開閉を切り替え
        return amp > threshold
          ? applyOption(mouthOptions, "Open")
          : applyOption(mouthOptions, "Closed")
      }}
      trim={trim}
      fadeInFrames={fadeInFrames}
      fadeOutFrames={fadeOutFrames}
      volume={volume}
      showWaveform={showWaveform}
    />
  }
}


// ================================
// Blink（目パチ）
// ================================

export type BlinkData = HasKey<"blinkCues", {start: number, end: number, value: string}[]>

export type BlinkProps = {
  data: BlinkData
}

/**
 * 目パチ制御
 *
 * @example
 * ```typescript
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
 * ```
 */
export const createBlink = (eyeOptions: EyeOptions4) => {
  return ({ data }: BlinkProps) => {
    return <Motion motion={(_v, frames) => {

      const t = framesToSeconds(frames[1])
      const sections = data.blinkCues
      
      // =========================
      // 二分探索（start <= t の最大index）
      // LipSyncよりも長くなることが多いと想定し線形探索でなく二分探索
      // =========================
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

      // 範囲内なら有効
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

/**
 * Blink用の値 → 目の状態に変換
 */
const BlinkValueToEyeShape = (value: string): EyeShape4 => {
  switch (value) {
    case "A": return "Open"
    case "B": return "HalfOpen"
    case "C": return "HalfClosed"
    case "D": return "Closed"
    default:  return "Open"
  }
}


// ================================
// 共通：PSDレイヤー適用ロジック
// ================================

function applyOption(optionDict: EyeOptions4, option: EyeShape4): Record<string, any>;
function applyOption(optionDict: MouthOptions, option: MouthShapeVowel): Record<string, any>;
function applyOption(optionDict: SimpleMouthOptions, option: MouthShape2): Record<string, any>;

/**
 * option（状態）をPSDレイヤー指定に変換する
 *
 * enum:
 *   → "パス": "レイヤー名"
 *
 * bool:
 *   → DefaultをOFF/ONしつつ対象レイヤーをtrueにする
 */
function applyOption(
  optionDict: EyeOptions4 | MouthOptions | SimpleMouthOptions,
  option: EyeShape4 | MouthShapeVowel | MouthShape2
): Record<string, any> {

  // 未定義のキーは無視
  if (!(option in optionDict.options)) return {}

  const opt = option as keyof typeof optionDict.options

  // =========================
  // enum形式
  // =========================
  if (optionDict.kind == "enum") {

    // 口
    if ("Mouth" in optionDict.options) {
      return {
        [optionDict.options.Mouth]: optionDict.options[opt]
      }
    }

    // 目
    if ("Eye" in optionDict.options) {
      return {
        [optionDict.options.Eye]: optionDict.options[opt]
      }
    }

    throw "unknown type dict"
  }

  // =========================
  // bool形式（レイヤーON/OFF）
  // =========================
  if (optionDict.options[opt] == optionDict.options.Default) {
    // デフォルト状態
    return {
      [optionDict.options.Default]: true
    }
  } else {
    // 対象ON + デフォルトOFF
    return {
      [optionDict.options.Default]: false,
      [optionDict.options[opt]]: true
    }
  }
}
