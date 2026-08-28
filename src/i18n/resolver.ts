import { enPlanner } from "./locales/en/planner";
import { enShared } from "./locales/en/shared";
import { zhCNPlanner } from "./locales/zh-CN/planner";
import { zhCNShared } from "./locales/zh-CN/shared";
import {
  normalizeLocale,
  type CoreMessageNamespaces,
  type LocaleNamespace,
  type MessageArguments,
  type MessageKey,
  type Messages,
  type MessageValue,
  type NamespaceRegistration,
  type RegisteredNamespaces,
  type SupportedLocale,
} from "./types";

type Catalog = Readonly<Record<string, MessageValue>>;
type RuntimeNamespace = LocaleNamespace<Catalog>;
type RuntimeRegistration = Readonly<Record<string, RuntimeNamespace>>;

const coreRegistration = Object.freeze({
  shared: Object.freeze({ en: enShared, "zh-CN": zhCNShared }),
  planner: Object.freeze({ en: enPlanner, "zh-CN": zhCNPlanner }),
}) satisfies Readonly<{
  shared: LocaleNamespace<typeof enShared>;
  planner: LocaleNamespace<typeof enPlanner>;
}>;

export class MessageContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MessageContractError";
  }
}

function catalogKeys(catalog: object): readonly string[] {
  return Object.keys(catalog).sort();
}

function snapshotNamespace(catalogs: LocaleNamespace<object>): RuntimeNamespace {
  const snapshot = Object.freeze({
    en: Object.freeze({ ...catalogs.en }),
    "zh-CN": Object.freeze({ ...catalogs["zh-CN"] }),
  });
  return snapshot as RuntimeNamespace;
}

export function assertEqualLocaleKeys(
  namespace: string,
  catalogs: LocaleNamespace<object>,
): void {
  const english = catalogKeys(catalogs.en);
  const chinese = catalogKeys(catalogs["zh-CN"]);
  if (english.length !== chinese.length || english.some((key, index) => key !== chinese[index])) {
    throw new MessageContractError(`${namespace}: en and zh-CN message keys are not equal`);
  }
}

export function defineLocaleNamespace<CatalogType extends object>(
  namespace: string,
  english: CatalogType,
  chinese: CatalogType,
): LocaleNamespace<CatalogType> {
  if (namespace.trim() === "") throw new MessageContractError("Message namespace must not be empty");
  const catalogs = snapshotNamespace({ en: english, "zh-CN": chinese }) as LocaleNamespace<CatalogType>;
  assertEqualLocaleKeys(namespace, catalogs);
  return catalogs;
}

function runtimeRegistration(extras: NamespaceRegistration): RuntimeRegistration {
  const registration: Record<string, RuntimeNamespace> = {};
  for (const namespace of Object.keys(extras)) {
    if (Object.prototype.hasOwnProperty.call(coreRegistration, namespace)) {
      throw new MessageContractError(`${namespace}: core message namespace cannot be replaced`);
    }
  }
  for (const [namespace, catalogs] of Object.entries({ ...coreRegistration, ...extras })) {
    if (namespace.trim() === "") throw new MessageContractError("Message namespace must not be empty");
    const snapshot = snapshotNamespace(catalogs);
    assertEqualLocaleKeys(namespace, snapshot);
    registration[namespace] = snapshot;
  }
  return Object.freeze(registration);
}

class MessageResolver<Namespaces extends object> implements Messages<Namespaces> {
  readonly #registration: RuntimeRegistration;
  readonly #listeners = new Set<(locale: SupportedLocale) => void>();
  #locale: SupportedLocale;

  constructor(locale: string, registration: RuntimeRegistration) {
    this.#locale = normalizeLocale(locale);
    this.#registration = registration;
  }

  get locale(): SupportedLocale {
    return this.#locale;
  }

  setLocale(locale: string): boolean {
    const next = normalizeLocale(locale);
    if (next === this.#locale) return false;
    this.#locale = next;
    for (const listener of this.#listeners) listener(next);
    return true;
  }

  subscribe(listener: (locale: SupportedLocale) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  t<Namespace extends keyof Namespaces, Key extends MessageKey<Namespaces[Namespace]>>(
    namespace: Namespace,
    key: Key,
    ...arguments_: MessageArguments<Namespaces[Namespace][Key]>
  ): string {
    const catalogs = this.#registration[String(namespace)];
    const localized = catalogs?.[this.#locale]?.[String(key)];
    const fallback = catalogs?.en[String(key)];
    const message = localized ?? fallback;
    if (message === undefined) {
      throw new MessageContractError(`Missing message ${String(namespace)}.${String(key)}`);
    }
    if (typeof message === "function") {
      const parameters = (arguments_ as readonly unknown[])[0];
      if (parameters !== undefined) return message(parameters as object);
      if (message.length === 0) return (message as () => string)();
      throw new MessageContractError(`Missing interpolation values for ${String(namespace)}.${String(key)}`);
    }
    return message;
  }
}

export interface MessageResolverOptions<Extras extends NamespaceRegistration> {
  readonly locale?: string;
  readonly namespaces?: Extras;
}

export function createMessages<Extras extends NamespaceRegistration = Readonly<Record<never, never>>>(
  options: MessageResolverOptions<Extras> = {},
): Messages<CoreMessageNamespaces & RegisteredNamespaces<Extras>> {
  return new MessageResolver(
    options.locale ?? "en",
    runtimeRegistration(options.namespaces ?? {}),
  );
}
