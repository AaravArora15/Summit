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
 * is requested here, gently, because a map that opens on a fixed point for
 * someone standing somewhere else entirely is not exploring anything nearby.
 * Denial falls back to a fixed centre rather than blocking the screen: this is
 * the one permission prompt in the app that is not gating a feature the screen
 * cannot work without (background permission, asked at trek start, is that
 * one). With locations now scattered worldwide (see scripts/seed-csv.mjs)
 * rather than one walkable city, that fallback rarely lands near a seeded
 * place, and locations_near()'s radius is deliberately left as-is: Explore
 * stays a genuine "what's near me" query, not one padded to always show
 * results.
 */
import BottomSheet, { BottomSheetFlatList, BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { useQuery } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ElementRef } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Badge } from '@/components/badge';
import { AlertTriangleIcon, CheckIcon, CloseIcon, FilterIcon, PlusIcon } from '@/components/icons';
import { Body, Button, Card, Chip, Data, Difficulty, H2, H3, IconButton, Label, ProgressBar, Sheet, Small, Stripe } from '@/components/ui';
import { Skeleton } from '@/components/skeleton';
import { useSession } from '@/features/auth/session';
import { TrailMap, type MapPin } from '@/features/map/trail-map';
import { haversineM } from '@/features/trek/distance';
import { fakeClaimNearby, stashDevFakeOutcome } from '@/features/trek/dev-fake-claim';
import { beginTrekSession } from '@/features/trek/start';
import { useTrek } from '@/features/trek/store';
import { confirmUser } from '@/lib/alert';
import { DEMO_CENTRE, demoLocationsNear } from '@/lib/demo-data';
import { presentPaywall, usePro } from '@/lib/purchases';
import { SET_GLYPH, shortBand, useProfile, useSetProgress } from '@/lib/queries';
import {
  isSupabaseConfigured,
  locationsNear,
  secretSpotsNear,
  type NearbyLocation,
  type SecretSpotFence,
} from '@/lib/supabase';
import { colour, font, radius, rarityColour, setColour, size, space, withAlpha, type SetKey } from '@/theme/tokens';

/** A location or secret spot pulled up for a closer look: the map flies to it
 *  and the sheet swaps its list for the thing itself. */
type Selection =
  | { kind: 'location'; location: NearbyLocation }
  | { kind: 'secret'; fence: SecretSpotFence };

/** A fixed fallback point. Used until the device position resolves, and again if it never does. */
const FALLBACK_CENTRE: [number, number] = DEMO_CENTRE;
/**
 * Effectively unlimited: bigger than any two points on Earth can be apart
 * (half the circumference, ~20,015 km), so `locations_near()` returns every
 * open location regardless of where the device is, sorted by distance. With
 * ~640 locations scattered worldwide (see scripts/seed-csv.mjs), a genuine
 * "nearby" radius would show almost nothing to almost everyone; this is a
 * deliberate "browse everything" choice, not a bug. claim_location()'s own
 * arrival check is untouched and still tight — this only affects what the
 * list/map show, never what claiming accepts.
 */
const RADIUS_M = 20_100_000;
/**
 * Secret-spot geofences stay genuinely local: secret_spots_near()'s result
 * gets registered as live iOS geofence monitors (see its doc comment), capped
 * at 20 — spending that budget on spots scattered across the planet when the
 * device is only ever in one place would waste it, unlike the plain list
 * above which is just rendered, not monitored.
 */
const SECRET_RADIUS_M = 20000;
/** A location counts as "near" a secret spot within its fuzz radius (400 m) plus
 *  a margin, so the card badge does not flicker in and out at the boundary. */
const SECRET_NEARBY_M = 700;

/**
 * Peek (grabber + head row only, cards pulled down out of view) and an open
 * stop a little over a third of the screen, so the map stays the subject
 * even with the list up. Both reachable by drag as well as by code.
 * The sheet has no bottomInset, so its background runs flush behind the tab
 * bar the same way the fixed panel it replaced did — which means the tab bar
 * covers the bottom `size.tabBar` of every snap point. Adding it into the
 * peek height is what keeps the grabber and label actually visible above the
 * tab bar rather than mostly hidden under it.
 */
const SHEET_PEEK = 92 + size.tabBar;
/** The open stop, as a share of the window. The tab bar's height is added on
 *  top inside the component, for the same reason the peek adds it: the bar
 *  covers that strip, and "35% of the screen" means the visible part. */
const SHEET_OPEN_FRACTION = 0.35;

const FILTERS = ['All', 'Easy & medium', '< 5 km', 'Trail set', 'Secret'] as const;

/**
 * The four filters from the mockup's screen 34 "Rarity, sets & spots" panel,
 * unlocked once `usePro()` is true — see ExploreFiltersSheet. Real predicates,
 * not decoration: once someone has actually unlocked them they have to work,
 * the same honesty rule the rest of this app follows for every number it
 * shows. "Unfound spots only" isn't listed here — it reuses the existing
 * `'Secret'` filter value rather than a new one, since secret_spots_near()
 * already excludes whatever the caller has claimed (see its own query
 * comment above), so every secret pin shown is already "unfound" by
 * construction; there is nothing this filter would add on top of that.
 */
const PRO_FILTERS = ['Rare and above', 'Completes a set', 'Numbers under #0100'] as const;
type FilterValue = (typeof FILTERS)[number] | (typeof PRO_FILTERS)[number];

/** What ExploreFiltersSheet renders as the four Pro chips, in the mockup's
 *  own order. "Unfound spots only" points at the existing 'Secret' value —
 *  see the comment on PRO_FILTERS above for why there's no separate one. */
const PRO_FILTER_CHIPS: { label: string; value: FilterValue }[] = [
  { label: 'Rare and above', value: 'Rare and above' },
  { label: 'Unfound spots only', value: 'Secret' },
  { label: 'Completes a set', value: 'Completes a set' },
  { label: 'Numbers under #0100', value: 'Numbers under #0100' },
];

/** 'All' and 'Secret' both return true here: 'All' has nothing to narrow by,
 *  and 'Secret' switches the sheet to a different list rather than filtering
 *  this one, so a location is never the thing being judged against it.
 *
 *  `completesSetNames` is a name-matched set (my_set_progress() reports the
 *  next location by name, not id — see ExploreScreen where this is built)
 *  of every location that would finish a set already one away from complete. */
function matchesFilter(
  l: NearbyLocation,
  f: FilterValue,
  completesSetNames: ReadonlySet<string>,
): boolean {
  if (f === 'Easy & medium') return l.difficulty <= 2;
  if (f === '< 5 km') return l.distance_m < 5000;
  if (f === 'Trail set') return l.set_key === 'trail';
  if (f === 'Rare and above') return l.rarity !== 'common';
  if (f === 'Numbers under #0100') return l.pioneer_taken < 100;
  if (f === 'Completes a set') return completesSetNames.has(l.name);
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
        if (!granted.granted) {
          // Silence here cost us a debugging session: the screen kept working
          // from the demo centre and nobody could tell why "closest" pointed
          // at California.
          console.warn('[explore] foreground location denied, staying on demo centre');
          return;
        }

        // Cold GPS can stall a Balanced fix far longer than anyone should
        // stare at a wrong "closest" list. Race a timeout, then fall back to
        // the OS's recent history before giving up entirely.
        const fix = await Promise.race([
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 8_000)),
        ]);
        if (cancelled) return;

        if (!fix) {
          const last = await Location.getLastKnownPositionAsync({ maxAge: 300_000 });
          if (last) {
            console.warn('[explore] fix timed out, using last known position');
            setCentre([last.coords.longitude, last.coords.latitude]);
          } else {
            console.warn('[explore] no device fix available, staying on demo centre');
          }
          return;
        }

        setCentre([fix.coords.longitude, fix.coords.latitude]);
      } catch (error) {
        // Left on the fixed fallback. A denied prompt and a genuine GPS
        // failure are indistinguishable here and treated the same: the map
        // still works, it just opens on the fallback point rather than the person.
        console.warn('[explore] device centre unavailable', error);
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
  const pro = usePro();
  const { data: profile } = useProfile();
  const { data: setProgress } = useSetProgress();
  // Every location that would complete a set already one away from finished
  // — see matchesFilter's own comment on why this is name-matched rather
  // than id-matched.
  const completesSetNames = useMemo(
    () =>
      new Set(
        setProgress.filter((s) => s.nextLocationName && s.held === s.total - 1).map((s) => s.nextLocationName as string),
      ),
    [setProgress],
  );
  const [filter, setFilter] = useState<FilterValue>('All');
  const [search, setSearch] = useState('');
  // The query as of the last Enter. Typing narrows the list as you go, but
  // the map only reacts to a committed search: fading pins on every
  // keystroke makes the whole map flicker while someone is still spelling.
  const [submittedSearch, setSubmittedSearch] = useState('');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const bottomSheetRef = useRef<ElementRef<typeof BottomSheet>>(null);
  const { height: windowHeight } = useWindowDimensions();
  const snapPoints = useMemo(
    () => [SHEET_PEEK, Math.round(windowHeight * SHEET_OPEN_FRACTION) + size.tabBar],
    [windowHeight],
  );

  // Picking a pin or a card is a request to look at it, so the sheet expands
  // to show the detail even if it was pulled down to peek at the map.
  useEffect(() => {
    if (selection) bottomSheetRef.current?.snapToIndex(1);
  }, [selection]);
  const [startingTrek, setStartingTrek] = useState(false);
  const [fakingClaim, setFakingClaim] = useState(false);
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
  const { data, isError, isLoading } = useQuery({
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
    queryFn: () => secretSpotsNear(centre[1], centre[0], SECRET_RADIUS_M),
    enabled: isSupabaseConfigured && session.status === 'signed-in',
    retry: false,
  });
  const fences = useMemo(() => secretFences ?? [], [secretFences]);

  const rows = useMemo(
    () => (isSupabaseConfigured ? data : demoLocationsNear(RADIUS_M)),
    [data],
  );


  /**
   * Background permission is requested here, at the moment it is first needed,
   * with the reason visible on screen. Asking cold during onboarding gets
   * denied, and on iOS the OS will not prompt a second time.
   *
   * Shared by all three ways to start a trek below — the actual permission
   * request, denial copy, and error handling now live in beginTrekSession()
   * (features/trek/start.ts), once Home's Wildcard hunt needed the identical
   * flow. This wrapper just owns the loading flag and the navigation.
   *
   * `startingTrek` only ever gets reset to false on the paths that leave the
   * user still looking at this screen (permission denied, an error); on
   * success the screen navigates away before it would matter.
   */
  async function startTrek(begin: () => Promise<void>) {
    setStartingTrek(true);
    try {
      if (await beginTrekSession(begin)) router.push('/trek/live');
    } finally {
      setStartingTrek(false);
    }
  }

  function startTrekTo(location: NearbyLocation) {
    const begin = () =>
      startTrek(() =>
        useTrek.getState().begin({
          id: location.id,
          name: location.name,
          lat: location.lat,
          lng: location.lng,
          rarity: location.rarity,
          glyph: (location.set_key && SET_GLYPH[location.set_key]) || 'ridge',
        }),
      );

    // The server already refuses the claim outright (claim_location() in
    // 0001_init.sql) — this is purely about not sending someone on a walk
    // toward a place that will reject them, without at least telling them
    // first. Still their call: status can change while they're en route, so
    // this warns rather than blocks.
    if (location.status !== 'open') {
      confirmUser(
        location.status === 'closed' ? 'This trail is closed' : 'Seasonal closure',
        location.status_note ??
          "This location isn't accepting claims right now. You can still walk there, but arriving won't count.",
        begin,
        { confirmLabel: 'Go anyway' },
      );
      return;
    }

    begin();
  }

  /**
   * Dev-only: claim a location for real without walking to it — see
   * dev-fake-claim.ts for what "for real" means here (a genuine upload and
   * claim_location() call, just with a stationary synthetic track). Sets the
   * same store fields begin() would, minus anything that would start the
   * real recorder, then hands the already-resolved outcome to the arrival
   * screen through takeDevFakeOutcome() rather than trekId.
   */
  async function devFakeClaim(location: NearbyLocation) {
    if (!__DEV__ || fakingClaim) return;
    setFakingClaim(true);
    try {
      const outcome = await fakeClaimNearby(location);
      stashDevFakeOutcome(outcome);
      useTrek.setState({
        trekId: null,
        targetLocationId: location.id,
        targetName: location.name,
        targetRarity: location.rarity,
        targetGlyph: (location.set_key && SET_GLYPH[location.set_key]) || 'ridge',
        targetIsSecret: false,
        targetIsWildcard: false,
        distanceM: 0,
        withPartner: false,
      });
      router.push('/trek/arrival');
    } finally {
      setFakingClaim(false);
    }
  }

  /**
   * Aimed at a fuzzed secret-spot circle rather than a named location.
   * `isSecret: true` is what tells the arrival screen to ask for a photo
   * before it ever tries to sync: claim_location() refuses a secret spot
   * without one, and there is no reason to upload a whole track first only
   * to have the claim half of it bounce. Never the fence's real name here
   * either, for the same reason the pin label withholds it.
   */
  function startHuntFor(fence: SecretSpotFence) {
    return startTrek(() =>
      useTrek.getState().begin({
        id: fence.id,
        name: 'Secret spot',
        isSecret: true,
        lat: fence.fuzzed_lat,
        lng: fence.fuzzed_lng,
      }),
    );
  }

  /**
   * No target at all. The trek still earns its distance/moving-time points
   * and counts toward the league once it ends — see validate_trek() in
   * 0015_untargeted_trek_scoring.sql — it just never attempts a claim, since
   * there is nowhere named to claim.
   */
  function startFreeTrek() {
    return startTrek(() => useTrek.getState().begin());
  }

  /** A card or pin tap: pulls the location up for a closer look and sends the
   *  map there, rather than starting a trek immediately. Start Trek lives on
   *  the detail panel now, not on the card itself. */
  //
  // These three are memoised by hand. The React Compiler skips this
  // component (it bails out on the whole function, silently, when anything
  // in it breaks its rules), and handed to 640 cards and 640 map markers, a
  // handler that changes identity every render is what makes every keystroke
  // in the search box re-render the entire list.
  const selectLocation = useCallback((location: NearbyLocation) => {
    setSelection({ kind: 'location', location });
    setFocus({ lng: location.lng, lat: location.lat, zoom: 15 });
  }, []);

  const selectSecret = useCallback((fence: SecretSpotFence) => {
    setSelection({ kind: 'secret', fence });
    setFocus({ lng: fence.fuzzed_lng, lat: fence.fuzzed_lat, zoom: 14.5 });
  }, []);

  /** A pin tap on the map itself. Its id is either a location's own id or,
   *  for the sand pins, `secret-<fence id>` (see the `pins` memo below). */
  const selectPin = useCallback(
    (id: string) => {
      if (id.startsWith('secret-')) {
        const fence = fences.find((f) => f.id === id.slice('secret-'.length));
        if (fence) selectSecret(fence);
        return;
      }
      const location = (rows ?? []).find((l) => l.id === id);
      if (location) selectLocation(location);
    },
    [fences, rows, selectLocation, selectSecret],
  );

  // Arrived here from a badge somewhere else in the app (Collect's latest
  // row, Profile's featured row, a set's grid, the badge browser): select
  // that location and fly to it once the list is in, then clear the param so
  // coming back to this tab later does not re-select it. A badge whose place
  // is not in the list (the demo badges, say) simply lands on the map.
  const { location: focusId } = useLocalSearchParams<{ location?: string }>();
  useEffect(() => {
    if (!focusId || !rows) return;
    const target = rows.find((l) => l.id === focusId);
    // The route param is the external system being synced from, and it is
    // consumed (cleared) in the same pass, so this runs once per arrival,
    // not on every render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (target) selectLocation(target);
    router.setParams({ location: undefined });
  }, [focusId, rows, router, selectLocation]);

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
  //
  // A submitted search fades every pin it did not match, secret spots
  // included: a name search cannot match a place whose name is withheld, so
  // they are never "what you asked for" either.
  const pins = useMemo<MapPin[]>(() => {
    const q = submittedSearch.trim().toLowerCase();
    const locationPins = (rows ?? []).map((l) => ({
      id: l.id,
      lng: l.lng,
      lat: l.lat,
      colour: matchesFilter(l, filter, completesSetNames) ? rarityColour[l.rarity] : colour.n200,
      label: l.name,
      dimmed: q !== '' && !l.name.toLowerCase().includes(q),
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
      dimmed: q !== '',
    }));
    return [...locationPins, ...secretPins];
  }, [rows, fences, filter, submittedSearch, completesSetNames]);

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
          // The device's real position, not mapCentre — the rings have to
          // stay anchored to where "2 km away" is actually true from even
          // while the camera itself is panned off to a focused location.
          ringOrigin={{ lat: centre[1], lng: centre[0] }}
        />
      </View>

      {/* Search and filters float over the map */}
      <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
        <View style={styles.searchRow}>
          <View style={styles.search}>
            <TextInput
              value={search}
              onChangeText={(text) => {
                setSearch(text);
                // Clearing the field is the one edit that should reach the
                // map immediately: an empty box with a faded map would look
                // like a filter nobody can see.
                if (text.trim() === '') setSubmittedSearch('');
              }}
              // Taking focus drops the sheet to its peek so the map is in view
              // while the query is typed; Enter commits the search: the map
              // fades everything it did not match and the sheet comes back
              // up to show what it did. Any open detail is dropped first,
              // since the results list is what was asked for, not the place
              // that happened to be selected.
              onFocus={() => bottomSheetRef.current?.snapToIndex(0)}
              onSubmitEditing={() => {
                setSubmittedSearch(search);
                setSelection(null);
                bottomSheetRef.current?.snapToIndex(1);
              }}
              submitBehavior="blurAndSubmit"
              placeholder="Search places, sets, trails"
              placeholderTextColor={colour.dim}
              style={styles.searchInput}
              returnKeyType="search"
            />
          </View>
          <Pressable
            style={styles.control}
            accessibilityRole="button"
            accessibilityLabel="Filters"
            onPress={() => setFiltersOpen(true)}>
            <FilterIcon size={18} color={colour.ink} />
          </Pressable>
          <Pressable
            style={styles.control}
            accessibilityRole="button"
            accessibilityLabel="Suggest a location"
            onPress={() => router.push('/suggest')}>
            <PlusIcon size={18} color={colour.ink} />
          </Pressable>
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

      </View>

      {/* Pull the grabber down to peek at more of the map, or back up to see
          the cards again. Selecting a pin/card expands it automatically (see
          the effect above) so the detail is never left hidden mid-drag. */}
      <BottomSheet
        ref={bottomSheetRef}
        index={1}
        snapPoints={snapPoints}
        enableDynamicSizing={false}
        // Drag from the handle only. Left at the default (drag from anywhere
        // in the body), the same pan recognizer that lets the grabber pull
        // the sheet down also sits over every button/card inside it, and can
        // win the gesture race against a plain tap — a button that looks
        // right but never fires is exactly what that looks like.
        enableContentPanningGesture={false}
        backgroundStyle={styles.sheetBackground}
        handleIndicatorStyle={styles.sheetHandle}>
        <View style={styles.sheetHead}>
          <Label>
            {selection
              ? 'Selected'
              : filter === 'Secret'
                ? 'Fuzzed to roughly here · sorted by distance'
                : 'All locations · sorted by distance'}
          </Label>
          {selection ? (
            <IconButton label="Back to list" onPress={() => setSelection(null)}>
              <CloseIcon size={16} color={colour.dim} />
            </IconButton>
          ) : (
            <Label style={{ color: colour.forest }}>List view</Label>
          )}
        </View>

        {selection ? null : (
          <View style={[styles.sheetContent, { marginBottom: 10 }]}>
            <Button
              label="Start Trekking"
              full
              small
              loading={startingTrek}
              onPress={startFreeTrek}
            />
          </View>
        )}

        {selection ? (
          <BottomSheetScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={StyleSheet.flatten([
              styles.sheetContent,
              { paddingBottom: size.tabBar + 16 },
            ])}>
            {selection.kind === 'location' ? (
              <LocationDetail
                location={selection.location}
                nearSecret={nearSecret.has(selection.location.id)}
                starting={startingTrek}
                onStart={() => startTrekTo(selection.location)}
                faking={fakingClaim}
                onFakeClaim={() => devFakeClaim(selection.location)}
              />
            ) : (
              <SecretDetail starting={startingTrek} onStart={() => startHuntFor(selection.fence)} />
            )}
          </BottomSheetScrollView>
        ) : filter === 'Secret' ? (
          fences.length === 0 ? (
            <Small style={[styles.empty, styles.sheetContent]}>Nothing within range yet. Keep walking.</Small>
          ) : (
            <BottomSheetScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={StyleSheet.flatten([
                styles.cards,
                styles.sheetContent,
                { paddingBottom: size.tabBar + 16 },
              ])}>
              {fences.map((f) => (
                <SecretSpotCard key={f.id} onPress={() => selectSecret(f)} />
              ))}
            </BottomSheetScrollView>
          )
        ) : isLoading ? (
          <BottomSheetScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={StyleSheet.flatten([
              styles.cards,
              styles.sheetContent,
              { paddingBottom: size.tabBar + 16 },
            ])}>
            {[0, 1, 2].map((i) => (
              <Card key={i} style={styles.card}>
                <Skeleton height={13} width="70%" radius={4} />
                <View style={{ marginTop: 10 }}>
                  <Skeleton height={10} width="45%" radius={4} />
                </View>
                <View style={{ marginTop: 16 }}>
                  <Skeleton height={9} width="100%" radius={4} />
                </View>
              </Card>
            ))}
          </BottomSheetScrollView>
        ) : locations.length === 0 ? (
          <Small style={[styles.empty, styles.sheetContent]}>
            {isError
              ? 'Could not reach the server. Showing nothing rather than something wrong.'
              : 'Nothing matches, within range.'}
          </Small>
        ) : (
          // Virtualised: with ~640 places in range, a plain scroll view
          // mounted every card on first open and re-rendered all of them on
          // each keystroke. A horizontal list renders the handful on screen.
          // Fixed card width makes getItemLayout exact, which is what lets
          // the list skip measuring rows it has not rendered.
          <BottomSheetFlatList
            horizontal
            data={locations}
            keyExtractor={keyForLocation}
            renderItem={({ item }) => (
              <LocationCard
                location={item}
                nearSecret={nearSecret.has(item.id)}
                dim={!matchesFilter(item, filter, completesSetNames)}
                onSelect={selectLocation}
              />
            )}
            extraData={{ filter, nearSecret, completesSetNames }}
            getItemLayout={getCardLayout}
            initialNumToRender={5}
            maxToRenderPerBatch={5}
            windowSize={5}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={StyleSheet.flatten([
              styles.cards,
              styles.sheetContent,
              { paddingBottom: size.tabBar + 16 },
            ])}
          />
        )}
      </BottomSheet>

      <ExploreFiltersSheet
        visible={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        filter={filter}
        setFilter={setFilter}
        pro={pro}
        freeClaimed={profile.counters.find((c) => c.label === 'Badges')?.value ?? 0}
      />
    </View>
  );
}

/**
 * Distance and difficulty are already real, free filters (the chip row
 * above the map) — this just gives them a second, larger entry point plus a
 * reset action.
 *
 * "Rarity, sets & spots" is the mockup's screen 34: locked, it's dimmed and
 * non-interactive, with the reassurance card and "Not now" / "See Pro" pair
 * drawn exactly as screen 34 specs them (its own note: "nothing you earn by
 * walking is ever behind the paywall" — this is a convenience filter, not
 * access to a place). "See Pro" opens RevenueCat's own paywall UI (see
 * lib/purchases.ts); once `pro` is true — usePro()'s listener flips it the
 * moment a purchase completes, no reload needed — the same four chips
 * become real, working filters instead of decoration. See matchesFilter.
 */
function ExploreFiltersSheet({
  visible,
  onClose,
  filter,
  setFilter,
  pro,
  freeClaimed,
}: {
  visible: boolean;
  onClose: () => void;
  filter: FilterValue;
  setFilter: (f: FilterValue) => void;
  pro: boolean | null;
  freeClaimed: number;
}) {
  const [unlocking, setUnlocking] = useState(false);
  const unlocked = pro === true;

  async function seePro() {
    setUnlocking(true);
    try {
      await presentPaywall();
    } finally {
      setUnlocking(false);
    }
  }

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={styles.sheetTitleRow}>
        <H3>Filters</H3>
        <Pressable onPress={() => setFilter('All')} accessibilityRole="button">
          <Chip label="Reset" small />
        </Pressable>
      </View>

      <View style={{ marginTop: 14, gap: 8 }}>
        <Label>Distance &amp; difficulty</Label>
        <View style={styles.sheetChips}>
          {FILTERS.map((f) => {
            const active = filter === f;
            return (
              <Pressable key={f} onPress={() => setFilter(f)} accessibilityRole="button">
                <Chip label={f} tone={active ? 'on' : 'default'} colour={active ? undefined : colour.dim} small />
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={{ marginTop: 16 }}>
        <View style={styles.sheetTitleRow}>
          <Label>Rarity, sets &amp; spots</Label>
          <View style={[styles.proChip, unlocked && styles.proChipOn]}>
            <Small style={{ color: colour.forest }}>{unlocked ? 'Pro · unlocked' : 'Pro'}</Small>
          </View>
        </View>

        {unlocked ? (
          <View style={[styles.sheetChips, { marginTop: 8 }]}>
            {PRO_FILTER_CHIPS.map(({ label, value }) => {
              const active = filter === value;
              return (
                <Pressable key={label} onPress={() => setFilter(value)} accessibilityRole="button">
                  <Chip
                    label={label}
                    tone={active ? 'on' : 'default'}
                    colour={active ? undefined : colour.dim}
                    small
                  />
                </Pressable>
              );
            })}
          </View>
        ) : (
          <>
            <Card variant="sandy" style={{ marginTop: 8, padding: 13 }}>
              <View style={styles.sheetChips}>
                {PRO_FILTER_CHIPS.map(({ label }) => (
                  <View key={label} style={{ opacity: 0.55 }}>
                    <Chip label={label} small />
                  </View>
                ))}
              </View>
              <Small style={{ marginTop: 10, lineHeight: 18, color: '#3F5644' }}>
                Four ways to search the same map you already have. Every place
                these filters would find is claimable on the free plan — this
                only saves you the scrolling.
              </Small>
            </Card>

            <Card variant="flat" style={{ marginTop: 10, padding: 13 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                <CheckIcon size={15} color={colour.forest} />
                <H3 style={{ fontSize: 13.5 }}>Never behind the paywall</H3>
              </View>
              <Small style={{ lineHeight: 18 }}>
                Claiming places, pioneer numbers, badges, sets, points, the
                league, group competitions, secret spots, submissions, and
                every safety feature.
              </Small>
            </Card>

            <View style={{ flexDirection: 'row', gap: 8, marginTop: 13 }}>
              <View style={{ flex: 1 }}>
                <Button label="Not now" variant="ghost" full onPress={onClose} />
              </View>
              <View style={{ flex: 1 }}>
                <Button label="See Pro" full loading={unlocking} onPress={seePro} />
              </View>
            </View>
            <Small style={{ textAlign: 'center', marginTop: 9 }}>
              {freeClaimed} {freeClaimed === 1 ? 'place' : 'places'} claimed on the free plan.
            </Small>
          </>
        )}
      </View>
    </Sheet>
  );
}

const CARD_WIDTH = 176;
const CARD_GAP = 9;

function keyForLocation(l: NearbyLocation) {
  return l.id;
}

function getCardLayout(_: ArrayLike<NearbyLocation> | null | undefined, index: number) {
  return {
    length: CARD_WIDTH,
    offset: space.screenX + index * (CARD_WIDTH + CARD_GAP),
    index,
  };
}

/**
 * Memoised, and told which place it is for rather than handed a per-card
 * closure, so that a stable `onSelect` from the parent leaves every card's
 * props untouched across a re-render — which is what lets the list skip them.
 */
const LocationCard = memo(function LocationCard({
  location,
  nearSecret,
  dim,
  onSelect,
}: {
  location: NearbyLocation;
  nearSecret: boolean;
  /** Doesn't match the active filter. Dulled, not removed — see `locations`
   *  in ExploreScreen for why the list stopped hard-excluding these. */
  dim: boolean;
  onSelect: (location: NearbyLocation) => void;
}) {
  const km = (location.distance_m / 1000).toFixed(1);

  return (
    <Pressable
      onPress={() => onSelect(location)}
      accessibilityRole="button"
      style={dim && styles.filterDim}>
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
          <View style={styles.cardFootChips}>
            {location.status !== 'open' ? (
              <Chip
                label={location.status === 'closed' ? 'Closed' : 'Seasonal'}
                small
                colour={location.status === 'closed' ? colour.stop : colour.warn}
              />
            ) : null}
            {/* Sand marks a secret spot: here, that a secret spot sits nearby,
                since the spot itself is never named or placed precisely. */}
            {nearSecret ? <Chip label="Secret nearby" small colour={colour.sand} /> : null}
          </View>
        </View>
      </Card>
    </Pressable>
  );
});

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
  starting,
  onStart,
  faking,
  onFakeClaim,
}: {
  location: NearbyLocation;
  nearSecret: boolean;
  starting: boolean;
  onStart: () => void;
  /** Dev-only claim-without-walking shortcut — see devFakeClaim above. */
  faking?: boolean;
  onFakeClaim?: () => void;
}) {
  const km = (location.distance_m / 1000).toFixed(1);
  const tint =
    location.set_key && location.set_key in setColour
      ? setColour[location.set_key as SetKey]
      : colour.n200;
  // Keyed off the set, not the location — a badge's scene is picked by set.
  const glyph = (location.set_key && SET_GLYPH[location.set_key]) || 'ridge';

  const closureTint = location.status === 'closed' ? colour.stop : colour.warn;

  return (
    <View style={styles.detail}>
      {location.status !== 'open' ? (
        <View style={[styles.closureBanner, { borderColor: withAlpha(closureTint, 0.35), backgroundColor: withAlpha(closureTint, 0.08) }]}>
          <AlertTriangleIcon size={16} color={closureTint} />
          <View style={{ flex: 1 }}>
            <Label style={{ color: closureTint }}>
              {location.status === 'closed' ? 'Closed' : 'Seasonal closure'}
            </Label>
            <Small style={{ marginTop: 2, color: colour.ink2 }}>
              {location.status_note ?? "Not accepting claims right now. Check back before you head out."}
            </Small>
          </View>
        </View>
      ) : null}

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
        <Button
          label={location.claimed ? 'Walk there again' : 'Start Trek'}
          onPress={onStart}
          loading={starting}
          full
        />
      </View>

      {__DEV__ && !location.claimed && onFakeClaim ? (
        <View style={{ marginTop: 9 }}>
          <Button
            label="⚡ Fake claim (dev)"
            variant="ghost"
            small
            full
            loading={faking}
            onPress={onFakeClaim}
          />
        </View>
      ) : null}
    </View>
  );
}

/** The secret-spot counterpart: no name, no set, no rarity, because none of
 *  that is known until it is found. See SecretSpotCard for why. */
function SecretDetail({ starting, onStart }: { starting: boolean; onStart: () => void }) {
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
        <Button label="Start hunting" onPress={onStart} loading={starting} full />
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
    alignItems: 'center',
    justifyContent: 'center',
  },
  filters: { gap: 6, paddingRight: space.screenX },
  filterDim: { opacity: 0.5 },

  // The bottom-sheet library owns position/background/rounding now (see the
  // BottomSheet's backgroundStyle/handleIndicatorStyle props); these three
  // just style its content and its handle.
  sheetBackground: {
    backgroundColor: colour.card,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    borderTopWidth: 1,
    borderTopColor: colour.line,
  },
  sheetHandle: {
    width: 38,
    height: 4,
    borderRadius: 99,
    backgroundColor: colour.n200,
  },
  sheetContent: { paddingHorizontal: space.screenX },
  sheetHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: space.screenX,
    paddingTop: 4,
    marginBottom: 10,
  },
  cards: { gap: CARD_GAP, paddingRight: space.screenX },
  card: { width: CARD_WIDTH },
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
  cardFootChips: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  empty: { paddingBottom: 14 },
  detail: { paddingBottom: 6 },
  closureBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderWidth: 1,
    borderRadius: radius.card,
    padding: 10,
    marginBottom: 12,
  },
  detailHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  statsRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  statCard: { flex: 1, padding: 10 },

  sheetTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  proChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: '#E7EEE4',
    borderWidth: 1,
    borderColor: '#D7E0D6',
  },
  // Same shape, filled solid once it's actually unlocked rather than just
  // a soft tint — the difference between "this is a Pro perk" and "you have
  // this Pro perk".
  proChipOn: {
    backgroundColor: colour.sand,
    borderColor: colour.sand,
  },
});
