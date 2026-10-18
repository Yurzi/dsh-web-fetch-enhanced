/**
 * The settings page's staged form over this plugin's Profile row.
 *
 * Edits stay in the browser until Save, which writes every changed field in
 * one revision-fenced mutation — the same contract as the Host's own settings
 * pages. A field shows its effective value and is marked customized while the
 * Profile's user layer carries it; Reset stages the removal of that override.
 * The page also reads the shared `web` row to say when another provider
 * serves `web_fetch` and these settings therefore have no effect.
 */
import type { SettingsFormShell } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { MAX_TIMER_DELAY_MS, isValidUserAgent } from '../contract.ts'
import { type AllowlistField, type AllowlistReading, readAllowlist } from './allowlist-lines.ts'

/** Numeric limit fields, edited under the Limits disclosure. */
export type LimitField = 'timeoutMs' | 'maxResponseBytes' | 'maxBodyChars' | 'maxRedirects'

/** Every field the page edits. */
export type FieldName = AllowlistField | 'userAgent' | LimitField

/** One control's state. */
export interface FieldState {
  /** Draft text the control renders. */
  readonly text: string
  /** Whether saving would leave an override in the Profile's user layer. */
  readonly overridden: boolean
  /** Whether the draft is not a value the field accepts; blocks saving. */
  readonly invalid: boolean
}

/** Where `ctx.web` routes `web_fetch`, as far as the page can tell. */
export type FetchRoute =
  /** This plugin, or a provider the page cannot tell apart from it (a custom `providerId`). */
  | { readonly kind: 'this' }
  /** The `web` row is not served to this client. */
  | { readonly kind: 'unknown' }
  /** Nothing is pinned, so the Host auto-selects and may find several candidates. */
  | { readonly kind: 'auto' }
  /** The official DeepSeek Fetch API, selected by the Web search page's switch. */
  | { readonly kind: 'deepseek-api' }

/** Everything the page renders. */
export interface SettingsPageState extends SettingsFormShell {
  readonly fields: Readonly<Record<FieldName, FieldState>>
  /** Line-by-line reading of the two allowlist drafts. */
  readonly allowlists: Readonly<Record<AllowlistField, AllowlistReading>>
  readonly route: FetchRoute
}

/** A store the slot renderer binds as `useSettingsPage`. */
export interface Observable<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

/** What the page's slot registration injects. */
export interface SettingsPageFace {
  readonly hooks: { readonly settingsPage: Observable<SettingsPageState> }
  /** Stage draft text for a field. */
  readonly edit: (field: FieldName, text: string) => void
  /** Stage removal of a field's override. */
  readonly reset: (field: FieldName) => void
  /** Write every staged edit. */
  readonly save: () => void
  /** Drop every staged edit. */
  readonly discard: () => void
}

/** The `web` row fields the page reads. */
interface WebSelection {
  readonly fetchProvider?: string
}

type Values = Record<string, unknown>
type Write = { readonly kind: 'set'; readonly value: string | number | string[] } | { readonly kind: 'unset' }
type PathOp = { op: 'set'; path: string[]; value: string | number | string[] } | { op: 'unset'; path: string[] }

/** How a field converts between its stored value and its draft text. */
interface FieldSpec {
  format(value: unknown): string
  /** The write a draft stages, or undefined when the field does not accept it. */
  parse(text: string): Write | undefined
}

const allowlist = (field: AllowlistField): FieldSpec => ({
  format: value => Array.isArray(value) ? value.join('\n') : '',
  // An empty list is an explicit override: it revokes inherited exceptions. Only Reset unsets.
  parse: (text) => {
    const { values } = readAllowlist(field, text)
    return values === undefined ? undefined : { kind: 'set', value: [...values] }
  },
})

const integer = (min: number, max = Number.MAX_SAFE_INTEGER): FieldSpec => ({
  format: value => typeof value === 'number' ? String(value) : '',
  parse: (text) => {
    const trimmed = text.trim()
    if (trimmed === '') return { kind: 'unset' }
    const value = Number(trimmed)
    return /^\d+$/.test(trimmed) && value >= min && value <= max ? { kind: 'set', value } : undefined
  },
})

const FIELDS: Readonly<Record<FieldName, FieldSpec>> = {
  allowCidrs: allowlist('allowCidrs'),
  allowHostnames: allowlist('allowHostnames'),
  // Exact text: an empty value is a deliberate empty header, not a reset.
  userAgent: {
    format: value => typeof value === 'string' ? value : '',
    parse: text => isValidUserAgent(text) ? { kind: 'set', value: text } : undefined,
  },
  timeoutMs: integer(1, MAX_TIMER_DELAY_MS),
  maxResponseBytes: integer(1),
  maxBodyChars: integer(1),
  maxRedirects: integer(0),
}

const FIELD_NAMES = Object.keys(FIELDS) as FieldName[]

/** One staged edit. */
interface Draft {
  readonly text: string
  /** Remove the override whatever the text shows. */
  readonly reset: boolean
}

/** Stages edits over the plugin row and publishes the page state. */
export class SettingsPageController {
  readonly #drafts = new Map<FieldName, Draft>()
  readonly #listeners = new Set<() => void>()
  readonly #unsubscribe: readonly (() => void)[]
  /** Revision the drafts started from; a save is refused if the row moved since. */
  #revision: number | undefined
  #saving = false
  #failed = false
  #state: SettingsPageState

  /**
   * @param form - the plugin row's configuration form.
   * @param web - the shared `web` row's configuration form, read only.
   */
  constructor(
    private readonly form: ConfigForm<Values>,
    private readonly web: ConfigForm<WebSelection>,
  ) {
    this.#state = this.#project()
    this.#unsubscribe = [form.subscribe(() => { this.#publish() }), web.subscribe(() => { this.#publish() })]
  }

  /** @returns the face the slot registration injects. */
  face(): SettingsPageFace {
    return {
      hooks: {
        settingsPage: {
          getSnapshot: () => this.#state,
          subscribe: (listener) => {
            this.#listeners.add(listener)
            return () => { this.#listeners.delete(listener) }
          },
        },
      },
      edit: (field, text) => { this.#stage(field, { text, reset: false }) },
      reset: (field) => {
        const base = (this.form.getSnapshot().base as Values | undefined)?.[field]
        this.#stage(field, { text: FIELDS[field].format(base), reset: true })
      },
      save: () => { void this.save() },
      discard: () => {
        this.#drafts.clear()
        this.#revision = undefined
        this.#failed = false
        this.#publish()
      },
    }
  }

  /** Write every staged edit in one mutation; keep the drafts if the Host refuses it. */
  async save(): Promise<void> {
    const snapshot = this.form.getSnapshot()
    const plan = this.#plan(snapshot)
    if (this.#saving || !snapshot.writable || plan.length === 0 || plan.includes(undefined)) return
    this.#saving = true
    this.#failed = false
    this.#publish()
    try {
      if (await this.form.mutate(plan as PathOp[], this.#revision)) this.#drafts.clear()
      else this.#failed = true
    } catch {
      this.#failed = true
    } finally {
      // After a refusal, saving again applies the drafts over the current revision.
      this.#revision = undefined
      this.#saving = false
      this.#publish()
    }
  }

  /** Release the form subscriptions. */
  dispose(): void {
    for (const off of this.#unsubscribe) off()
    this.#listeners.clear()
  }

  #stage(field: FieldName, draft: Draft): void {
    this.#revision ??= this.form.getSnapshot().revision
    this.#drafts.set(field, draft)
    this.#failed = false
    this.#publish()
  }

  #publish(): void {
    this.#state = this.#project()
    for (const listener of this.#listeners) listener()
  }

  #project(): SettingsPageState {
    const snapshot = this.form.getSnapshot()
    const fields = Object.fromEntries(FIELD_NAMES.map(name => [name, this.#field(name, snapshot)])) as Record<FieldName, FieldState>
    const plan = this.#plan(snapshot)
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      dirty: plan.length > 0,
      invalid: plan.includes(undefined),
      saving: this.#saving,
      failed: this.#failed,
      fields,
      allowlists: {
        allowCidrs: readAllowlist('allowCidrs', fields.allowCidrs.text),
        allowHostnames: readAllowlist('allowHostnames', fields.allowHostnames.text),
      },
      route: routeOf(this.web.getSnapshot()),
    }
  }

  #field(name: FieldName, snapshot: ConfigFormSnapshot<Values>): FieldState {
    const draft = this.#drafts.get(name)
    if (draft === undefined) {
      return { text: FIELDS[name].format(snapshot.value?.[name]), overridden: stored(snapshot, name), invalid: false }
    }
    if (draft.reset) return { text: draft.text, overridden: false, invalid: false }
    const write = FIELDS[name].parse(draft.text)
    return { text: draft.text, overridden: write?.kind === 'set', invalid: write === undefined }
  }

  /** The operations a save would send; undefined marks a draft the field refuses. */
  #plan(snapshot: ConfigFormSnapshot<Values>): (PathOp | undefined)[] {
    const plan: (PathOp | undefined)[] = []
    for (const [name, draft] of this.#drafts) {
      const unset: PathOp = { op: 'unset', path: [name] }
      if (draft.reset) {
        if (stored(snapshot, name)) plan.push(unset)
        continue
      }
      if (draft.text === FIELDS[name].format(snapshot.value?.[name])) continue
      const write = FIELDS[name].parse(draft.text)
      if (write === undefined) plan.push(undefined)
      else if (write.kind === 'set') plan.push({ op: 'set', path: [name], value: write.value })
      else if (stored(snapshot, name)) plan.push(unset)
    }
    return plan
  }
}

function stored(snapshot: ConfigFormSnapshot<Values>, field: FieldName): boolean {
  const user = snapshot.user
  return typeof user === 'object' && user !== null && Object.hasOwn(user, field)
}

/** Provider id of the official DeepSeek Fetch API. */
const DEEPSEEK_FETCH_API = 'deepseek-fetch-api'

/**
 * The page only names a provider it can identify: this plugin's `providerId`
 * is not a live field, so any other pinned id may be this plugin under a
 * custom id and is not flagged.
 */
function routeOf(web: ConfigFormSnapshot<WebSelection>): FetchRoute {
  if (web.status !== 'ready') return { kind: 'unknown' }
  const id = web.value?.fetchProvider
  if (id === undefined || id === '') return { kind: 'auto' }
  return id === DEEPSEEK_FETCH_API ? { kind: 'deepseek-api' } : { kind: 'this' }
}