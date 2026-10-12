import { StyleSheet } from 'react-native';

import { Text, View } from '@/components/Themed';
import { useColors } from '@/components/useColors';

// Placeholder until milestone 3 (in-app browser with video detection).
export default function BrowserScreen() {
  const colors = useColors();
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Browser coming soon</Text>
      <Text style={[styles.body, { color: colors.muted }]}>
        You’ll be able to browse to an episode here and tap a button to download the video it plays. For now,
        paste direct video links in the Downloads tab.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  title: { fontSize: 20, fontWeight: '600', marginBottom: 8 },
  body: { fontSize: 15, textAlign: 'center', lineHeight: 21 },
});
