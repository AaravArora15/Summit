/**
 * The Summit tab bar, matching design-mockup-v4.html.
 *
 * Five equal tabs. The v3 floating centre orb was removed deliberately: it
 * read as a toy, and Explore does not need a different affordance from the
 * other four. Do not reintroduce it.
 *
 * This is a custom bar rather than expo-router's NativeTabs because the design
 * specifies its own height, icon weight, and type. The tradeoff is that we give
 * up the platform-native bar (and iOS liquid glass) to keep the design intact.
 */
import { BlurView } from 'expo-blur';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  CollectIcon,
  ExploreIcon,
  HomeIcon,
  LeagueIcon,
  ProfileIcon,
} from '@/components/icons';
import { colour, font, size } from '@/theme/tokens';

const ICONS = {
  index: HomeIcon,
  collect: CollectIcon,
  explore: ExploreIcon,
  league: LeagueIcon,
  profile: ProfileIcon,
} as const;

const LABELS = {
  index: 'Home',
  collect: 'Collect',
  explore: 'Explore',
  league: 'League',
  profile: 'Profile',
} as const;

type RouteName = keyof typeof ICONS;

/**
 * Structural props rather than `BottomTabBarProps`.
 *
 * expo-router bundles its own copy of the react-navigation bottom-tabs types.
 * Importing the type from `@react-navigation/bottom-tabs` gives you a second,
 * structurally incompatible copy and a wall of unassignable-header errors.
 * Declaring only what this component actually reads sidesteps both packages.
 */
type TabBarProps = {
  state: {
    index: number;
    routes: { key: string; name: string }[];
  };
  navigation: {
    emit(event: {
      type: 'tabPress';
      target: string;
      canPreventDefault: true;
    }): { defaultPrevented: boolean };
    navigate(name: string): void;
  };
};

export function TabBar({ state, navigation }: TabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <BlurView
      intensity={24}
      tint="light"
      style={[styles.bar, { height: size.tabBar + insets.bottom, paddingBottom: insets.bottom }]}>
      {state.routes.map((route, index) => {
        const name = route.name as RouteName;
        const Icon = ICONS[name];
        if (!Icon) return null;

        const focused = state.index === index;
        const tint = focused ? colour.forest : '#A8A8A2';

        return (
          <Pressable
            key={route.key}
            accessibilityRole="button"
            accessibilityState={focused ? { selected: true } : {}}
            accessibilityLabel={LABELS[name]}
            onPress={() => {
              const event = navigation.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });
              if (!focused && !event.defaultPrevented) {
                navigation.navigate(route.name);
              }
            }}
            style={styles.tab}>
            <Icon size={size.tabIcon} color={tint} />
            <Text
              style={[
                styles.label,
                { color: tint, fontFamily: focused ? font.uiSemi : font.uiMedium },
              ]}>
              {LABELS[name]}
            </Text>
          </Pressable>
        );
      })}
    </BlurView>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingTop: 11,
    paddingHorizontal: 8,
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderTopWidth: 1,
    borderTopColor: colour.line,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    gap: 5,
  },
  label: {
    fontSize: 9.5,
    letterSpacing: 0.08,
  },
});
