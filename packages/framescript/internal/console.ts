/**
 * `console`, printed to the engine's standard output and error. V8's own only reaches an
 * inspector, so without this nothing would show.
 */

// deno-lint-ignore no-explicit-any
const g = globalThis as any
const print: (message: string, isError: boolean) => void = g.Deno.core.print

function format(args: unknown[]): string {
  return args.map((a) => {
    if (typeof a === "string") return a
    if (a instanceof Error) return a.stack ?? String(a)
    if (typeof a === "object" && a !== null) {
      try {
        return JSON.stringify(a)
      } catch {
        return String(a)
      }
    }
    return String(a)
  }).join(" ") + "\n"
}

const out = (...args: unknown[]) => print(format(args), false)
const err = (...args: unknown[]) => print(format(args), true)

g.console = {
  log: out,
  info: out,
  debug: out,
  warn: err,
  error: err,
  trace: err,
}
