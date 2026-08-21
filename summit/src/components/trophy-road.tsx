/**
 * The trophy road: where a climber's level sits, and how close the next one
 * is.
 *
 * Not from the v4 mockup. Screen 26 (Profile) shows a level and a plain
 * percentage bar; this replaces that bar with a small stretch of the path
 * itself, so "72% to level 13" is also a shape you can read at a glance
 * rather than a single number to interpret. It borrows the mockup's own
 * grammar rather than inventing a new one: hairline track, no shadows, the
 * same forest/sand pairing the rest of the passport uses for "held" vs "not
 * yet".
 *
 * Shows the current level and the three after it. The current stop is always
 * first and always full — it is behind you — and only the segment leading out
 * of it is partial; everything further out is unwalked road.
 */
import { StyleSheet, Text, View } from 'react-native';

import { colour, font } from '@/theme/tokens';

const DOT = 32;
const STOPS_AHEAD = 3;

export function TrophyRoad({ level, progress }: { level: number; progress: number }) {
  const clamped = Math.max(0, Math.min(1, progress));
  const stops = Array.from({ length: STOPS_AHEAD + 1 }, (_, i) => level + i);

  return (
    <View style={styles.road}>
      {stops.map((stopLevel, i) => (
        <View key={stopLevel} style={styles.segment}>
          <View style={styles.dotRow}>
            <View style={[styles.dot, i === 0 && styles.dotCurrent]}>
              <Text style={[styles.dotLabel, i === 0 && styles.dotLabelCurrent]}>
                {stopLevel}
              </Text>
            </View>
            {i < stops.length - 1 ? (
              <View style={styles.track}>
                {/* Only the segment leaving the current stop is ever partial;
                    every later one is either fully walked (never, since the
                    current stop is always index 0) or fully open road. */}
                <View style={[styles.trackFill, { width: i === 0 ? `${clamped * 100}%` : '0%' }]} />
              </View>
            ) : null}
          </View>
          <Text style={[styles.stopLabel, i === 0 && styles.stopLabelCurrent]} numberOfLines={1}>
            {i === 0 ? 'You' : `Lv ${stopLevel}`}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  road: { flexDirection: 'row', alignItems: 'flex-start' },

  // Each stop owns the track segment leaving it, so the row is just N equal
  // columns rather than N dots plus N-1 separately-sized connectors.
  segment: { flex: 1, minWidth: 0 },

  dotRow: { flexDirection: 'row', alignItems: 'center' },

  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    borderWidth: 1.5,
    borderColor: colour.n200,
    backgroundColor: colour.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotCurrent: {
    borderColor: colour.forest,
    backgroundColor: colour.forest,
  },
  dotLabel: {
    fontFamily: font.uiSemi,
    fontSize: 11,
    color: colour.dim,
  },
  dotLabelCurrent: { color: colour.sand },

  track: {
    flex: 1,
    height: 3,
    borderRadius: 99,
    backgroundColor: colour.n200,
    marginHorizontal: 4,
    overflow: 'hidden',
  },
  trackFill: {
    height: '100%',
    borderRadius: 99,
    backgroundColor: colour.sand,
  },

  stopLabel: {
    marginTop: 5,
    fontFamily: font.uiMedium,
    fontSize: 10,
    letterSpacing: 0.3,
    color: colour.dim,
  },
  stopLabelCurrent: { color: colour.forest, fontFamily: font.uiSemi },
});
