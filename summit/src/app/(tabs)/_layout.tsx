import { Tabs } from 'expo-router';

import { TabBar } from '@/components/tab-bar';

/**
 * Tab order matches the v4 mockup: Home, Collect, Explore, League, Profile.
 * Explore sits in the centre because it is the core action, but it is styled
 * identically to the other four (see tab-bar.tsx).
 */
export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <TabBar {...props} />}>
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="collect" options={{ title: 'Collect' }} />
      <Tabs.Screen name="explore" options={{ title: 'Explore' }} />
      <Tabs.Screen name="league" options={{ title: 'League' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
    </Tabs>
  );
}
