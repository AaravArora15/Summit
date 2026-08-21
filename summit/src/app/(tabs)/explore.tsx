/**
 * Explore, screen 06 of the v4 mockup.
 *
 * Distance is drawn, not just written: the map carries 2 km and 5 km rings so
 * "how far" is read at a glance. Each location card carries four independent
 * signals without collision, which is the reason for the shape/colour split:
 *
 *   set stripe    -> which group it belongs to  (set colour, used nowhere else)
 *   difficulty chip-> how hard the walk is       (word, never colour)
 *   peak row      -> how hard the walk is        (shape, echoes the chip)
 *   pioneer count -> how much scarcity is left   (number)
 *
 * Rarity still sets the badge's own colour everywhere a badge is drawn (the
 * preview here, Collect, Set detail) — that's a different question, "how good
 * a pull was this," and stays out of the chip so it never gets misread as a
 * safety or difficulty signal.
 *
 * Sand marks a secret spot; a forest tick marks something already claimed.
 *
 * The centre is the device's position when it can be had. Foreground location
 * is requested here, gently, because a map that opens centred on Singapore for
 * someone standing in Kuala Lumpur is not exploring anything nearby. Denial
 * falls back to Singapore rather than blocking the screen: this is the one
 * permission prompt in the app that is not gating a feature the screen cannot
 * work without (background permission, asked at trek start, is that one).
 */
import { useQuery } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Badge } from '@/components/badge';
import { CheckIcon, CloseIcon, DropIcon, FortIcon, HomeIcon, TreeIcon } from '@/components/icons';
import { Body, Button, Card, Chip, Data, Difficulty, H2, IconButton, Label, ProgressBar, Small, Stripe } from '@/components/ui';
import { useSession } from '@/features/auth/session';
import { TrailMap, type MapPin } from '@/features/map/trail-map';
import { usingDemoCartography } from '@/features/map/style';
import { haversineM } from '@/features/trek/distance';
import { requestTrekPermissions } from '@/features/trek/recorder';
import { useTrek } from '@/features/trek/store';
import { DEMO_CENTRE, demoLocationsNear } from '@/lib/demo-data';
import { SET_GLYPH, shortBand } from '@/lib/queries';
import {
  isSupabaseConfigured,
  locationsNear,
  secretSpotsNear,
  type NearbyLocation,
  type SecretSpotFence,
} from '@/lib/supabase';
import { colour, font, radius, rarityColour, setColour, size, space, type SetKey } from '@/theme/tokens';

/** Same four icons set/[id].tsx uses for the same SET_GLYPH keys — a badge's
 *  glyph is picked by set, not by individual location. */
const GLYPHS: Record<string, ReactNode> = {
  ridge: <HomeIcon size={19} color={colour.n50} />,
  tree: <TreeIcon size={19} color={colour.n50} />,
  fort: <FortIcon size={19} color={colour.n50} />,
  drop: <DropIcon size={19} color={colour.n50} />,
};

/** A location or secret spot pulled up for a closer look: the map flies to it
 *  and the sheet swaps its list for the thing itself. */
type Selection =
  | { kind: 'location'; location: NearbyLocation }
  | { kind: 'secret'; fence: SecretSpotFence };

/** Singapore. Used until the device position resolves, and again if it never does. */
const FALLBACK_CENTRE: [number, number] = DEMO_CENTRE;
const RADIUS_M = 12000;
/** A location counts as "near" a secret spot within its fuzz radius (400 m) plus
 *  a margin, so the card badge does not flicker in and out at the boundary. */
const SECRET_NEARBY_M = 700;

const FILTERS = ['All', 'Easy & medium', '< 5 km', 'Reservoir set', 'Secret'] as const;

/** 'All' and 'Secret' both return true here: 'All' has nothing to narrow by,
 *  and 'Secret' switches the sheet to a different list rather than filtering
 *  this one, so a location is never the thing being judged against it. */
function matchesFilter(l: NearbyLocation, f: (typeof FILTERS)[number]): boolean {
  if (f === 'Easy & medium') return l.difficulty <= 2;
  if (f === '< 5 km') return l.distance_m < 5000;
  if (f === 'Reservoir set') return l.set_key === 'reservoir';
  return true;
}

/**
 * Best-effort device position. Never throws, never blocks the screen: a phone
 * with location off, a browser that denies the prompt, and a simulator with no
 * fix all land on the same fallback.
 */
function useDeviceCentre(): [number, number] {
  const [centre, setCentre] = useState<[number, number]>(FALLBACK_CENTRE);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const existing = await Location.getForegroundPermissionsAsync();
        const granted = existing.granted
          ? existing
          : await Location.requestForegroundPermissionsAsync();
        if (!granted.granted) return;

        const fix = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (!cancelled) {
          setCentre([fix.coords.longitude, fix.coords.latitude]);
        }
      } catch {
        // Left on the Singapore fallback. A denied prompt and a genuine GPS
        // failure are indistinguishable here and treated the same: the map
        // still works, it just opens on the city rather than the person.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return centre;
}

export default function ExploreScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const session = useSession();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('All');
  const [search, setSearch] = useState('');
  const [selection, setSelection] = useState<Selection | null>(null);
  // Only set once something has been picked. Until then the map centres on
  // the device, same as before; this only ever overrides that.
  const [focus, setFocus] = useState<{ lng: number; lat: number; zoom: number } | null>(null);

  const centre = useDeviceCentre();
  const mapCentre = useMemo<[number, number]>(
    () => (focus ? [focus.lng, focus.lat] : centre),
    [focus, centre],
  );

  // Not enabled until Supabase is configured, so the screen renders with an
  // empty list rather than throwing on a missing environment variable.
  // Live data when the backend is configured, demo data otherwise, so the app
  // is presentable without one. Both return the same shape.
  const { data, isError } = useQuery({
    queryKey: ['locations-near', centre],
    queryFn: () => locationsNear(centre[1], centre[0], RADIUS_M),
    enabled: isSupabaseConfigured,
    retry: false,
  });

  // Coarse secret-spot circles, for the sand pins and the card badge. Requires
  // a session: secret_spots_near() is granted to `authenticated` only, since it
  // also excludes whatever the caller has already claimed.
  const { data: secretFences } = useQuery({
    queryKey: ['secret-spots-near', centre],
    queryFn: () => secretSpotsNear(centre[1], centre[0], RADIUS_M),
    enabled: isSupabaseConfigured && session.status === 'signed-in',
    retry: false,
  });
  const fences = useMemo(() => secretFences ?? [], [secretFences]);

  const rows = isSupabaseConfigured ? data : demoLocationsNear(RADIUS_M);

  /**
   * Background permission is requested here, at the moment it is first needed,
   * with the reason visible on screen. Asking cold during onboarding gets
   * denied, and on iOS the OS will not prompt a second time.
   */
  async function startTrekTo(location: NearbyLocation) {
    const permission = await requestTrekPermissions();
    if (!permission.ok) return;

    await useTrek.getState().begin({ id: location.id, name: location.name });
    router.push('/trek/live');
  }

  /**
   * Same permission flow, aimed at a fuzzed secret-spot circle rather than a
   * named location. `isSecret: true` is what tells the arrival screen to ask
   * for a photo before it ever tries to sync: claim_location() refuses a
   * secret spot without one, and there is no reason to upload a whole track
   * first only to have the claim half of it bounce.
   */
  async function startHuntFor(fence: SecretSpotFence) {
    const permission = await requestTrekPermissions();
    if (!permission.ok) return;

    // Never the fence's real name here either, for the same reason the pin
    // label withholds it.
    await useTrek.getState().begin({ id: fence.id, name: 'Secret spot', isSecret: true });
    router.push('/trek/live');
  }

  /** A card or pin tap: pulls the location up for a closer look and sends the
   *  map there, rather than starting a trek immediately. Start Trek lives on
   *  the detail panel now, not on the card itself. */
  function selectLocation(location: NearbyLocation) {
    setSelection({ kind: 'location', location });
    setFocus({ lng: location.lng, lat: location.lat, zoom: 15 });
  }

  function selectSecret(fence: SecretSpotFence) {
    setSelection({ kind: 'secret', fence });
    setFocus({ lng: fence.fuzzed_lng, lat: fence.fuzzed_lat, zoom: 14.5 });
  }

  /** A pin tap on the map itself. Its id is either a location's own id or,
   *  for the sand pins, `secret-<fence id>` (see the `pins` memo below). */
  function selectPin(id: string) {
    if (id.startsWith('secret-')) {
      const fence = fences.find((f) => f.id === id.slice('secret-'.length));
      if (fence) selectSecret(fence);
      return;
    }
    const location = (rows ?? []).find((l) => l.id === id);
    if (location) selectLocation(location);
  }

  // Whether each public location sits near one of the fuzzed secret circles.
  // Computed client-side from data already fetched for the map: the server
  // never says which named place a secret spot is "near", only where the
  // fuzzed circle itself sits, and that is exactly the boundary that keeps a
  // real coordinate from being reconstructed by triangulating this list.
  const nearSecret = useMemo(() => {
    const ids = new Set<string>();
    for (const loc of rows ?? []) {
      for (const fence of fences) {
        if (haversineM(loc, { lat: fence.fuzzed_lat, lng: fence.fuzzed_lng }) <= SECRET_NEARBY_M) {
          ids.add(loc.id);
          break;
        }
      }
    }
    return ids;
  }, [rows, fences]);

  // A toggle filter doesn't remove a card from the list any more — it dulls
  // the ones that don't match and leaves the ones that do at full strength,
  // same treatment as the filter chips themselves. 'Secret' isn't checked
  // here: it swaps the sheet to the fences list entirely, a different screen
  // rather than a narrower version of this one, so nothing in `locations`
  // needs to know about it. Search stays a hard exclusion — a typed query
  // is asking "where is it", not "which of these do I care about right now".
  const locations = useMemo(() => {
    let all = rows ?? [];

    if (search) {
      const q = search.toLowerCase();
      all = all.filter((l) => l.name.toLowerCase().includes(q));
    }

    return all;
  }, [rows, search]);

  // Rarity is the pin colour when a location matches the active filter,
  // matching the cards; muted grey when it doesn't. Secret spots stay sand
  // regardless of filter — none of the three toggles (difficulty, distance,
  // set) are answerable for a spot that hasn't been found yet.
  const pins = useMemo<MapPin[]>(() => {
    const locationPins = (rows ?? []).map((l) => ({
      id: l.id,
      lng: l.lng,
      lat: l.lat,
      colour: matchesFilter(l, filter) ? rarityColour[l.rarity] : colour.n200,
      label: l.name,
    }));
    const secretPins = fences.map((f) => ({
      id: `secret-${f.id}`,
      lng: f.fuzzed_lng,
      lat: f.fuzzed_lat,
      colour: colour.sand,
      // Never the fence's own name: secret_spots_near() sends it because the
      // server needs it for the geofence's own bookkeeping, but geofence.ts
      // withholds it from even its own notification, and this map should not
      // be the one place that hands it over.
      label: 'Secret spot',
    }));
    return [...locationPins, ...secretPins];
  }, [rows, fences, filter]);

  const selectedPinId = selection
    ? selection.kind === 'location'
      ? selection.location.id
      : `secret-${selection.fence.id}`
    : null;

  return (
    <View style={styles.screen}>
      <View style={StyleSheet.absoluteFill}>
        <TrailMap
          centre={mapCentre}
          zoom={focus?.zoom ?? 11.4}
          pins={pins}
          selectedPinId={selectedPinId}
          onPinPress={selectPin}
        />
      </View>

      {/* Search and filters float over the map */}
      <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
        <View style={styles.searchRow}>
          <View style={styles.search}>
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search places, sets, trails"
              placeholderTextColor={colour.dim}
              style={styles.searchInput}
              returnKeyType="search"
            />
          </View>
          <Pressable style={styles.control} accessibilityLabel="Filters" />
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filters}>
          {FILTERS.map((f) => {
            const active = filter === f;
            return (
              <Pressable
                key={f}
                onPress={() => setFilter(f)}
                accessibilityRole="button"
                // Opacity alone, on top of an already-faint outline chip, was
                // too subtle to read as "off" — this pushes both the border
                // and the label to a visibly muted grey instead, not just a
                // transparent copy of the same dark text.
                style={!active && styles.filterDim}>
                <Chip label={f} tone={active ? 'on' : 'default'} colour={active ? undefined : colour.dim} small />
              </Pressable>
            );
          })}
        </ScrollView>

        {usingDemoCartography ? (
          <View style={styles.notice}>
            <Label style={{ color: colour.warn }}>
              Standard cartography · not Summit&rsquo;s style yet
            </Label>
          </View>
        ) : null}
      </View>

      {/* The sheet. A real bottom sheet (gorhom) replaces this once the
          gestures matter; for now it is a fixed panel at the resting height. */}
      <View style={[styles.sheet, { paddingBottom: size.tabBar + 8 }]}>
        <View style={styles.grabber} />

        <View style={styles.sheetHead}>
          <Label>
            {selection
              ? 'Selected'
              : filter === 'Secret'
                ? 'Fuzzed to roughly here · sorted by distance'
                : `Within ${RADIUS_M / 1000} km · sorted by distance`}
          </Label>
          {selection ? (
            <IconButton label="Back to list" onPress={() => setSelection(null)}>
              <CloseIcon size={16} color={colour.dim} />
            </IconButton>
          ) : (
            <Label style={{ color: colour.forest }}>List view</Label>
          )}
        </View>

        {selection ? (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>
            {selection.kind === 'location' ? (
              <LocationDetail
                location={selection.location}
                nearSecret={nearSecret.has(selection.location.id)}
                onStart={() => startTrekTo(selection.location)}
              />
            ) : (
              <SecretDetail onStart={() => startHuntFor(selection.fence)} />
            )}
          </ScrollView>
        ) : filter === 'Secret' ? (
          fences.length === 0 ? (
            <Small style={styles.empty}>Nothing within range yet. Keep walking.</Small>
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.cards}>
              {fences.map((f) => (
                <SecretSpotCard key={f.id} onPress={() => selectSecret(f)} />
              ))}
            </ScrollView>
          )
        ) : locations.length === 0 ? (
          <Small style={styles.empty}>
            {isError
              ? 'Could not reach the server. Showing nothing rather than something wrong.'
              : 'Nothing matches, within range.'}
          </Small>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.cards}>
            {locations.map((l) => (
              <LocationCard
                key={l.id}
                location={l}
                nearSecret={nearSecret.has(l.id)}
                dim={!matchesFilter(l, filter)}
                onPress={() => selectLocation(l)}
              />
            ))}
          </ScrollView>
        )}
      </View>
    </View>
  );
}

function LocationCard({
  location,
  nearSecret,
  dim,
  onPress,
}: {
  location: NearbyLocation;
  nearSecret: boolean;
  /** Doesn't match the active filter. Dulled, not removed — see `locations`
   *  in ExploreScreen for why the list stopped hard-excluding these. */
  dim: boolean;
  onPress: () => void;
}) {
  const km = (location.distance_m / 1000).toFixed(1);

  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={dim && styles.filterDim}>
      <Card style={styles.card}>
        <View style={styles.cardTop}>
          <Chip label={difficultyLabel(location.difficulty)} small />
          <Data style={{ fontSize: 12 }}>{km} KM</Data>
        </View>

        <View style={styles.cardTitleRow}>
          <H2 style={{ marginTop: 6, fontSize: 16, flexShrink: 1 }} numberOfLines={1}>
            {location.name}
          </H2>
          {/* The forest tick: something already claimed. */}
          {location.claimed ? (
            <View style={styles.claimedTick}>
              <CheckIcon size={12} color={colour.forest} strokeWidth={2.2} />
            </View>
          ) : null}
        </View>

        {/* Shape only here: the word already ran once, in the chip above. */}
        <View style={{ marginTop: 6 }}>
          <Difficulty level={location.difficulty} />
        </View>

        <View style={styles.cardFoot}>
          <Label>
            {location.pioneer_taken} / {location.pioneer_cap} taken
          </Label>
          {/* Sand marks a secret spot: here, that a secret spot sits nearby,
              since the spot itself is never named or placed precisely. */}
          {nearSecret ? <Chip label="Secret nearby" small colour={colour.sand} /> : null}
        </View>
      </Card>
    </Pressable>
  );
}

/**
 * A secret spot's card. Deliberately thin compared to a public one: no
 * rarity, no difficulty, no distance, because none of that is known until it
 * is found. The only honest content here is "something is roughly here" and
 * a way to start walking toward it.
 */
function SecretSpotCard({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      <Card style={styles.card}>
        <View style={styles.cardTop}>
          <Chip label="Secret" colour={colour.sand} small />
        </View>

        <H2 style={{ marginTop: 6, fontSize: 16 }}>Undiscovered</H2>

        <Body style={{ marginTop: 6 }}>
          Somewhere within a few minutes of here. The clue is in the walk, not
          the map.
        </Body>

        <Label style={{ marginTop: 8, color: colour.forest }}>View on map →</Label>
      </Card>
    </Pressable>
  );
}

/**
 * The location detail panel, screen 07 of the v4 mockup, folded into the
 * Explore sheet rather than pushed as its own route: it replaces the card
 * list in place, above the same map the cards were always floating over.
 *
 * No ascent or average time here (locations_near() never sends them) and no
 * set-completion cue (that needs my_set_progress(), a second query this pass
 * did not add) — both are honest omissions, not placeholders standing in for
 * missing data.
 */
function LocationDetail({
  location,
  nearSecret,
  onStart,
}: {
  location: NearbyLocation;
  nearSecret: boolean;
  onStart: () => void;
}) {
  const km = (location.distance_m / 1000).toFixed(1);
  const tint =
    location.set_key && location.set_key in setColour
      ? setColour[location.set_key as SetKey]
      : colour.n200;
  // Keyed off the set, not the location — see the GLYPHS comment above.
  const glyph = GLYPHS[(location.set_key && SET_GLYPH[location.set_key]) || 'ridge'];

  return (
    <View style={styles.detail}>
      <View style={styles.detailHead}>
        {/* Faded is not locked: real glyph, real rarity tint, dimmed — this is a
            known place, just not one you've been to. See badge.tsx. */}
        <Badge
          tint={rarityColour[location.rarity]}
          glyph={glyph}
          state={location.claimed ? 'earned' : 'faded'}
          band={shortBand(location.name)}
          width={56}
        />

        <View style={{ flex: 1, minWidth: 0 }}>
          <Chip label={difficultyLabel(location.difficulty)} small />

          <View style={[styles.cardTitleRow, { marginTop: 7 }]}>
            {location.set_key ? <Stripe tint={tint} height={18} width={4} /> : null}
            <H2 style={{ fontSize: 17, flexShrink: 1 }} numberOfLines={2}>
              {location.name}
            </H2>
            {location.claimed ? (
              <View style={styles.claimedTick}>
                <CheckIcon size={12} color={colour.forest} strokeWidth={2.2} />
              </View>
            ) : null}
          </View>

          <Small style={{ marginTop: 3 }}>
            {location.set_name ? `${location.set_name} set` : 'No set'}
          </Small>
        </View>
      </View>

      <View style={styles.statsRow}>
        <Card variant="flat" style={styles.statCard}>
          <Label>Distance</Label>
          <Data style={{ fontSize: 15, marginTop: 2 }}>{km} km</Data>
        </Card>
        {/* Omitted rather than shown as "—": elevation is a real DEM lookup
            that occasionally misses, and this screen doesn't invent numbers. */}
        {location.elevation_m != null ? (
          <Card variant="flat" style={styles.statCard}>
            <Label>Elevation</Label>
            <Data style={{ fontSize: 15, marginTop: 2 }}>{Math.round(location.elevation_m)} m</Data>
          </Card>
        ) : null}
      </View>

      <Card variant="flat" style={{ marginTop: 9, padding: 12 }}>
        <Label>
          {!location.claimed
            ? 'The number waiting for you'
            : location.pioneer_number === null
              ? 'Explorer edition'
              : `Pioneer #${String(location.pioneer_number).padStart(4, '0')}`}
        </Label>
        <View style={{ marginTop: 9 }}>
          <ProgressBar value={location.pioneer_taken / location.pioneer_cap} />
        </View>
        <View style={styles.cardFoot}>
          <Label>{location.pioneer_taken} of {location.pioneer_cap} claimed</Label>
          <Label>{location.pioneer_cap - location.pioneer_taken} left</Label>
        </View>
      </Card>

      {location.claimed && location.points_earned != null ? (
        <Card variant="flat" style={{ marginTop: 9, padding: 12 }}>
          <View style={styles.cardFoot}>
            <Label>Points earned</Label>
            <Data style={{ fontSize: 16 }}>{location.points_earned}</Data>
          </View>
        </Card>
      ) : null}

      {nearSecret ? (
        <View style={{ marginTop: 9 }}>
          <Chip label="Secret spot nearby" small colour={colour.sand} />
        </View>
      ) : null}

      <View style={{ marginTop: 14 }}>
        <Button label={location.claimed ? 'Walk there again' : 'Start Trek'} onPress={onStart} full />
      </View>
    </View>
  );
}

/** The secret-spot counterpart: no name, no set, no rarity, because none of
 *  that is known until it is found. See SecretSpotCard for why. */
function SecretDetail({ onStart }: { onStart: () => void }) {
  return (
    <View style={styles.detail}>
      <View style={styles.cardTop}>
        <Chip label="Secret" colour={colour.sand} small />
      </View>

      <H2 style={{ marginTop: 9, fontSize: 18 }}>Undiscovered</H2>

      <Body style={{ marginTop: 6 }}>
        Somewhere within a few minutes of here. The clue is in the walk, not the
        map.
      </Body>

      <View style={{ marginTop: 14 }}>
        <Button label="Start hunting" onPress={onStart} full />
      </View>
    </View>
  );
}

function difficultyLabel(level: 1 | 2 | 3 | 4) {
  return (['Easy', 'Medium', 'Hard', 'Extreme'] as const)[level - 1];
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colour.bg },

  top: { paddingHorizontal: space.screenX, gap: 10 },
  searchRow: { flexDirection: 'row', gap: 9 },
  search: {
    flex: 1,
    minWidth: 0,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colour.card,
    borderWidth: 1,
    borderColor: colour.n200,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  searchInput: {
    fontFamily: font.ui,
    fontSize: 13.5,
    color: colour.ink,
    padding: 0,
  },
  control: {
    width: 44,
    height: 44,
    borderRadius: radius.control,
    backgroundColor: colour.card,
    borderWidth: 1,
    borderColor: colour.n200,
  },
  filters: { gap: 6, paddingRight: space.screenX },
  filterDim: { opacity: 0.5 },
  notice: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.button,
    backgroundColor: colour.sandLight,
    borderWidth: 1,
    borderColor: '#EBE3D4',
  },

  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '62%',
    backgroundColor: colour.card,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    paddingTop: 10,
    paddingHorizontal: space.screenX,
    borderTopWidth: 1,
    borderTopColor: colour.line,
  },
  grabber: {
    width: 38,
    height: 4,
    borderRadius: 99,
    backgroundColor: colour.n200,
    alignSelf: 'center',
    marginBottom: 12,
  },
  sheetHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  cards: { gap: 9, paddingRight: space.screenX },
  card: { width: 176 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  claimedTick: {
    width: 16,
    height: 16,
    borderRadius: 99,
    borderWidth: 1.5,
    borderColor: colour.forest,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
  },
  cardFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, gap: 6 },
  empty: { paddingBottom: 14 },
  detail: { paddingBottom: 6 },
  detailHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  statsRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  statCard: { flex: 1, padding: 10 },
});
