import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet } from 'react-native';

import { Text, View } from '@/components/Themed';
import { extractUrl } from '@/lib/links';
import { routeLink } from '@/lib/route-link';

/**
 * Entry point for links handed to the app from outside:
 * vidstash://open?url=<link>, e.g. from the "Send to VidStash" Shortcut in the
 * iOS share sheet. Web pages open in the browser; video links go to the
 * download form.
 */
export default function OpenLink() {
  const { url } = useLocalSearchParams<{ url?: string }>();

  useEffect(() => {
    const link = url ? extractUrl(url) : null;
    if (!link) {
      router.replace('/');
      return;
    }
    routeLink(link, 'replace').catch(() => router.replace('/'));
  }, [url]);

  return (
    <View style={styles.container}>
      <ActivityIndicator />
      <Text style={styles.text}>Opening link…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  text: { fontSize: 15 },
});
