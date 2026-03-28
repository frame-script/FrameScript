import type { ReactElement } from "react"
import { defineDSL } from "../utils/defineDSL"
import { CharacterManagerElement } from "./ast"
import type { OneOrMany } from "../utils/util-types"

// ================================
// Utility Types
// ================================

/**
 * Allow a single ReactElement or an array of them.
 * ReactElementを単体または配列で受け取れるようにするユーティリティ型
 */
type ChildrenOf<T> = OneOrMany<ReactElement<T>>


// ================================
// DSL Definitions (Scenario Builder)
// ================================

/**
 * Declare all characters used in the scenario.
 * This acts as a registry for characters before they are used.
 * 
 * シナリオ内で使用するキャラクターをまとめて宣言するコンテナ。
 * 後続のChapterやSpeakerから参照される前提のレジストリとして機能する。
 * 
 * @example
 * <DeclareCharacters>
 *   <DeclareCharacter ... />
 * </DeclareCharacters>
 */
export const DeclareCharacters = defineDSL<{
  children: ChildrenOf<typeof DeclareCharacter>
}>(CharacterManagerElement.DeclareCharacters)


/**
 * Root container of the scenario.
 * Accepts multiple Chapter elements.
 * 
 * シナリオ全体を構成するルートコンテナ。
 * 子要素として複数のChapterを持つ。
 * 
 */
export const Scenario = defineDSL<{
  children?: ChildrenOf<typeof Chapter>
}>(CharacterManagerElement.Scenario)


/**
 * Declare a character and its base (idle) state.
 * This definition is later referenced by <Speaker>.
 * 
 * キャラクターとそのデフォルト状態（非話者状態）を定義する。
 * この定義は後からSpeakerで参照される。
 * 
 * @param idleClassName CSS class applied when the character is idle
 * @param speakingClassName CSS class applied when the character is speaking
 * @param name Unique identifier used inside the scenario
 * @param psd PSD resource path
 * @param children Defines the idle visual state (same as PsdCharacter children)
 * 
 * @param idleClassName 非話者時のclassName
 * @param speakingClassName 話者時のclassName
 * @param name シナリオ内で使用する一意な名前
 * @param psd 使用するPSDリソース
 * @param children 非話者時の見た目（PsdCharacterと同様）
 */
export const DeclareCharacter = defineDSL<{
  idleClassName?: string
  speakingClassName?: string
  name: string
  psd: string
  children?: React.ReactNode
}>(CharacterManagerElement.DeclareCharacter)


/**
 * Defines a scene (or segment) where characters can speak.
 * Inside this block, speakers are explicitly assigned.
 * 
 * キャラクターが発話する単位（シーン・チャプター）を定義する。
 * この中でSpeakerとして指定されたキャラが発話状態になる。
 * 
 * @behavior
 * - Characters assigned as Speaker → speaking state
 * - Others → remain in idle state
 * 
 * 挙動:
 * - Speakerに指定されたキャラ → 話者状態
 * - それ以外 → 非話者状態のまま
 */
export const Chapter = defineDSL<{
  children: React.ReactNode
}>(CharacterManagerElement.Chapter)


/**
 * Assign a character as the active speaker within a Chapter.
 * Overrides the default idle state.
 * 
 * Chapter内でキャラクターを話者として登録する。
 * デフォルトの非話者状態を上書きする。
 * 
 * @param className CSS class applied to canvas
 * @param name Must match a declared character name
 * @param children Defines speaking state (same as PsdCharacter children)
 * 
 * @param className canvasに適用されるclassName
 * @param name DeclareCharacterで定義したキャラ名と一致する必要がある
 * @param children 発話時の状態（PsdCharacterと同様）
 * 
 * @important
 * The name must match a declared character.
 * nameは必ずDeclareCharacterで定義したものと一致させる必要がある
 */
export const Speaker = defineDSL<{
  className?: string
  name: string
  children: React.ReactNode
}>(CharacterManagerElement.Speaker)
