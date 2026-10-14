import { ErrorBoundary as RouterErrorBoundary, type ErrorBoundaryProps } from 'expo-router';
import { useEffect } from 'react';

import { describeCrash } from '@/lib/crash';
import { logError } from '@/lib/log';

/**
 * Expo Router's error screen, plus a diagnostics entry: errors thrown while
 * rendering are caught here and never reach the global crash handler.
 */
export function LoggingErrorBoundary(props: ErrorBoundaryProps) {
  useEffect(() => {
    logError('crash', `screen error: ${describeCrash(props.error)}`);
  }, [props.error]);
  return <RouterErrorBoundary {...props} />;
}
