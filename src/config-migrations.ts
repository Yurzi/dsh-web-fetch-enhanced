import type z from '@deepseek-ai/schemastery'

/** Configuration format version, independent of the package release version. */
export const CONFIG_SCHEMA_VERSION = 1

type RawConfig = Record<string, unknown>
type Migration = (config: RawConfig) => RawConfig

/** Each step maps version N to N + 1 without adding runtime defaults. */
const migrations: Readonly<Record<number, Migration>> = {
  // v0 is the original unversioned format; v1 only introduces the marker.
  0: config => ({ ...config, schemaVersion: 1 }),
}

/**
 * Upgrade an evaluated configuration in memory. Never mutate or persist the input.
 * Unknown fields and explicit empty arrays survive; validation follows migration.
 */
export function migrateConfig(input: unknown): RawConfig {
  if (input === undefined) input = {}
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('web-fetch-enhanced: config must be an object')
  }
  const raw = input as RawConfig
  const version = raw.schemaVersion === undefined ? 0 : raw.schemaVersion
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0) {
    throw new Error('web-fetch-enhanced: schemaVersion must be a non-negative safe integer')
  }
  if (version > CONFIG_SCHEMA_VERSION) {
    throw new Error(
      'web-fetch-enhanced: config schemaVersion ' + version + ' is newer than supported v' + CONFIG_SCHEMA_VERSION + '; upgrade the plugin before loading this configuration',
    )
  }
  let result = structuredClone(raw)
  for (let current = version; current < CONFIG_SCHEMA_VERSION; current++) {
    const migrate = migrations[current]
    if (!migrate) throw new Error('web-fetch-enhanced: missing config migration from v' + current)
    result = migrate(result)
    if (result.schemaVersion !== current + 1) {
      throw new Error('web-fetch-enhanced: config migration did not advance exactly one version')
    }
  }
  return result
}

/**
 * Keep the object schema visible to Loader diffing and Settings projection while
 * preprocessing BOTH direct calls and Cordis's Standard Schema validation path.
 * A root transform would hide volatile fields from those schema consumers.
 */
export function withConfigMigrations<S extends z>(schema: S): S & ((input: unknown) => ReturnType<S>) {
  return new Proxy(schema, {
    apply(target, thisArg, args: unknown[]) {
      return Reflect.apply(target, thisArg, [migrateConfig(args[0]), ...args.slice(1)])
    },
    get(target, key, receiver) {
      if (key === '~standard') {
        const standard = target['~standard']
        return {
          ...standard,
          validate: (input: unknown) => standard.validate(migrateConfig(input)),
        }
      }
      return Reflect.get(target, key, receiver)
    },
  }) as S & ((input: unknown) => ReturnType<S>)
}
