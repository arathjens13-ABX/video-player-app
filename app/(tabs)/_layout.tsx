import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import type { ColorValue } from 'react-native';
import { Tabs } from 'expo-router';

import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

function TabIcon({ name, color }: { name: SymbolViewProps['name']; color: ColorValue }) {
  return <SymbolView name={name} tintColor={color} size={26} />;
}

export default function TabLayout() {
  const colorScheme = useColorScheme();

  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: Colors[colorScheme].tint }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Library',
          tabBarIcon: ({ color }) => (
            <TabIcon
              name={{ ios: 'film.stack', android: 'video_library', web: 'video_library' }}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="discover"
        options={{
          title: 'Discover',
          tabBarIcon: ({ color }) => (
            <TabIcon name={{ ios: 'sparkles.tv', android: 'explore', web: 'explore' }} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="browser"
        options={{
          title: 'Browser',
          headerShown: false,
          tabBarIcon: ({ color }) => (
            <TabIcon name={{ ios: 'globe', android: 'public', web: 'public' }} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="downloads"
        options={{
          title: 'Downloads',
          tabBarIcon: ({ color }) => (
            <TabIcon
              name={{ ios: 'arrow.down.circle', android: 'download', web: 'download' }}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color }) => (
            <TabIcon
              name={{ ios: 'gearshape', android: 'settings', web: 'settings' }}
              color={color}
            />
          ),
        }}
      />
    </Tabs>
  );
}
