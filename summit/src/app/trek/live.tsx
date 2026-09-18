/**
 * Live trek, screen 09 of the v4 mockup.
 *
 * The screen someone glances at mid-walk, one-handed, in sunlight. So: three
 * numbers at size, one action, and nothing that needs reading.
 *
 * It ticks once a second and re-reads the track from SQLite rather than
 * accumulating in memory, because the background task writing those points runs
 * in a different JS context and cannot push into this one.
 */
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Card, Chip, Data, H2, Label, Small } from '@/components/ui';
import { haversineM } from '@/features/trek/distance';
import { formatPace } from '@/features/trek/run-stats';
import { elapsedSeconds, formatDuration, useTrek } from '@/features/trek/store';
import { wildcardBearing, type WildcardBearingRow } from '@/lib/supabase';
import { colour, space } from '@/theme/tokens';

/** The claim circle the server judges, from claim_location()'s
 *  c_default_radius_m. Locations can override it server-side; the client is
 *  not told, so this stays an honest "about" figure either way. */
const CLAIM_RADIUS_M = 90;

/** How often to ask wildcard_bearing() for a fresh reading. A live compass
 *  that updates every second would read as smooth; every 5 is what keeps a
 *  walk-long screen from hammering the database over what is, at walking
 *  pace, barely a different answer second to second. */
const BEARING_POLL_MS = 5000;

/** "820 m" below a kilometre, "1.3 km" above — same threshold and rounding
 *  the public-pin countdown already used inline, now shared with the
 *  Wildcard compass below. */
function formatMetres(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

export default function LiveTrekScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const {
    phase,
    targetName,
    targetIsSecret,
    targetIsWildcard,
    targetLat,
    targetLng,
    paused,
    movingMs,
    segmentStartedAt,
    distanceM,
    points,
    withPartner,
    refresh,
    pause,
    resume,
    arrive,
  } = useTrek();
  const [, forceTick] = useState(0);
  // The device's own compass heading (degrees clockwise from north the
  // *phone* currently faces), so the Wildcard arrow can rotate to a
  // relative "turn this way" rather than an absolute one nobody can act on
  // without already carrying a compass. Null on a device/simulator with no
  // heading sensor — the arrow still rotates to the raw bearing, just
  // without correcting for which way the phone happens to be pointed.
  const [heading, setHeading] = useState<number | null>(null);
  const [bearing, setBearing] = useState<WildcardBearingRow | null>(null);
  const lastBearingPollAt = useRef(0);

  useEffect(() => {
    if (phase !== 'recording' || paused) return;
    const timer = setInterval(() => {
      refresh();
      forceTick((n) => n + 1); // elapsed is derived from the clock, not stored

      // Piggybacks on the tick this screen already runs every second rather
      // than a second timer — just throttled, since a hidden target's
      // distance has to come from the server on every reading instead of a
      // free client-side haversine.
      if (targetIsWildcard && Date.now() - lastBearingPollAt.current >= BEARING_POLL_MS) {
        lastBearingPollAt.current = Date.now();
        const last = useTrek.getState().points.at(-1);
        if (last) {
          wildcardBearing(last.lat, last.lng)
            .then((result) => setBearing(result))
            .catch(() => {
              // A dropped poll just leaves the last known reading on
              // screen rather than blanking a live compass over one bad
              // request — the next tick tries again in BEARING_POLL_MS.
            });
        }
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [phase, paused, refresh, targetIsWildcard]);

  useEffect(() => {
    if (!targetIsWildcard) return;
    let subscription: Location.LocationSubscription | null = null;
    let cancelled = false;
    Location.watchHeadingAsync((h) => {
      const value = h.trueHeading >= 0 ? h.trueHeading : h.magHeading >= 0 ? h.magHeading : null;
      setHeading(value);
    })
      .then((sub) => {
        if (cancelled) sub.remove();
        else subscription = sub;
      })
      .catch(() => {
        // No compass on this device — see the heading state's own comment.
      });
    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [targetIsWildcard]);

  const elapsed = elapsedSeconds({ movingMs, segmentStartedAt });
  const km = (distanceM / 1000).toFixed(2);
  const pace = distanceM > 50 ? formatPace(elapsed, distanceM) : '--';

  // Live gap to the pin, from the newest saved fix. A public location shows a
  // real countdown; a secret spot cannot (its stored coordinates are the
  // fuzzed fence centre), so it gets a zone prompt instead of metres that
  // would point at the wrong place; a Wildcard hunt gets the compass below
  // instead, built from `bearing` rather than this client-known target.
  let toTarget: string | null = null;
  let inCircle = false;
  if (!targetIsSecret && !targetIsWildcard && targetLat !== null && targetLng !== null && points.length > 0) {
    const last = points[points.length - 1];
    const m = haversineM({ lat: last.lat, lng: last.lng }, { lat: targetLat, lng: targetLng });
    toTarget = formatMetres(m);
    inCircle = m <= CLAIM_RADIUS_M;
  }

  // The arrow's screen rotation: bearing is absolute (clockwise from true
  // north); subtracting the phone's own heading turns that into "turn this
  // many degrees from however you're already facing" — the only version of
  // this number that's actually walkable without a separate compass in
  // hand. Falls back to the raw bearing when there's no heading reading.
  const wildcardArrowDeg =
    bearing?.bearing_deg != null ? bearing.bearing_deg - (heading ?? 0) : 0;
  const wildcardInCircle = bearing !== null && bearing.distance_m <= CLAIM_RADIUS_M;

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 20 }]}>
      <View style={styles.header}>
        <Label style={{ color: colour.sand }}>
          {paused ? 'Paused' : targetIsWildcard ? 'Hunting' : targetName ? 'Trekking to' : 'Trekking'}
        </Label>
        <H2 style={{ color: colour.n50, marginTop: 2 }}>
          {targetIsWildcard ? "Today's Wildcard" : (targetName ?? 'Free walk')}
        </H2>
      </View>

      <View style={styles.stats}>
        <Stat label="Time" value={formatDuration(elapsed)} />
        <Stat label="Distance" value={km} unit="km" />
        <Stat label="Pace" value={pace} unit="/km" />
      </View>

      {/* The countdown that settles "am I there yet?". Public pins show real
          metres off the newest saved fix; secret spots show only the zone,
          because their stored coordinates are deliberately fuzzed and metres
          would point at the wrong place. */}
      {!targetIsSecret && toTarget !== null ? (
        <Card variant="ink" style={styles.target}>
          <Label style={{ color: 'rgba(242,242,238,0.6)' }}>
            {targetName ? `${targetName} · ${inCircle ? 'at the pin' : 'to the pin'}` : 'To the pin'}
          </Label>
          <View style={styles.statValue}>
            <Data style={{ fontSize: 34, color: inCircle ? colour.sand : colour.n50 }}>
              {toTarget}
            </Data>
          </View>
          <Small
            style={{
              color: inCircle ? colour.sand : 'rgba(242,242,238,0.75)',
              marginTop: 3,
            }}>
            {inCircle
              ? 'Inside the circle · hold still about 45 s to claim'
              : `Claims need you inside about ${CLAIM_RADIUS_M} m`}
          </Small>
        </Card>
      ) : null}
      {targetIsSecret ? (
        <Card variant="ink" style={styles.target}>
          <Label style={{ color: 'rgba(242,242,238,0.6)' }}>The hunt</Label>
          <Small style={{ color: 'rgba(242,242,238,0.75)', marginTop: 3 }}>
            Somewhere inside this zone. No metres shown: the exact spot is yours to find.
          </Small>
        </Card>
      ) : null}
      {/* The compass: distance and direction toward the hidden Wildcard pick,
          never the pick itself. bearing_deg comes from wildcard_bearing()
          (0024), which computes it server-side against the real geometry —
          this screen never learns where the target actually is, only how
          far and which way from wherever it just said it stood. */}
      {targetIsWildcard ? (
        <Card variant="ink" style={styles.target}>
          <Label style={{ color: 'rgba(242,242,238,0.6)' }}>
            {bearing ? (wildcardInCircle ? 'At the spot' : 'Follow the arrow') : 'Finding it'}
          </Label>
          {bearing ? (
            <>
              <View style={styles.compassRow}>
                <View style={[styles.compassArrow, { transform: [{ rotate: `${wildcardArrowDeg}deg` }] }]}>
                  <Text style={styles.compassGlyph}>▲</Text>
                </View>
                <Data style={{ fontSize: 34, color: wildcardInCircle ? colour.sand : colour.n50 }}>
                  {formatMetres(bearing.distance_m)}
                </Data>
              </View>
              <Small
                style={{
                  color: wildcardInCircle ? colour.sand : 'rgba(242,242,238,0.75)',
                  marginTop: 3,
                }}>
                {wildcardInCircle
                  ? 'Inside the circle · hold still about 45 s to claim'
                  : `The arrow points the way · inside about ${CLAIM_RADIUS_M} m to claim`}
              </Small>
            </>
          ) : (
            <Small style={{ color: 'rgba(242,242,238,0.75)', marginTop: 3 }}>
              Waiting for a GPS fix to take the first reading.
            </Small>
          )}
        </Card>
      ) : null}

      {/* Honesty about the data, in the one place it matters. A trek with no
          fixes yet looks identical to a broken one unless you say so. */}
      <Card variant="ink" style={styles.status}>
        <Label style={{ color: 'rgba(242,242,238,0.6)' }}>{paused ? 'Paused' : 'Recording'}</Label>
        <Small style={{ color: 'rgba(242,242,238,0.75)', marginTop: 3 }}>
          {paused
            ? 'Not logging position or distance. Resume when you start moving again.'
            : points.length === 0
              ? 'Waiting for a GPS fix. Under tree cover this can take a minute.'
              : `${points.length} points logged. Saved on the phone, uploaded when you have signal.`}
        </Small>
      </Card>

      {/* Self-reported, honour system — see the "with one other person"
          multiplier in award_claim_points(). Toggleable mid-walk since a
          partner can join partway through. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Walking with someone else"
        onPress={() => useTrek.getState().setWithPartner(!withPartner)}
        style={styles.partnerRow}>
        <Chip
          label={withPartner ? 'Walking with someone · on' : 'Walking with someone else?'}
          small
          tone={withPartner ? 'on' : 'default'}
          onDark={!withPartner}
        />
      </Pressable>

      <View style={styles.actions}>
        <Button
          label="I'm here"
          full
          chevron
          onPress={() => {
            arrive();
            router.push('/trek/arrival');
          }}
        />
        <Button
          label={paused ? 'Resume' : 'Pause'}
          variant="ghost"
          full
          small
          onPress={() => (paused ? resume() : pause())}
        />
        <Button
          label="Discard trek"
          variant="ghost"
          full
          small
          onPress={() => {
            useTrek.getState().end();
            useTrek.getState().reset();
            router.back();
          }}
        />
      </View>
    </View>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <View style={styles.stat}>
      <Label style={{ color: 'rgba(242,242,238,0.6)' }}>{label}</Label>
      <View style={styles.statValue}>
        <Data style={{ fontSize: 34, color: colour.n50 }}>{value}</Data>
        {unit ? <Small style={{ color: 'rgba(242,242,238,0.6)' }}>{unit}</Small> : null}
      </View>
    </View>
  );
}

/** Minutes per kilometre, the unit walkers actually think in. */
const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colour.forest,
    paddingHorizontal: space.screenX,
  },
  header: { marginBottom: 28 },
  stats: { gap: 18 },
  stat: { gap: 2 },
  statValue: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  target: { marginTop: 18 },
  status: { marginTop: 'auto' },
  partnerRow: { alignSelf: 'flex-start', marginTop: 10, marginBottom: 12 },
  actions: { gap: 9 },

  compassRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 4 },
  compassArrow: { width: 40, alignItems: 'center' },
  compassGlyph: { fontSize: 36, color: colour.sand, lineHeight: 40 },
});
