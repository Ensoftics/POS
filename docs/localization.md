# Localization

Supported UI languages: **English (`en`)**, **Sinhala (`si`)**, **Tamil (`ta`)**.

## How it works

- One shared package, `packages/i18n` (`src/locales/{en,si,ta}.ts`), used by web and mobile
  through i18next. English is the source; other locales are typed against its shape and fall
  back to English for missing keys. Tests fail if a draft locale uses a key or placeholder that
  English does not have, or if an API error code has no English message.
- Web: the user's explicit choice is stored in `localStorage`; otherwise the business default
  language from settings applies. The switcher only offers languages the business enabled.
  `<html lang>` switches line height and fonts (Noto Sans Sinhala / Noto Sans Tamil).
- Mobile: defaults to the device language.
- Server validation messages are **i18n keys** (e.g. `validation.password.too_short`) and error
  responses carry stable **codes**; clients translate both. The server never returns
  user-facing prose that clients must display verbatim.
- Dates and money use `Intl` with `en-LK` / `si-LK` / `ta-LK` (`INTL_LOCALES`). Currency
  (default LKR) and the business timezone (default Asia/Colombo) are tenant settings; tax rates
  are never hard-coded.

## Translation status

| Locale | Status                                                                  |
| ------ | ----------------------------------------------------------------------- |
| en     | Complete for Slices 0–1                                                 |
| si     | **Draft**, partial (auth, onboarding, navigation). Needs native review. |
| ta     | **Draft**, partial (auth, onboarding, navigation). Needs native review. |

Before pilot release: commission a native-speaker review of both drafts, complete the missing
keys, and review on a real Android device for glyph rendering and truncation.
