import type z from '@deepseek-ai/schemastery'

/** Configuration format version, independent of the package and DSH versions. */
export const CONFIG_SCHEMA_VERSION = 1

type RawConfig = Record<string, unknown>

/** Each step upgrades version N to N + 1 without adding runtime defaults. */
const migrations: Readonly<Record<number, (config: RawConfig) => RawConfig>> = {
  // v0 is the original unversioned format; v1 only introduces the marker.
  0: config => ({ ...config, schemaVersion: 1 }),
}

/**
 * Upgrade an evaluated configuration in memory. The input is never mutated or
 * persisted; unknown fields and explicit empty arrays survive, and validation
 * runs on the result.
 * @param input - raw row config; undefined counts as an empty v0 config.
 * @returns the config in the current format.
 */
export function migrateConfig(input: unknown = {}): RawConfig {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('web-fetch-enhanced: config must be an object')
  }
  const version = (input as RawConfig).schemaVersion ?? 0
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0) {
    throw new Error('web-fetch-enhanced: schemaVersion must be a non-negative integer')
  }
  if (version > CONFIG_SCHEMA_VERSION) {
    throw new Error(`web-fetch-enhanced: config schemaVersion ${version} is newer than supported v${CONFIG_SCHEMA_VERSION}; upgrade the plugin`)
  }
  let config = structuredClone(input as RawConfig)
  for (let current = version; current < CONFIG_SCHEMA_VERSION; current++) {
    config = migrations[current]!(config)
  }
  return config
}

/**
 * Run migrations ahead of both ways a schema validates — calling it, and the
 * Standard Schema `validate` the Loader and Settings use — while keeping the
 * object schema itself visible. A root transform would hide the fields, and
 * with them the volatile metadata Settings projects into forms.
 * @param schema - the current-format object schema.
 * @returns the same schema, migrating its input first.
 */
export function withConfigMigrations<S extends z>(schema: S): S & ((input?: unknown) => ReturnType<S>) {
  return new Proxy(schema, {
    apply: (target, thisArg, [input, ...rest]: unknown[]) => Reflect.apply(target, thisArg, [migrateConfig(input), ...rest]),
    get(target, key, receiver) {
      if (key !== '~standard') return Reflect.get(target, key, receiver)
      const standard = target['~standard']
      return { ...standard, validate: (input: unknown) => standard.validate(migrateConfig(input)) }
    },
  }) as S & ((input?: unknown) => ReturnType<S>)
}
