import type { ReactElement } from "react"
import { defineDSL } from "../utils/defineDSL"
import { CharacterManagerElement } from "./ast"
import type { OneOrMany } from "../utils/util-types"

type ChildrenOf<T> = OneOrMany<ReactElement<T>>

/**
 * 子要素でシナリオ内で使用するキャラクターを宣言する
 */
export const DeclareCharacters = defineDSL<{
  children: ChildrenOf<typeof DeclareCharacter>
}>(CharacterManagerElement.DeclareCharacters)

/**
 * 子要素としてChapterをとり、シナリオを作成する
 */
export const Senario = defineDSL<{
  children?: ChildrenOf<typeof Chapter>
}>(CharacterManagerElement.Senario)

/**
 * 使用するキャラクターを宣言する。
 * @param idleClassName 非話者であるときのPsdCharacterに付与されるclassName
 * @param speakingClassName 話者であるときのPsdCharacterに付与されるclassName
 * @param name Senario内で使用するキャラクター名
 * @param children 非話者時のキャラクターの状態を定義する。PsdCharacterのchildrenと同様
 */
export const DeclareCharacter = defineDSL<{
  idleClassName?: string
  speakingClassName?: string
  name: string
  psd: string
  children?: React.ReactNode
}>(CharacterManagerElement.DeclareCharacter)

/**
 * キャラクターの喋るチャプターを宣言する。
 * 話者をSpeakerとして登録する
 * Chapter内でSpeakerとして登録されなかったキャラクターは宣言時に登録された状態になる
 */
export const Chapter = defineDSL<{
  children: React.ReactNode
}>(CharacterManagerElement.Chapter)

/**
 * 話者を登録する
 * @param className canvasに渡すclassName
 * @param name DeclareCharactersで宣言したキャラクター名
 * @param children PsdCharacterの子要素と同様
 */
export const Speaker = defineDSL<{
  className?: string
  name: string
  children: React.ReactNode
}>(CharacterManagerElement.Speaker)
