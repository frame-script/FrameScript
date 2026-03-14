import type { ReactElement, ReactNode } from "react"
import { parseCharacterManager } from "./parser"
import { PsdCharacter } from "../character-unit"
import { DeclareCharacters, Senario } from "./character-manager-component"
import { Clip, ClipSequence } from "../../clip"
import type { OneOrMany } from "../utils/util-types"


type DialogueSenarioProps = {
  children: OneOrMany<ReactElement<typeof DeclareCharacters> | ReactElement<typeof Senario>>
}
export const DialogueSenario = ({
  children
}: DialogueSenarioProps) => {
  const ast = parseCharacterManager(children)

  const characters = ast.characters.children.map(character => {
    return {
      name: character.name,
      psd: character.psd,
      waitingState: <PsdCharacter
        className={character.className}
        psd={character.psd}
      >
        {character.children}
      </PsdCharacter>
    }
  })

  const senario = ast.senario.children.map(chapter => {
    const speakerMap = new Map(
      chapter.children.map(s => [s.name, s])
    )
    return <Clip>
      {characters.map(character => {
        const speaker = speakerMap.get(character.name)
        if (speaker) {
          return (
            <PsdCharacter className={speaker.className} psd={character.psd}>
              {speaker.children}
            </PsdCharacter>
          )
        } else {
          return character.waitingState
        }
      })}
    </Clip>
  })

  return (
    <ClipSequence>
      {senario}
    </ClipSequence>
  )
}
