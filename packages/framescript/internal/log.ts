/** Messages for whoever runs the project (the studio shows standard error). */

// deno-lint-ignore no-explicit-any
const console = (globalThis as any).console

export function warn(message: string): void {
  console.warn(`[framescript] ${message}`)
}
