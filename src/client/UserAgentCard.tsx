import { useEffect, useId, useState } from 'react'
import type { AllowlistCardProps } from './AllowlistCard.tsx'
import { DEFAULT_USER_AGENT, isValidUserAgent } from '../user-agent.ts'

/** Read resolved Profile values, preserving explicit empty overrides. */
export function layerUserAgent(layer: unknown): string {
  if (typeof layer !== 'object' || layer === null) return DEFAULT_USER_AGENT
  const value: unknown = Reflect.get(layer, 'userAgent')
  return typeof value === 'string' ? value : DEFAULT_USER_AGENT
}

/** UA mutations deliberately never touch the address allowlists. */
export function buildUserAgentOps(value: string, resetToInherited = false) {
  return resetToInherited
    ? [{ op: 'unset' as const, path: ['userAgent'] }]
    : [{ op: 'set' as const, path: ['userAgent'], value }]
}

export function UserAgentCard({ form, t }: AllowlistCardProps) {
  const snapshot = form.state
  const resolved = layerUserAgent(snapshot.value)
  const [value, setValue] = useState(resolved)
  const [hasDraft, setHasDraft] = useState(false)
  const [resetToInherited, setResetToInherited] = useState(false)
  const [revision, setRevision] = useState(snapshot.revision)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [failed, setFailed] = useState(false)
  const id = useId()
  const hintId = useId()

  useEffect(() => {
    if (!saving && !hasDraft) {
      setValue(resolved)
      setRevision(snapshot.revision)
    }
  }, [saving, hasDraft, resolved, snapshot.revision])

  const disabled = snapshot.status !== 'ready' || !snapshot.writable || saving
  const dirty = failed || resetToInherited || value !== resolved
  const invalid = !isValidUserAgent(value)

  const save = async () => {
    if (disabled || !dirty || invalid || revision === undefined) return
    setSaving(true)
    setSaved(false)
    setFailed(false)
    let accepted = false
    try {
      accepted = await form.mutate(buildUserAgentOps(value, resetToInherited), revision)
    } catch {
      // A transport failure must not erase the draft or be reported as success.
    }
    setSaving(false)
    if (accepted) {
      setHasDraft(false)
      setResetToInherited(false)
      setSaved(true)
    } else {
      setFailed(true)
    }
  }

  const discard = () => {
    if (disabled) return
    setValue(resolved)
    setHasDraft(false)
    setResetToInherited(false)
    setFailed(false)
    setSaved(false)
  }

  if (snapshot.status === 'unavailable') return null
  return <section aria-label={t('userAgent')} aria-busy={saving}>
    <div className="web-fetch-enhanced-field">
      <label className="web-fetch-enhanced-label" htmlFor={id}>{t('userAgent')}</label>
      <input id={id} type="text" className="web-fetch-enhanced-input" value={value}
        disabled={disabled} aria-describedby={hintId} aria-invalid={invalid || undefined}
        autoCapitalize="none" autoComplete="off" spellCheck={false}
        onChange={event => {
          setValue(event.target.value)
          setHasDraft(event.target.value !== resolved)
          setResetToInherited(false)
          setFailed(false)
          setSaved(false)
        }} />
      <p id={hintId} className={invalid ? 'web-fetch-enhanced-invalid' : 'web-fetch-enhanced-hint'}>
        {invalid ? t('userAgentInvalid') : t('userAgentHint')}
      </p>
    </div>
    <div className="web-fetch-enhanced-footer">
      {failed ? <p className="web-fetch-enhanced-failed" role="alert">{t('failed')}</p>
        : <p className="web-fetch-enhanced-status" role="status">{dirty ? t('unsaved') : saved ? t('saved') : ''}</p>}
      <div className="web-fetch-enhanced-actions">
        <button type="button" className="web-fetch-enhanced-button" disabled={disabled || resetToInherited}
          onClick={() => {
            if (disabled) return
            setValue(layerUserAgent(snapshot.base))
            setResetToInherited(true)
            setHasDraft(true)
            setFailed(false)
            setSaved(false)
          }}>{t('userAgentReset')}</button>
        <button type="button" className="web-fetch-enhanced-button" disabled={disabled || !dirty}
          onClick={discard}>{t('userAgentDiscard')}</button>
        <button type="button" className="web-fetch-enhanced-button web-fetch-enhanced-save" disabled={disabled || !dirty || invalid}
          onClick={() => { void save() }}>{saving ? t('saving') : t('userAgentSave')}</button>
      </div>
    </div>
  </section>
}
