import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import { useEffect, useId, useMemo, useState, useSyncExternalStore } from 'react'
import type { LocaleKey } from './locales.ts'

export interface AllowlistSettings {
  allowCidrs?: string[]
  allowHostnames?: string[]
}

export interface AllowlistCardProps {
  scope: SettingsScope<AllowlistSettings>
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

export function hasLayerField(layer: unknown, field: keyof AllowlistSettings): boolean {
  return typeof layer === 'object' && layer !== null && Object.prototype.hasOwnProperty.call(layer, field)
}

export function equalValues(actual: string[] | undefined, expected: readonly string[]): boolean {
  return actual !== undefined && actual.length === expected.length && actual.every((value, index) => value === expected[index])
}

export function isRedundantUserField(user: unknown, field: keyof AllowlistSettings): boolean {
  if (!hasLayerField(user, field)) return false
  const val = layerValues(user, field)
  return Array.isArray(val) && val.length === 0
}

export function parseLines(text: string): { values: string[]; duplicate: boolean } {
  const values = text.split(/\r?\n/u).map(line => line.trim()).filter(Boolean)
  return { values: [...new Set(values)], duplicate: new Set(values).size !== values.length }
}

export function buildSaveOps(
  input: { cidrs: readonly string[]; hostnames: readonly string[] },
  user?: unknown,
  resetToProfile?: boolean,
): SettingsPathOp[] {
  if (resetToProfile) {
    return [
      { op: 'unset', path: ['allowCidrs'] },
      { op: 'unset', path: ['allowHostnames'] },
    ]
  }

  const ops: SettingsPathOp[] = []

  // Prune or update allowCidrs:
  // Set when non-empty; if empty or if user layer contains redundant defaults, unset to prune.
  if (input.cidrs.length > 0) {
    ops.push({ op: 'set', path: ['allowCidrs'], value: [...input.cidrs] })
  } else if (input.cidrs.length === 0 || isRedundantUserField(user, 'allowCidrs')) {
    ops.push({ op: 'unset', path: ['allowCidrs'] })
  }

  // Prune or update allowHostnames:
  // Set when non-empty; if empty or if user layer contains redundant defaults, unset to prune.
  if (input.hostnames.length > 0) {
    ops.push({ op: 'set', path: ['allowHostnames'], value: [...input.hostnames] })
  } else if (input.hostnames.length === 0 || isRedundantUserField(user, 'allowHostnames')) {
    ops.push({ op: 'unset', path: ['allowHostnames'] })
  }

  return ops
}

export function checkAccepted(user: unknown, ops: readonly SettingsPathOp[]): boolean {
  return ops.every(op => {
    const field = op.path[0] as keyof AllowlistSettings
    if (op.op === 'set') {
      return equalValues(layerValues(user, field), op.value)
    }
    return !hasLayerField(user, field)
  })
}

export interface DirtyCheckParams {
  cidrs: string
  hostnames: string
  resolvedCidrs: string
  resolvedHostnames: string
  user?: unknown
  resetToProfile?: boolean
  dismissedPrune?: boolean
}

export function isDirty(params: DirtyCheckParams): boolean {
  if (params.resetToProfile) return true
  if (params.cidrs !== params.resolvedCidrs || params.hostnames !== params.resolvedHostnames) return true
  if (params.dismissedPrune) return false
  const parsedCidrs = parseLines(params.cidrs)
  const parsedHostnames = parseLines(params.hostnames)
  // Check if an unset is needed to prune redundant default values or user overrides that should be cleared
  if (hasLayerField(params.user, 'allowCidrs') && parsedCidrs.values.length === 0) return true
  if (hasLayerField(params.user, 'allowHostnames') && parsedHostnames.values.length === 0) return true
  return false
}

// The configurable-plugins surface owns no card chrome, so an external plugin
// must bring its own. Keep these selectors scoped and use the same semantic
// tokens and measurements as the Host's built-in PluginCard.
const cardCss = ".web-fetch-enhanced-card{list-style:none;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);transition:border-color .16s,background .16s}.web-fetch-enhanced-card:hover{border-color:var(--dsw-alias-label-dimmed)}.web-fetch-enhanced-card[data-open='true']{border-color:var(--dsw-alias-label-dimmed);background:var(--dsw-alias-bg-layer-2)}.web-fetch-enhanced-header{width:100%;appearance:none;border:0;background:none;font:inherit;color:inherit;text-align:left;cursor:pointer;display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:12px}.web-fetch-enhanced-header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}.web-fetch-enhanced-head-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}.web-fetch-enhanced-name{font-size:15px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary)}.web-fetch-enhanced-description{font-size:13px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}.web-fetch-enhanced-pending{flex:none;border-radius:999px;padding:1px 8px;font-size:11px;line-height:17px;font-weight:500;white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary)}.web-fetch-enhanced-chevron{box-sizing:border-box;flex:none;width:8px;height:8px;margin-right:3px;border-right:1.5px solid var(--dsw-alias-label-tertiary);border-bottom:1.5px solid var(--dsw-alias-label-tertiary);transform:rotate(45deg);transition:transform .16s}.web-fetch-enhanced-card[data-open='true'] .web-fetch-enhanced-chevron{transform:rotate(225deg)}.web-fetch-enhanced-body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}.web-fetch-enhanced-field{display:flex;flex-direction:column;gap:6px;padding:12px 0}.web-fetch-enhanced-field+.web-fetch-enhanced-field{border-top:1px solid var(--dsw-alias-border-l2)}.web-fetch-enhanced-label{font-size:13px;font-weight:500;line-height:1.5;color:var(--dsw-alias-label-primary)}.web-fetch-enhanced-textarea{box-sizing:border-box;width:100%;min-height:96px;resize:vertical;padding:9px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-3);font:12px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--dsw-alias-label-primary)}.web-fetch-enhanced-textarea:focus-visible{outline:none;border-color:var(--dsw-alias-brand-primary)}.web-fetch-enhanced-textarea[aria-invalid='true']{border-color:var(--dsw-alias-label-error)}.web-fetch-enhanced-textarea:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}.web-fetch-enhanced-hint{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}.web-fetch-enhanced-invalid,.web-fetch-enhanced-failed{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-error)}.web-fetch-enhanced-readonly{margin:12px 0 0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}.web-fetch-enhanced-footer{display:flex;align-items:center;gap:8px;padding:12px 0 4px;border-top:1px solid var(--dsw-alias-border-l2)}.web-fetch-enhanced-failed{flex:1;min-width:0}.web-fetch-enhanced-actions{margin-left:auto;display:flex;align-items:center;justify-content:flex-end;gap:8px}.web-fetch-enhanced-button{appearance:none;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:5px 14px;background:none;font:inherit;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-secondary);cursor:pointer}.web-fetch-enhanced-button:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}.web-fetch-enhanced-save{border-color:transparent;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}.web-fetch-enhanced-save:hover:not(:disabled){border-color:transparent;color:var(--dsw-alias-bg-layer-3)}.web-fetch-enhanced-button:disabled{opacity:.4;cursor:default}.web-fetch-enhanced-button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}@media(max-width:620px){.web-fetch-enhanced-footer{align-items:stretch;flex-direction:column}.web-fetch-enhanced-actions{width:100%;margin-left:0;flex-wrap:wrap}.web-fetch-enhanced-button{flex:1}.web-fetch-enhanced-pending{display:none}}"

export function AllowlistCard({ scope, t }: AllowlistCardProps) {
  const snapshot = useSyncExternalStore(scope.subscribe.bind(scope), scope.getSnapshot.bind(scope))
  const resolvedCidrs = formatLines(snapshot.value?.allowCidrs)
  const resolvedHostnames = formatLines(snapshot.value?.allowHostnames)
  const [cidrs, setCidrs] = useState(resolvedCidrs)
  const [hostnames, setHostnames] = useState(resolvedHostnames)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const [hasDraft, setHasDraft] = useState(false)
  const [resetToProfile, setResetToProfile] = useState(false)
  const [dismissedPrune, setDismissedPrune] = useState(false)
  const bodyId = useId()
  const cidrsHintId = useId()
  const hostnamesHintId = useId()

  useEffect(() => {
    if (!saving && !hasDraft) {
      setCidrs(resolvedCidrs)
      setHostnames(resolvedHostnames)
    }
  }, [hasDraft, resolvedCidrs, resolvedHostnames, saving])

  const parsedCidrs = useMemo(() => parseLines(cidrs), [cidrs])
  const parsedHostnames = useMemo(() => parseLines(hostnames), [hostnames])
  const dirty = isDirty({
    cidrs,
    hostnames,
    resolvedCidrs,
    resolvedHostnames,
    user: snapshot.user,
    resetToProfile,
    dismissedPrune,
  })
  const invalid = parsedCidrs.duplicate || parsedHostnames.duplicate
  const disabled = snapshot.status !== 'ready' || !snapshot.writable || saving

  const save = async () => {
    if (disabled || !dirty || invalid) return
    setSaving(true)
    setFailed(false)
    let accepted = false
    try {
      const ops = buildSaveOps(
        { cidrs: parsedCidrs.values, hostnames: parsedHostnames.values },
        snapshot.user,
        resetToProfile,
      )
      await scope.mutate(ops)
      const user = scope.getSnapshot().user
      accepted = checkAccepted(user, ops)
    } catch {
      accepted = false
    } finally {
      setSaving(false)
    }
    if (accepted) {
      setHasDraft(false)
      setResetToProfile(false)
      setDismissedPrune(false)
      setOpen(false)
    } else {
      setFailed(true)
    }
  }

  const stageReset = () => {
    if (disabled) return
    setCidrs(formatLines(layerValues(snapshot.base, 'allowCidrs')))
    setHostnames(formatLines(layerValues(snapshot.base, 'allowHostnames')))
    setResetToProfile(true)
    setHasDraft(true)
    setFailed(false)
  }

  const discard = () => {
    setCidrs(resolvedCidrs)
    setHostnames(resolvedHostnames)
    setResetToProfile(false)
    setHasDraft(false)
    setDismissedPrune(true)
    setFailed(false)
  }

  if (snapshot.status === 'unavailable') return null
  const title = t('title')
  return <li className="web-fetch-enhanced-card" data-open={open}>
    <style>{cardCss}</style>
    <button
      type="button"
      className="web-fetch-enhanced-header"
      aria-expanded={open}
      aria-controls={bodyId}
      aria-label={`${t(open ? 'collapse' : 'expand')}: ${title}`}
      onClick={() => { setOpen(value => !value) }}
    >
      <span className="web-fetch-enhanced-head-text">
        <span className="web-fetch-enhanced-name">{title}</span>
        <span className="web-fetch-enhanced-description">{t('description')}</span>
      </span>
      {dirty ? <span className="web-fetch-enhanced-pending">{t('unsaved')}</span> : null}
      <span className="web-fetch-enhanced-chevron" aria-hidden="true" />
    </button>
    {open ? <div className="web-fetch-enhanced-body" id={bodyId}>
      {!snapshot.writable && snapshot.status === 'ready'
        ? <p className="web-fetch-enhanced-readonly" role="status">{t('readOnly')}</p>
        : null}
      <div className="web-fetch-enhanced-field">
        <label className="web-fetch-enhanced-label" htmlFor="web-fetch-enhanced-cidrs">{t('cidrs')}</label>
        <textarea
          id="web-fetch-enhanced-cidrs"
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
            setResetToProfile(false)
            setDismissedPrune(false)
            setHasDraft(value !== resolvedCidrs || hostnames !== resolvedHostnames)
            setFailed(false)
          }}
        />
        <p id={cidrsHintId} className={parsedCidrs.duplicate ? 'web-fetch-enhanced-invalid' : 'web-fetch-enhanced-hint'}>
          {parsedCidrs.duplicate ? t('duplicate') : t('cidrsHint')}
        </p>
      </div>
      <div className="web-fetch-enhanced-field">
        <label className="web-fetch-enhanced-label" htmlFor="web-fetch-enhanced-hostnames">{t('hostnames')}</label>
        <textarea
          id="web-fetch-enhanced-hostnames"
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
            setResetToProfile(false)
            setDismissedPrune(false)
            setHasDraft(cidrs !== resolvedCidrs || value !== resolvedHostnames)
            setFailed(false)
          }}
        />
        <p id={hostnamesHintId} className={parsedHostnames.duplicate ? 'web-fetch-enhanced-invalid' : 'web-fetch-enhanced-hint'}>
          {parsedHostnames.duplicate ? t('duplicate') : t('hostnamesHint')}
        </p>
      </div>
      <div className="web-fetch-enhanced-footer">
        {failed ? <p className="web-fetch-enhanced-failed" role="alert">{t('failed')}</p> : null}
        <div className="web-fetch-enhanced-actions">
          <button type="button" className="web-fetch-enhanced-button" disabled={disabled || resetToProfile} onClick={stageReset}>{t('reset')}</button>
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
    </div> : null}
  </li>
}
