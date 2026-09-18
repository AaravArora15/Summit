import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { useFonts } from 'expo-font';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useSession } from '@/features/auth/session';
import { bootstrapInactivityNudge } from '@/features/trek/inactivity-nudge';
import { initTrekStore, isTrekStoreAvailable } from '@/features/trek/recorder';
import { syncPendingTreks } from '@/features/trek/sync';
import { configurePurchases, syncPurchasesIdentity } from '@/lib/purchases';
import { colour } from '@/theme/tokens';

SplashScreen.preventAutoHideAsync();

// How a secret spot alert behaves when it arrives with the app already open.
// Banner but no sound: this fires while someone is out walking, and a place
// that will still be there tomorrow has not earned an interruption.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Trails have no signal. Failing loudly on every dropped request makes
      // the app feel broken when it is simply offline, so hold cached data.
      staleTime: 30_000,
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
});

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Inter: require('@/assets/fonts/Inter-Regular.ttf'),
    'Inter-Medium': require('@/assets/fonts/Inter-Medium.ttf'),
    'Inter-SemiBold': require('@/assets/fonts/Inter-SemiBold.ttf'),
    'Inter-Bold': require('@/assets/fonts/Inter-Bold.ttf'),
    'Outfit-Bold': require('@/assets/fonts/Outfit-Bold.ttf'),
  });

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync();
  }, [fontsLoaded]);

  useEffect(() => {
    // As early as possible, deliberately before any session is known — see
    // lib/purchases.ts on why AuthGate links the real user id in later
    // rather than this waiting on it. A no-op if no RevenueCat keys are set.
    configurePurchases();
  }, []);

  useEffect(() => {
    // Local trek storage, then drain anything left over from a previous walk.
    // Both are best-effort: a phone that cannot open the database should still
    // reach the rest of the app.
    if (!isTrekStoreAvailable()) return;
    try {
      initTrekStore();
    } catch (error) {
      console.warn('[trek] could not initialise local store', error);
      return;
    }
    void syncPendingTreks();
  }, []);

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          {/* The product is light-native. There is no dark theme by design. */}
          <StatusBar style="dark" />
          <AuthGate />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colour.bg },
            }}>
            <Stack.Screen name="(tabs)" />
            {/* The trek loop is presented over the tabs: once you are walking,
                the tab bar is not what you want to be looking at. */}
            <Stack.Screen name="trek/live" options={{ gestureEnabled: false }} />
            <Stack.Screen name="trek/arrival" options={{ gestureEnabled: false }} />
            <Stack.Screen name="set/[id]" />
            <Stack.Screen name="territory/[id]" />
            <Stack.Screen name="badges" />
            <Stack.Screen name="settings" />
            <Stack.Screen name="treks" />
            <Stack.Screen name="suggest" />
            <Stack.Screen name="suggestions" />
            <Stack.Screen name="review" />
            <Stack.Screen name="sign-in" options={{ gestureEnabled: false }} />
            {/* The other half of the gate: sign-up for new accounts, log-in
                for existing ones. Both sit outside the tabs by design. */}
            <Stack.Screen name="log-in" />
            <Stack.Screen name="sign-up" />
          </Stack>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/**
 * Sends the user to the gate when there is no session, and away from it once
 * there is.
 *
 * A component rather than logic inside RootLayout because navigating during the
 * first render of the navigator throws; this mounts as a child, so the Stack
 * exists by the time the effect runs.
 *
 * When Supabase is unconfigured this deliberately does nothing. The app still
 * opens on demo data, which is what makes the design reviewable without a
 * backend, and a gate that could never be passed would take that away.
 */
function AuthGate() {
  const session = useSession();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    // Links RevenueCat's customer to Summit's own user id the moment a
    // session exists — an anonymous Supabase user is still a real,
    // permanent id here (see features/auth/session.ts), so there is no
    // "wait for a real account" case to special-case.
    if (session.status === 'signed-in') void syncPurchasesIdentity(session.userId);
    // (Re)arms the inactivity reminder from whatever "last trek" is already
    // known, local or server — see inactivity-nudge.ts. Runs every time this
    // effect fires, not just once: cheap (a local read, no-op on the common
    // path where AsyncStorage already has a value), and correct after a
    // sign-out/sign-in switches accounts on the same device, since the
    // stored key is per-user.
    if (session.status === 'signed-in') void bootstrapInactivityNudge(session.userId);
  }, [session]);

  useEffect(() => {
    if (session.status === 'loading' || session.status === 'unconfigured') return;

    // All three auth screens sit outside the tabs; a signed-out user is
    // welcome on any of them, and only the app itself requires a session.
    const atGate =
      segments[0] === 'sign-in' || segments[0] === 'log-in' || segments[0] === 'sign-up';

    if (session.status === 'signed-out' && !atGate) {
      router.replace('/sign-in');
    } else if (session.status === 'signed-in' && atGate) {
      router.replace('/(tabs)');
    }
  }, [session, segments, router]);

  return null;
}
