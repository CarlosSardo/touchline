import { dateLabel, money, type CurrencyCode } from "../shared/rules.ts";

const SCALE = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 } as const;
// The server writes amounts into messages with rules.money(), i.e. GBP ("£1.2M", "£850K", "-£1,234").
const GBP_AMOUNT = /(-?)£((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)([KMBT])?/g;
// Plain calendar dates only: timestamps ("2026-08-20T10:00Z") and longer digit runs are left alone.
const ISO_DATE = /(?<![\d-])(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])(?![\dT:-])/g;

/** Shows ISO dates inside server-written text as "20 Aug 2026". */
export function localizeDateText(text: string) {
  return text.replace(ISO_DATE, (match) => dateLabel(match));
}

/** Server-written text in the career's display currency and date format. */
export function localizeServerText(text: string, currency: CurrencyCode) {
  return localizeDateText(localizeMoneyText(text, currency));
}

/** Shows the GBP amounts inside server-written text in the career's display currency. */
export function localizeMoneyText(text: string, currency: CurrencyCode) {
  if (currency === "GBP") return text;
  return text.replace(
    GBP_AMOUNT,
    (match, sign: string, digits: string, scale: keyof typeof SCALE | undefined) => {
      const amount =
        Number(digits.replaceAll(",", "")) * (scale ? SCALE[scale] : 1);
      return Number.isFinite(amount)
        ? money(sign ? -amount : amount, false, currency)
        : match;
    },
  );
}
