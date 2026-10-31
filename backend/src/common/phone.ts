import { CountryCode, parsePhoneNumberFromString } from 'libphonenumber-js/max';

export interface ParsedPhone {
  /** Digits with country code and no +, the format WhatsApp uses, e.g. 919845662183 */
  digits: string;
  /** ISO country, e.g. IN */
  country: string;
}

/**
 * Cleans up a phone number typed or pasted by a person. Numbers without a country code are read
 * as `defaultCountry` (India unless told otherwise); 11-15 bare digits are also tried as already
 * including a country code (e.g. 919845662183). Returns null when it isn't a real number.
 */
export function parsePhone(input: string, defaultCountry: CountryCode = 'IN'): ParsedPhone | null {
  const cleaned = input.trim().replace(/[\s\-().]/g, '');
  if (!cleaned) return null;
  const candidate = cleaned.startsWith('00') ? `+${cleaned.slice(2)}` : cleaned;

  const attempts = [parsePhoneNumberFromString(candidate, defaultCountry)];
  if (/^\d{11,15}$/.test(candidate)) attempts.push(parsePhoneNumberFromString(`+${candidate}`));

  for (const p of attempts) {
    if (p?.isValid() && p.country) return { digits: p.number.slice(1), country: p.country };
  }
  return null;
}
