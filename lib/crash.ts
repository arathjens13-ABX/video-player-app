import { logError } from './log';

type ErrorHandler = (error: unknown, isFatal?: boolean) => void;
declare const ErrorUtils: { getGlobalHandler(): ErrorHandler; setGlobalHandler(handler: ErrorHandler): void } | undefined;

export function describeCrash(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  // Hermes stacks start with the message; don't repeat it.
  const stack = error.stack?.startsWith(`${error.name}: ${error.message}`) ? error.stack : `${error.message}\n${error.stack ?? ''}`;
  return stack.trim();
}

let installed = false;

/**
 * Records uncaught JavaScript errors (including fatal ones, just before the app
 * closes) in the diagnostics log, then lets React Native handle them as usual.
 * Safe to call more than once.
 */
export function installCrashLogging() {
  if (installed || typeof ErrorUtils === 'undefined') return;
  installed = true;
  const previous = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error, isFatal) => {
    logError('crash', `${isFatal ? 'fatal: ' : ''}${describeCrash(error)}`);
    previous(error, isFatal);
  });
}
