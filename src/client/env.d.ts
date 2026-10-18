/** `import css from './x.css?inline'`: the stylesheet text, injected by the client's own effect. */
declare module '*.css?inline' {
  const css: string
  export default css
}
