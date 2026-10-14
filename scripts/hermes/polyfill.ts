// Mirrors what Expo's runtime installs before app code runs.
import { TextDecoder } from '../../node_modules/expo/src/winter/TextDecoder';
const g = globalThis as unknown as Record<string, unknown>;
if (typeof g.TextDecoder === 'undefined') g.TextDecoder = TextDecoder;

// React Native installs AbortController (from the abort-controller package) during startup.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ac = require('../../node_modules/abort-controller/dist/abort-controller.js');
if (typeof g.AbortController === 'undefined') {
  g.AbortController = ac.AbortController;
  g.AbortSignal = ac.AbortSignal;
}
