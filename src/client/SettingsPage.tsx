/**
 * The bundle's configuration on its Plugins page: which private networks
 * web_fetch may reach, the request identity it sends, and its limits. One
 * Save writes everything; leaving the page drops unsaved edits.
 */
import { useId, useState, type ReactNode } from 'react'
import {
  IconChevronDownOutlineRegular, IconChevronUpOutlineRegular, IconInfoOutlineRegular, IconPlusOutlineRegular,
  IconWarningTriangleOutlineRegular, SettingsForm, SettingsValueField, Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { RuleProblem } from '../providers/local/rules.ts'
import { type AllowlistField, type LineReport, appendLine, replaceLine } from './allowlist-lines.ts'
import type { LocaleKey } from './locales.ts'
import type { FetchRoute, FieldName, FieldState, LimitField, SettingsPageFace, SettingsPageState } from './settings-page.ts'

/** Props the slot renderer binds. */
export type SettingsPageProps = InjectFace<SettingsPageFace> & PropsLocale<'settings.webFetchEnhanced'>

type Translate = (key: LocaleKey, params?: Record<string, unknown>) => string

/** A field's state plus the shared control props every field renders with. */
type FieldControl = FieldState & {
  disabled: boolean
  overriddenLabel: string
  resetLabel: string
  onEdit: (text: string) => void
  onReset: () => void
}

/** One-click additions for the most common setup. */
const CIDR_PRESETS = [{ label: 'presetFakeIp', rule: '198.18.0.0/15' }] as const

const LIMITS: readonly LimitField[] = ['timeoutMs', 'maxResponseBytes', 'maxBodyChars', 'maxRedirects']

/**
 * @param props - the page state hook, form actions, and copy.
 * @returns the settings form.
 */
export function SettingsPage(props: SettingsPageProps): ReactNode {
  const t = props.t as Translate
  const state = props.useSettingsPage(snapshot => snapshot)
  const disabled = !state.writable || state.saving
  const control = (name: FieldName): FieldControl => ({
    ...state.fields[name],
    disabled,
    overriddenLabel: t('overridden'),
    resetLabel: t('reset'),
    onEdit: (text) => { props.edit(name, text) },
    onReset: () => { props.reset(name) },
  })
  const cidrLines = state.fields.allowCidrs.text.split('\n').map(line => line.trim())
  return (
    <SettingsForm
      labels={{ unavailable: t('unavailable'), readOnly: t('readOnly'), saveFailed: t('saveFailed'), save: t('save'), saving: t('saving') }}
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <RouteNotice route={state.route} t={t} />
      <Group title={t('accessTitle')} description={t('accessDescription')}>
        <AllowlistInput
          {...control('allowCidrs')}
          field="allowCidrs"
          label={t('cidrs')}
          hint={t('cidrsHint')}
          placeholder={t('cidrsPlaceholder')}
          reports={state.allowlists.allowCidrs.reports}
          presets={CIDR_PRESETS.filter(preset => !cidrLines.includes(preset.rule))
            .map(preset => ({ label: t(preset.label), rule: preset.rule }))}
          t={t}
        />
        <AllowlistInput
          {...control('allowHostnames')}
          field="allowHostnames"
          label={t('hostnames')}
          hint={t('hostnamesHint')}
          placeholder={t('hostnamesPlaceholder')}
          reports={state.allowlists.allowHostnames.reports}
          presets={[]}
          t={t}
        />
      </Group>
      <Group title={t('requestTitle')}>
        <SettingsValueField
          {...control('userAgent')}
          id="web-fetch-enhanced-user-agent"
          label={t('userAgent')}
          hint={t('userAgentHint')}
          invalidLabel={t('userAgentInvalid')}
        />
        <Limits state={state} t={t} control={control} />
      </Group>
    </SettingsForm>
  )
}

function Group({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  const id = useId()
  return (
    <section className="wfe-group" aria-labelledby={id}>
      <h4 id={id} className="wfe-group-title">{title}</h4>
      {description === undefined ? null : <p className="wfe-group-description">{description}</p>}
      {children}
    </section>
  )
}

/** Says so when web_fetch is not routed here, and how to route it back. */
function RouteNotice({ route, t }: { route: FetchRoute; t: Translate }) {
  if (route.kind !== 'deepseek-api' && route.kind !== 'auto') return null
  return (
    <div className="wfe-notice" role="status">
      <IconInfoOutlineRegular size={14} />
      <p>{t(route.kind === 'auto' ? 'routeAuto' : 'routeDeepSeek')}</p>
    </div>
  )
}

/** A one-rule-per-line list with per-line explanations, quick fixes, and presets. */
function AllowlistInput(props: FieldControl & {
  field: AllowlistField
  label: string
  hint: string
  placeholder: string
  reports: readonly LineReport[]
  presets: readonly { label: string; rule: string }[]
  t: Translate
}) {
  const { t } = props
  const id = useId()
  const notesId = useId()
  const rows = Math.min(8, Math.max(3, props.text.split('\n').length + 1))
  return (
    <div className="wfe-field">
      <div className="wfe-field-head">
        <label className="wfe-label" htmlFor={id}>{props.label}</label>
        {props.overridden ? (
          <span className="wfe-badges">
            <Tag tone="neutral">{props.overriddenLabel}</Tag>
            <button type="button" className="wfe-reset" disabled={props.disabled} onClick={props.onReset}>{props.resetLabel}</button>
          </span>
        ) : null}
      </div>
      <textarea
        id={id}
        className="wfe-textarea"
        rows={rows}
        value={props.text}
        placeholder={props.placeholder}
        disabled={props.disabled}
        spellCheck={false}
        autoCapitalize="none"
        aria-invalid={props.invalid || undefined}
        aria-describedby={notesId}
        onChange={(event) => { props.onEdit(event.target.value) }}
      />
      <div id={notesId} className="wfe-notes">
        <p className="wfe-hint">{props.hint}</p>
        {props.reports.length === 0 ? null : (
          <ul className="wfe-lines">
            {props.reports.map(report => (
              <LineNote
                key={report.line + ':' + noteKey(report)}
                report={report}
                field={props.field}
                disabled={props.disabled}
                t={t}
                onFix={(fix) => { props.onEdit(replaceLine(props.text, report.line, fix)) }}
              />
            ))}
          </ul>
        )}
      </div>
      {props.presets.length === 0 || props.disabled ? null : (
        <div className="wfe-presets">
          {props.presets.map(preset => (
            <button key={preset.rule} type="button" className="wfe-chip" onClick={() => { props.onEdit(appendLine(props.text, preset.rule)) }}>
              <IconPlusOutlineRegular size={12} />
              <span>{preset.label}</span>
              <code>{preset.rule}</code>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function noteKey({ note }: LineReport): string {
  return note.kind === 'warning' ? note.warning : note.kind
}

function LineNote({ report, field, disabled, t, onFix }: {
  report: LineReport
  field: AllowlistField
  disabled: boolean
  t: Translate
  onFix: (fix: string) => void
}) {
  const { note } = report
  const fix = note.kind === 'problem' && 'fix' in note.problem ? note.problem.fix : undefined
  const message = note.kind === 'problem' ? problemText(note.problem, field, t)
    : note.kind === 'duplicate' ? t('duplicate', { line: note.of })
      : t(WARNING_KEYS[note.warning])
  return (
    <li className="wfe-line" data-severity={note.kind === 'warning' ? 'warning' : 'error'}>
      <IconWarningTriangleOutlineRegular size={12} />
      <span className="wfe-line-text">
        <span className="wfe-line-ref">{t('lineLabel', { line: report.line })}</span>
        <code>{report.text}</code>
        <span>{message}</span>
        {fix === undefined ? null : (
          <button type="button" className="wfe-line-fix" disabled={disabled} onClick={() => { onFix(fix) }}>
            {t('fix', { fix })}
          </button>
        )}
      </span>
    </li>
  )
}

const WARNING_KEYS = {
  metadata: 'warningMetadata',
  loopback: 'warningLoopback',
  broad: 'warningBroad',
  public: 'warningPublic',
} as const satisfies Record<string, LocaleKey>

function problemText(problem: RuleProblem, field: AllowlistField, t: Translate): string {
  switch (problem.code) {
    case 'syntax': return t(field === 'allowCidrs' ? 'problemSyntaxCidr' : 'problemSyntaxHostname')
    case 'ipv4-form': return t('problemIpv4Form')
    case 'zone': return t('problemZone')
    case 'mapped': return t('problemMapped')
    case 'host-bits': return t('problemHostBits')
    case 'wildcard': return t('problemWildcard')
    case 'wildcard-ip': return t('problemWildcardIp')
    case 'not-hostname': return t('problemNotHostname')
  }
}

/** Resource limits, folded away until asked for; unfolded while one is invalid. */
function Limits({ state, t, control }: { state: SettingsPageState; t: Translate; control: (name: FieldName) => FieldControl }) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const customized = LIMITS.some(name => state.fields[name].overridden)
  const expanded = open || LIMITS.some(name => state.fields[name].invalid)
  return (
    <div className="wfe-disclosure">
      <button type="button" className="wfe-disclosure-toggle" aria-expanded={expanded} aria-controls={panelId} onClick={() => { setOpen(!expanded) }}>
        <span className="wfe-label">{t('limitsTitle')}</span>
        {customized ? <Tag tone="neutral">{t('overridden')}</Tag> : null}
        {expanded ? <IconChevronUpOutlineRegular size={14} /> : <IconChevronDownOutlineRegular size={14} />}
      </button>
      {expanded ? (
        <div id={panelId} className="wfe-disclosure-panel">
          <p className="wfe-hint">{t('limitsHint')}</p>
          {LIMITS.map(name => (
            <SettingsValueField
              key={name}
              {...control(name)}
              id={'web-fetch-enhanced-' + name}
              label={t(name)}
              invalidLabel={t('invalidInteger')}
              numeric
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}