/**
 * Stand-ins for the shell's `@deepseek-ai/dsh-client-ui-primitives`, whose npm
 * build only loads inside the shell. They keep the props contract and render
 * plain semantic HTML, so tests drive the plugin's page, not the shell's styling.
 */
import type { ReactNode } from 'react'
// Type-only: erased at runtime, so the real package's types check this stand-in.
import type { SettingsFormProps, SettingsValueField as Field } from '@deepseek-ai/dsh-client-ui-primitives'

export function SettingsForm({ state, labels, onSave, children }: SettingsFormProps) {
  if (!state.available) return <p>{labels.unavailable}</p>
  return (
    <div>
      {state.writable ? null : <p>{labels.readOnly}</p>}
      {children}
      {state.failed ? <p>{labels.saveFailed}</p> : null}
      <button type="button" disabled={!state.dirty || state.invalid || state.saving} onClick={onSave}>
        {state.saving ? labels.saving : labels.save}
      </button>
    </div>
  )
}

export function SettingsValueField(props: Parameters<typeof Field>[0]) {
  return (
    <div>
      <label htmlFor={props.id}>{props.label}</label>
      {props.overridden ? <button type="button" onClick={props.onReset}>{props.resetLabel}</button> : null}
      <input id={props.id} value={props.text} disabled={props.disabled} onChange={(event) => { props.onEdit(event.target.value) }} />
      <p>{props.invalid ? props.invalidLabel : props.hint}</p>
    </div>
  )
}

export function Tag({ children }: { children?: ReactNode }) {
  return <span>{children}</span>
}

const Icon = () => null
export const IconChevronDownOutlineRegular = Icon
export const IconChevronUpOutlineRegular = Icon
export const IconInfoOutlineRegular = Icon
export const IconPlusOutlineRegular = Icon
export const IconWarningTriangleOutlineRegular = Icon
