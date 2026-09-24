import type { ConfigPageForm, PluginConfigViewProps } from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { useEffect, useId, useMemo, useState, useSyncExternalStore } from 'react'
import type { LocaleKey } from './locales.ts'

export interface AllowlistSettings {
  allowCidrs?: string[]
  allowHostnames?: string[]
}

export interface AllowlistCardProps {
  form: ConfigPageForm
  t: (key: LocaleKey) => string
}

export type SettingsPathOp =
  | { op: 'set'; path: string[]; value: string[] }
  | { op: 'unset'; path: string[] }

export function formatLines(value: readonly string[] | undefined): string {
  return (value ?? []).join('\n')
}

export function layerValues(layer: unknown, field: keyof AllowlistSettings): string[] | undefined {
  if (typeof layer !== 'object' || layer === null) return undefined
  const value = Reflect.get(layer, field)
  return Array.isArray(value) && value.every(entry => typeof entry === 'string') ? value : undefined
}

export function parseLines(text: string): { values: string[]; duplicate: boolean } {
  const values = text.split(/\r?\n/u).map(line => line.trim()).filter(Boolean)
  return { values: [...new Set(values)], duplicate: new Set(values).size !== values.length }
}

/** Empty input is an explicit empty profile override, never an implicit reset. */
export function buildSaveOps(
  input: { cidrs: readonly string[]; hostnames: readonly string[] },
  resetToInherited = false,
): SettingsPathOp[] {
  if (resetToInherited) return [
    { op: 'unset', path: ['allowCidrs'] },
    { op: 'unset', path: ['allowHostnames'] },
  ]
  return [
    { op: 'set', path: ['allowCidrs'], value: [...input.cidrs] },
    { op: 'set', path: ['allowHostnames'], value: [...input.hostnames] },
  ]
}

/** The boolean Host result is authoritative, including when recovered values match. */
export async function saveAllowlist(
  form: ConfigPageForm,
  ops: readonly SettingsPathOp[],
  revision: number | undefined,
): Promise<boolean> {
  if (form.state.status !== 'ready' || !form.state.writable || revision === undefined) return false
  try {
    return await form.mutate(ops, revision)
  } catch {
    return false
  }
}

export interface DirtyCheckParams {
  cidrs: string
  hostnames: string
  resolvedCidrs: string
  resolvedHostnames: string
  resetToInherited?: boolean
}

export function isDirty(params: DirtyCheckParams): boolean {
  return Boolean(params.resetToInherited)
    || params.cidrs !== params.resolvedCidrs || params.hostnames !== params.resolvedHostnames
}

/** Subscribe to the bundle's exact Profile entry, including writes and external edits. */
export function AllowlistBundlePage({ configForm, t }: {
  configForm: ConfigForm<Record<string, unknown>>
  t: (key: LocaleKey) => string
}) {
  const store = useMemo(() => ({
    subscribe: (listener: () => void) => configForm.subscribe(listener),
    getSnapshot: () => configForm.getSnapshot(),
    mutate: configForm.mutate.bind(configForm),
  }), [configForm])
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  return <AllowlistPage view="page" form={{ state, mutate: store.mutate }} t={t} />
}

/** Render only the supplied Profile form; never fall back to a global entry. */
export function AllowlistPage({ view, form, t }: PluginConfigViewProps & { t: (key: LocaleKey) => string }) {
  if (view === 'summary') return <>{t('description')}</>
  if (!form || form.state.status === 'unavailable') return <p role="status">{t('unavailable')}</p>
  if (form.state.status === 'loading') return <p role="status">{t('loading')}</p>
  return <AllowlistCard form={form} t={t} />
}

// Match the Host settings page spacing and semantic colors without another card frame.
const cardCss = `
.web-fetch-enhanced-form{color:var(--dsw-alias-label-primary)}
.web-fetch-enhanced-field{display:flex;flex-direction:column;gap:6px;padding:12px 0}
.web-fetch-enhanced-field+.web-fetch-enhanced-field{border-top:.5px solid var(--dsw-alias-border-l2)}
.web-fetch-enhanced-label{font-size:13px;font-weight:500;line-height:1.5}
.web-fetch-enhanced-textarea{box-sizing:border-box;width:100%;min-height:96px;resize:vertical;padding:9px 12px;border:.5px solid var(--dsw-alias-border-l4);border-radius:8px;background:var(--dsw-alias-bg-layer-3);font:12px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--dsw-alias-label-primary)}
.web-fetch-enhanced-textarea:focus-visible{outline:none;border-color:var(--dsw-alias-brand-primary)}
.web-fetch-enhanced-textarea[aria-invalid='true']{border-color:var(--dsw-alias-state-error-primary)}
.web-fetch-enhanced-textarea:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}
.web-fetch-enhanced-hint,.web-fetch-enhanced-status{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.web-fetch-enhanced-invalid,.web-fetch-enhanced-failed{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-state-error-primary)}
.web-fetch-enhanced-readonly{margin:0 0 12px;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.web-fetch-enhanced-footer{display:flex;align-items:center;gap:12px;padding:16px 0 4px}
.web-fetch-enhanced-failed,.web-fetch-enhanced-status{flex:1;min-width:0}
.web-fetch-enhanced-actions{margin-left:auto;display:flex;align-items:center;justify-content:flex-end;gap:8px}
.web-fetch-enhanced-button{appearance:none;border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;padding:5px 14px;background:none;font:inherit;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-secondary);cursor:pointer}
.web-fetch-enhanced-button:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}
.web-fetch-enhanced-save{border-color:transparent;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}
.web-fetch-enhanced-save:hover:not(:disabled){border-color:transparent;color:var(--dsw-alias-bg-layer-3)}
.web-fetch-enhanced-button:disabled{opacity:.4;cursor:default}
.web-fetch-enhanced-button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
@media(max-width:620px){.web-fetch-enhanced-footer{align-items:stretch;flex-direction:column}.web-fetch-enhanced-actions{width:100%;margin-left:0;flex-wrap:wrap}.web-fetch-enhanced-button{flex:1}.web-fetch-enhanced-button:first-child{flex-basis:100%}}
`

export function AllowlistCard({ form, t }: AllowlistCardProps) {
  const snapshot = form.state
  const resolvedCidrs = formatLines(layerValues(snapshot.value, 'allowCidrs'))
  const resolvedHostnames = formatLines(layerValues(snapshot.value, 'allowHostnames'))
  const [cidrs, setCidrs] = useState(resolvedCidrs)
  const [hostnames, setHostnames] = useState(resolvedHostnames)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [failed, setFailed] = useState(false)
  const [hasDraft, setHasDraft] = useState(false)
  const [resetToInherited, setResetToInherited] = useState(false)
  const [draftRevision, setDraftRevision] = useState(snapshot.revision)
  const cidrsId = useId()
  const hostnamesId = useId()
  const cidrsHintId = useId()
  const hostnamesHintId = useId()

  useEffect(() => {
    if (!saving && !hasDraft) {
      setCidrs(resolvedCidrs)
      setHostnames(resolvedHostnames)
      setDraftRevision(snapshot.revision)
    }
  }, [hasDraft, resolvedCidrs, resolvedHostnames, saving, snapshot.revision])

  const parsedCidrs = useMemo(() => parseLines(cidrs), [cidrs])
  const parsedHostnames = useMemo(() => parseLines(hostnames), [hostnames])
  // A refused write must remain discardable even if recovery now matches the draft.
  const dirty = failed || isDirty({
    cidrs,
    hostnames,
    resolvedCidrs,
    resolvedHostnames,
    resetToInherited,
  })
  const invalid = parsedCidrs.duplicate || parsedHostnames.duplicate
  const disabled = snapshot.status !== 'ready' || !snapshot.writable || saving

  const save = async () => {
    if (disabled || !dirty || invalid) return
    setSaving(true)
    setSaved(false)
    setFailed(false)
    const ops = buildSaveOps(
      { cidrs: parsedCidrs.values, hostnames: parsedHostnames.values },
      resetToInherited,
    )
    const accepted = await saveAllowlist(form, ops, draftRevision)
    setSaving(false)
    if (accepted) {
      setHasDraft(false)
      setResetToInherited(false)
      setSaved(true)
    } else {
      setFailed(true)
    }
  }

  const stageReset = () => {
    if (disabled) return
    setCidrs(formatLines(layerValues(snapshot.base, 'allowCidrs')))
    setHostnames(formatLines(layerValues(snapshot.base, 'allowHostnames')))
    setResetToInherited(true)
    setHasDraft(true)
    setFailed(false)
    setSaved(false)
  }

  const discard = () => {
    setCidrs(resolvedCidrs)
    setHostnames(resolvedHostnames)
    setResetToInherited(false)
    setHasDraft(false)
    setFailed(false)
    setSaved(false)
  }

  if (snapshot.status === 'unavailable') return null
  return <section className="web-fetch-enhanced-form" aria-label={t('title')} aria-busy={saving}>
    <style>{cardCss}</style>
    {!snapshot.writable && snapshot.status === 'ready'
      ? <p className="web-fetch-enhanced-readonly" role="status">{t('readOnly')}</p>
      : null}
    <div className="web-fetch-enhanced-field">
      <label className="web-fetch-enhanced-label" htmlFor={cidrsId}>{t('cidrs')}</label>
      <textarea
        id={cidrsId}
        className="web-fetch-enhanced-textarea"
        value={cidrs}
        disabled={disabled}
        placeholder={t('cidrsPlaceholder')}
        aria-describedby={cidrsHintId}
        aria-invalid={parsedCidrs.duplicate || undefined}
        spellCheck={false}
        onChange={(event) => {
          const value = event.target.value
          setCidrs(value)
          setResetToInherited(false)
          setHasDraft(value !== resolvedCidrs || hostnames !== resolvedHostnames)
          setFailed(false)
          setSaved(false)
        }}
      />
      <p id={cidrsHintId} className={parsedCidrs.duplicate ? 'web-fetch-enhanced-invalid' : 'web-fetch-enhanced-hint'}>
        {parsedCidrs.duplicate ? t('duplicate') : t('cidrsHint')}
      </p>
    </div>
    <div className="web-fetch-enhanced-field">
      <label className="web-fetch-enhanced-label" htmlFor={hostnamesId}>{t('hostnames')}</label>
      <textarea
        id={hostnamesId}
        className="web-fetch-enhanced-textarea"
        value={hostnames}
        disabled={disabled}
        placeholder={t('hostnamesPlaceholder')}
        aria-describedby={hostnamesHintId}
        aria-invalid={parsedHostnames.duplicate || undefined}
        autoCapitalize="none"
        spellCheck={false}
        onChange={(event) => {
          const value = event.target.value
          setHostnames(value)
          setResetToInherited(false)
          setHasDraft(cidrs !== resolvedCidrs || value !== resolvedHostnames)
          setFailed(false)
          setSaved(false)
        }}
      />
      <p id={hostnamesHintId} className={parsedHostnames.duplicate ? 'web-fetch-enhanced-invalid' : 'web-fetch-enhanced-hint'}>
        {parsedHostnames.duplicate ? t('duplicate') : t('hostnamesHint')}
      </p>
    </div>
    <div className="web-fetch-enhanced-footer">
      {failed ? <p className="web-fetch-enhanced-failed" role="alert">{t('failed')}</p> : null}
      {!failed ? <p className="web-fetch-enhanced-status" role="status">{dirty ? t('unsaved') : saved ? t('saved') : ''}</p> : null}
      <div className="web-fetch-enhanced-actions">
        <button type="button" className="web-fetch-enhanced-button" disabled={disabled || resetToInherited} onClick={stageReset}>{t('reset')}</button>
        <button
          type="button"
          className="web-fetch-enhanced-button"
          disabled={disabled || !dirty}
          onClick={discard}
        >{t('discard')}</button>
        <button
          type="button"
          className="web-fetch-enhanced-button web-fetch-enhanced-save"
          disabled={disabled || !dirty || invalid}
          onClick={() => { void save() }}
        >{saving ? t('saving') : t('save')}</button>
      </div>
    </div>
  </section>
}
