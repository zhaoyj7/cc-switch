import ja from "../../src-legacy/i18n/locales/ja.json";
import { withCopyOverrides } from "./copy-overrides";

export default withCopyOverrides(ja, {
  "settings.globalProxy.defaultCostMultiplierLabel": "デフォルト倍率（v4 課金では未使用）",
  "providerAdvanced.costMultiplierHint":
    "v4 の課金計算では倍率を使用しません。この値は保存されるだけです（旧バージョンとの同期で往復します）",
  "providerAdvanced.pricingModelSourceHint":
    "v4 はグローバルな課金モードでのみ計算します。ここでの選択は請求に影響せず、保存されるだけです（旧バージョンとの同期で往復します）",
});
