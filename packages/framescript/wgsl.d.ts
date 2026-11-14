/** A `.wgsl` file imports as its code. */
declare module "*.wgsl" {
  const code: string
  export default code
}
