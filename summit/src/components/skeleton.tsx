/**
 * A placeholder for content that hasn't loaded yet: a soft, breathing block
 * roughly the shape of what's coming.
 *
 * Reanimated's shared-value loop, not the classic Animated API: a UI-thread
 * loop keeps pulsing smoothly even while the JS thread is busy — which is
 * exactly the moment a skeleton is on screen, mid-fetch.
 */
import { useEffect } from 'react';
import { StyleSheet, View, type DimensionValue } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { colour } from '@/theme/tokens';

type SkeletonProps = {
  width?: DimensionValue;
  height?: number;
  radius?: number;
};

export function Skeleton({ width = '100%', height = 14, radius = 6 }: SkeletonProps) {
  const progress = useSharedValue(0);

  useEffect(() => {
    // Reverses rather than snapping back to 0, so it reads as a slow breath
    // rather than a blink.
    progress.value = withRepeat(
      withTiming(1, { duration: 900, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [progress]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: 0.5 + progress.value * 0.35,
  }));

  return (
    <Animated.View style={[styles.base, { width, height, borderRadius: radius }, animatedStyle]} />
  );
}

/** A stack of skeleton text lines, the last one shorter — reads as a
 *  paragraph or label rather than a set of identical bars. */
export function SkeletonLines({ lines = 2, gap = 6 }: { lines?: number; gap?: number }) {
  return (
    <View style={{ gap }}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} height={12} width={i === lines - 1 ? '55%' : '100%'} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  base: { backgroundColor: colour.n200 },
});
