/**
 * Line-by-line reading of an allowlist textarea: which lines the Host would
 * refuse and why, which would be accepted but deserve a warning, and the
 * values a save would store.
 */
import { type CidrWarning, type RuleProblem, cidrWarnings, parseCidr, parseHostnameRule } from '../providers/local/rules.ts'

/** The two allowlist fields. */
export type AllowlistField = 'allowCidrs' | 'allowHostnames'

/** What the page reports about one non-empty line. */
export type LineNote =
  | { readonly kind: 'problem'; readonly problem: RuleProblem }
  | { readonly kind: 'duplicate'; readonly of: number }
  | { readonly kind: 'warning'; readonly warning: CidrWarning }

/** One line the page has something to say about. */
export interface LineReport {
  /** 1-based line number in the textarea. */
  readonly line: number
  /** The line as typed, trimmed. */
  readonly text: string
  readonly note: LineNote
}

/** A textarea's reading. */
export interface AllowlistReading {
  /** The rules a save would store, or undefined while any line is refused. */
  readonly values: readonly string[] | undefined
  /** Refusals first, then warnings, each in line order. */
  readonly reports: readonly LineReport[]
}

/**
 * @param field - which allowlist the text belongs to.
 * @param text - the textarea contents; blank lines are ignored.
 * @returns the reading.
 */
export function readAllowlist(field: AllowlistField, text: string): AllowlistReading {
  const values: string[] = []
  const blocking: LineReport[] = []
  const warnings: LineReport[] = []
  const seen = new Map<string, number>()
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1
    const value = raw.trim()
    if (value === '') return
    const parsed = field === 'allowCidrs' ? parseCidr(value) : parseHostnameRule(value)
    if (!parsed.ok) {
      blocking.push({ line, text: value, note: { kind: 'problem', problem: parsed.problem } })
      return
    }
    const key = JSON.stringify(parsed.value)
    const first = seen.get(key)
    if (first !== undefined) {
      blocking.push({ line, text: value, note: { kind: 'duplicate', of: first } })
      return
    }
    seen.set(key, line)
    values.push(value)
    if (field === 'allowCidrs' && 'prefixLength' in parsed.value) {
      for (const warning of cidrWarnings(parsed.value)) warnings.push({ line, text: value, note: { kind: 'warning', warning } })
    }
  })
  return { values: blocking.length === 0 ? values : undefined, reports: [...blocking, ...warnings] }
}

/**
 * Replace one line, keeping every other line as typed.
 * @param text - the textarea contents.
 * @param line - 1-based line number.
 * @param replacement - the new line.
 * @returns the edited contents.
 */
export function replaceLine(text: string, line: number, replacement: string): string {
  const lines = text.split(/\r?\n/)
  lines[line - 1] = replacement
  return lines.join('\n')
}

/**
 * Append a rule on its own line.
 * @param text - the textarea contents.
 * @param rule - the rule to add.
 * @returns the edited contents.
 */
export function appendLine(text: string, rule: string): string {
  const body = text.replace(/\s+$/, '')
  return body === '' ? rule : `${body}\n${rule}`
}
