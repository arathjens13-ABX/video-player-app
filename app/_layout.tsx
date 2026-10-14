import Constants from 'expo-constants';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import 'react-native-reanimated';

import { useColorScheme } from '@/components/useColorScheme';
import { initDownloads } from '@/lib/downloads';
import { logError, logInfo } from '@/lib/log';
import { BUILD } from '@/lib/report';

type ErrorHandler = (error: unknown, isFatal?: boolean) => void;
declare const ErrorUtils: { getGlobalHandler(): ErrorHandler; setGlobalHandler(handler: ErrorHandler): void } | undefined;

/** Records uncaught errors (and crashes) in the diagnostics log before React Native handles them. */
function installCrashLogging() {
  if (typeof ErrorUtils === 'undefined') return;
  const previous = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error, isFatal) => {
    logError('crash', `${isFatal ? 'fatal ' : ''}${error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error)}`);
    previous(error, isFatal);
  });
}

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();

  useEffect(() => {
    logInfo('app', `start ${Constants.expoConfig?.version ?? '?'} build ${BUILD.slice(0, 7)} ${Platform.OS} ${String(Platform.Version)}`);
    installCrashLogging();
    initDownloads();
  }, []);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="episode-form" options={{ presentation: 'modal', title: 'Episode' }} />
        <Stack.Screen name="open" options={{ headerShown: false, animation: 'none' }} />
        <Stack.Screen
          name="player/[id]"
          options={{ presentation: 'fullScreenModal', headerShown: false }}
        />
      </Stack>
    </ThemeProvider>
  );
}
