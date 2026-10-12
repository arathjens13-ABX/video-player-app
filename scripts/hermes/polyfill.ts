// Mirrors what Expo's runtime installs before app code runs.
import { TextDecoder } from '../../node_modules/expo/src/winter/TextDecoder';
const g = globalThis as unknown as Record<string, unknown>;
if (typeof g.TextDecoder === 'undefined') g.TextDecoder = TextDecoder;
