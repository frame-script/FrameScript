import type { ReactElement, ReactNode } from "react"
import { parseCharacterManager } from "./parser"
import { PsdCharacter } from "../character-unit"
import { DeclareCharacters, Scenario } from "./character-manager-component"
import { Clip, ClipSequence } from "../../clip"
import type { OneOrMany } from "../utils/util-types"

// ================================
// Types
// ================================

/**
 * Determines where implicit (non-speaking) characters are placed.
 *
 * 非話者キャラクターをどのレイヤー順で配置するかを指定する
 * - "front": 前面に配置
 * - "back": 背面に配置
 */
export type ImplicitCharacterPlacement = "front" | "back"

type DialogueScenarioProps = {
  implicitPlacement?: ImplicitCharacterPlacement

  /**
   * Accepts DSL components:
   * - DeclareCharacters
   * - Scenario
   *
   * DSLコンポーネントを受け取る:
   * - DeclareCharacters（キャラ定義）
   * - Scenario（シナリオ本体）
   */
  children: OneOrMany<
    ReactElement<typeof DeclareCharacters> | ReactElement<typeof Scenario>
  >
}

// ================================
// Main Component
// ================================

/**
 * Builds a dialogue-style scenario from declared characters and chapters.
 * Renders each scene with speaking and non-speaking characters automatically arranged.
 *
 * キャラクター定義とチャプター構成から、会話形式のシナリオを生成する。
 * 各シーンごとに、話者・非話者のキャラクターを自動で配置して描画する。
 *
 * @param implicitPlacement Controls layering of non-speaking characters
 * @param children DSL components describing characters and scenario
 *
 * @param implicitPlacement 非話者キャラクターの前後配置
 * @param children シナリオDSL
 *
 * @example
 * ```tsx
 * <DialogueSenario>
 *   <DeclareCharacters>
 *     <DeclareCharacter idleClassName="akane" speakingClassName="akane" name="akane" psd="../assets/akane.psd" />
 *     <DeclareCharacter idleClassName="aoi" speakingClassName="aoi" name="aoi" psd="../assets/aoi.psd" />
 *   </DeclareCharacters>
 *   <Scenario>
 *     <Chapter>
 *       <Speaker name="aoi">
 *         <Voice voice="../assets/001_aoi.wav"/>
 *       </Speaker>
 *     </Chapter>
 *     <Chapter>
 *       <Speaker name="akane">
 *         <Voice voice="../assets/002_akane.wav" />
 *       </Speaker>
 *     </Chapter>
 *   </Scenario>
 * </DialogueSenario>
 * ```
 */
export const DialogueScenario = ({
  implicitPlacement = "back",
  children,
}: DialogueScenarioProps) => {
  // =========================
  // 1. Parse DSL → AST
  // =========================
  const ast = parseCharacterManager(children)

  // =========================
  // 2. Build character registry
  // =========================
  /**
   * Map<name, characterInfo>
   *
   * キャラクター名をキーにした辞書を構築
   * - psd: 使用PSD
   * - speakingClassName: 話者時スタイル
   * - idleState: 非話者時の描画要素
   */
  const characters = new Map(
    ast.characters.children.map((character) => {
      return [
        character.name,
        {
          psd: character.psd,
          speakingClassName: character.speakingClassName,

          // Pre-built idle state (used when not speaking)
          // 非話者状態の描画をあらかじめ構築しておく
          idleState: (
            <PsdCharacter
              key={character.name}
              className={character.idleClassName}
              psd={character.psd}
            >
              {character.children}
            </PsdCharacter>
          ),
        },
      ]
    }),
  )

  // =========================
  // 3. Build scenario per chapter
  // =========================
  const scenario = ast.scenario.children.map((chapter) => {
    // -------------------------
    // Extract explicit speakers
    // -------------------------
    /**
     * Characters explicitly marked as speakers in this chapter
     *
     * このチャプター内でSpeakerとして明示指定されたキャラクター
     */
    const explicitSpeakers = chapter.children
      .filter((child) => child.kind == "speaker")
      .map((s) => s.node.name)

    // -------------------------
    // Determine implicit characters
    // -------------------------
    /**
     * Characters NOT speaking in this chapter
     *
     * このチャプターで話していないキャラクター
     */
    const implicitCharacters = Array.from(characters.entries()).filter(
      ([key, _]) => !explicitSpeakers.includes(key),
    )

    // -------------------------
    // Build explicit speaker nodes
    // -------------------------
    const explicits = chapter.children.map((elm) => {
      if (elm.kind == "speaker") {
        // Resolve default speaking class
        // デフォルトの話者classNameを付与
        let defaultClass = ""
        if (characters.get(elm.node.name)?.speakingClassName) {
          defaultClass = " " + characters.get(elm.node.name)!.speakingClassName
        }

        // Merge user-defined + default class
        // ユーザー指定とデフォルトを結合
        const className =
          (elm.node.className ? elm.node.className : "") + defaultClass

        return (
          <PsdCharacter
            key={elm.node.name}
            className={className}
            psd={characters.get(elm.node.name)?.psd!}
          >
            {elm.node.children}
          </PsdCharacter>
        )
      } else {
        // Non-speaker elements are passed through as-is
        // speaker以外の要素はそのまま返す
        return elm.node
      }
    })

    // -------------------------
    // Build implicit (idle) nodes
    // -------------------------
    const implicits = implicitCharacters.map(
      ([_, character]) => character.idleState,
    )

    // -------------------------
    // Merge explicit & implicit
    // -------------------------
    /**
     * Merge based on placement rule
     *
     * implicitPlacementに応じて前後関係を決定
     */
    const merged = mergeImplicitCharacters(
      implicitPlacement,
      explicits,
      implicits,
    )

    // Wrap each chapter as a Clip
    // 各チャプターをClipとしてラップ
    return <Clip> {merged} </Clip>
  })

  // =========================
  // 4. Return sequence
  // =========================
  /**
   * Final output is a sequence of clips
   *
   * 最終的にClipの連続として出力
   */
  return <ClipSequence>{scenario}</ClipSequence>
}

// ================================
// Helpers
// ================================

/**
 * Merge explicit (speaking) and implicit (idle) characters
 * based on placement rule.
 *
 * 話者と非話者の描画順を制御する
 *
 * @param implicitPlacement front or back
 * @param explicits speaking elements
 * @param implicits idle elements
 */
const mergeImplicitCharacters = (
  implicitPlacement: ImplicitCharacterPlacement,
  explicits: ReactNode[],
  implicits: ReactNode[],
) => {
  switch (implicitPlacement) {
    case "front":
      // Place implicit characters in front
      // 非話者を前面に配置
      return [...explicits, ...implicits]

    case "back":
      // Place implicit characters behind
      // 非話者を背面に配置
      return [...implicits, ...explicits]

    default:
      throw `unknown merge option: {implicitPlacement}`
  }
}
