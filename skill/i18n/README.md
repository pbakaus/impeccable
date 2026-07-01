# Impeccable Live Mode — Translations

This directory contains UI translations for Impeccable Live Mode.

## Usage

1. Copy the desired translation file (e.g., `ru.json`) to your project root as `live_translations.json`
2. The Live Mode server will automatically load translations from this file

## Available Languages

- `ru.json` — Russian

## Contributing

To add a new language:

1. Copy `en.json` (or any existing translation) to `<language_code>.json`
2. Translate all values
3. Submit a PR

## Format

The translation file is a simple JSON object:

```json
{
  "Original English text": "Translated text"
}
```

Keys are case-sensitive and must match exactly.
