/**
 * The WHATWG URL implementation, imported explicitly. React Native's built-in
 * URL glues relative links onto the base instead of resolving them
 * ("index.m3u8" + "seg0.ts" -> "index.m3u8/seg0.ts"), which would break nearly
 * every HLS playlist. Expo normally installs this same polyfill globally; using
 * it directly means the app and the tests run identical URL handling either way.
 */
export { URL, URLSearchParams } from 'whatwg-url-minimum';
