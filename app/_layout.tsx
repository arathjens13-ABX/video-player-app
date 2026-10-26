import Constants from 'expo-constants';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';

import { useColorScheme } from '@/components/useColorScheme';
import { VideoFinder } from '@/components/VideoFinder';
import { initBatch } from '@/lib/batch';
import { installCrashLogging } from '@/lib/crash';
import { initDownloads } from '@/lib/downloads';
import { logInfo } from '@/lib/log';
import { BUILD } from '@/lib/report';

// Once per launch, when this module loads, before anything renders.
installCrashLogging();
logInfo('app', `start ${Constants.expoConfig?.version ?? '?'} build ${BUILD.slice(0, 7)} ${Platform.OS} ${String(Platform.Version)}`);

// Catch errors thrown while rendering (and record them in the diagnostics log).
export { LoggingErrorBoundary as ErrorBoundary } from '@/components/LoggingErrorBoundary';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();

  useEffect(() => {
    initDownloads();
    initBatch();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="episode-form" options={{ presentation: 'modal', title: 'Episode' }} />
          <Stack.Screen name="show/[key]" options={{ title: '', headerBackTitle: 'Library' }} />
          <Stack.Screen name="rename-show" options={{ presentation: 'modal', title: 'Rename or merge' }} />
          <Stack.Screen name="batch" options={{ presentation: 'modal', title: 'Download several' }} />
          <Stack.Screen name="open" options={{ headerShown: false, animation: 'none' }} />
          <Stack.Screen name="player/[id]" options={{ presentation: 'fullScreenModal', headerShown: false }} />
        </Stack>
        <VideoFinder />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
