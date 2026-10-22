import en from "../../src-legacy/i18n/locales/en.json";
import { withCopyOverrides } from "./copy-overrides";

export default withCopyOverrides(en, {
  "settings.globalProxy.defaultCostMultiplierLabel":
    "Default Multiplier (unused in v4 billing)",
  "providerAdvanced.costMultiplierHint":
    "v4 billing no longer applies multipliers; this value is only stored (it round-trips when syncing with older versions)",
  "providerAdvanced.pricingModelSourceHint":
    "v4 prices everything with the global pricing mode; this choice does not affect billing, it is only stored (it round-trips when syncing with older versions)",
});
