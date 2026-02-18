declare module "prismjs" {
  type Token = {
    type: string
    content: string | Token | Array<string | Token>
    alias?: string | string[]
  }

  type Grammar = Record<string, unknown>

  type Prism = {
    languages: Record<string, Grammar | undefined>
    tokenize: (text: string, grammar: Grammar) => Array<string | Token>
  }

  const Prism: Prism
  export default Prism
}

declare module "prismjs/components/*"
