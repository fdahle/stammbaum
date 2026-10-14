// Only the flag glyphs: the font is loaded, from this app, where the system has none.
import font from '../node_modules/country-flag-emoji-polyfill/dist/TwemojiCountryFlags.woff2?url';
import { polyfillCountryFlagEmojis } from 'country-flag-emoji-polyfill';

polyfillCountryFlagEmojis('Twemoji Country Flags', font);
