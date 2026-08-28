import { createMessages, defineLocaleNamespace } from "../../../src/i18n/resolver.ts";
import type { MessageKey } from "../../../src/i18n/types.ts";

const execution = defineLocaleNamespace(
  "execution",
  Object.freeze({
    defaulted: ({ name }: { readonly name: string } = { name: "fallback" }) => name,
    optional: (parameters?: { readonly name: string }) => parameters?.name ?? "missing",
    required: ({ name }: { readonly name: string }) => name,
    zero: (): string => "zero",
  }),
  Object.freeze({
    defaulted: ({ name }: { readonly name: string } = { name: "后备" }) => name,
    optional: (parameters?: { readonly name: string }) => parameters?.name ?? "缺失",
    required: ({ name }: { readonly name: string }) => name,
    zero: (): string => "零",
  }),
);

const messages = createMessages({ namespaces: { execution } });
messages.t("execution", "zero");
messages.t("execution", "required", { name: "Ada" });
messages.t("execution", "defaulted");
messages.t("execution", "defaulted", { name: "Grace" });
messages.t("execution", "optional");
messages.t("execution", "optional", { name: "Lin" });
// @ts-expect-error Required first interpolation values cannot be omitted.
messages.t("execution", "required");

const invalidCatalog = Object.freeze({
  optionalSecond: (first: object, second: object = {}) => `${String(first)}${String(second)}`,
  requiredSecond: (first: object, second: object) => `${String(first)}${String(second)}`,
});
type InvalidKey = MessageKey<typeof invalidCatalog>;
// @ts-expect-error Functions accepting a required second parameter are not message keys.
const requiredSecond: InvalidKey = "requiredSecond";
// @ts-expect-error Functions accepting a defaulted second parameter are not message keys.
const optionalSecond: InvalidKey = "optionalSecond";
void requiredSecond;
void optionalSecond;
