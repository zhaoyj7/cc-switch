import zh from "../../src-legacy/i18n/locales/zh.json";
import { withCopyOverrides } from "./copy-overrides";

// v4 计费链路不消费倍率，供应商级覆盖也不再读取（上游 provider.rs 的注释写明
// “新版只读全局设置”）。字段仍原样往返，所以必须在 UI 上说清楚。
export default withCopyOverrides(zh, {
  "settings.globalProxy.defaultCostMultiplierLabel": "默认倍率（v4 计费不使用）",
  "providerAdvanced.costMultiplierHint":
    "v4 计费已不使用倍率，此值仅原样保存（与旧版同步时往返）",
  "providerAdvanced.pricingModelSourceHint":
    "v4 只按全局计费模式计价，这里的选择不影响账单，仅原样保存（与旧版同步时往返）",
});
