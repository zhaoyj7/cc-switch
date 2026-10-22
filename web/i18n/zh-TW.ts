import zhTW from "../../src-legacy/i18n/locales/zh-TW.json";
import { withCopyOverrides } from "./copy-overrides";

export default withCopyOverrides(zhTW, {
  "settings.globalProxy.defaultCostMultiplierLabel": "預設倍率（v4 計費不使用）",
  "providerAdvanced.costMultiplierHint":
    "v4 計費已不使用倍率，此值僅原樣儲存（與舊版同步時往返）",
  "providerAdvanced.pricingModelSourceHint":
    "v4 僅依全域計費模式計價，這裡的選擇不影響帳單，僅原樣儲存（與舊版同步時往返）",
});
