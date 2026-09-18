/**
 * RevenueCat wiring: who can see the paywall-gated screens (see
 * app/analytics.tsx), and how the app's own user id gets tied to a
 * RevenueCat customer.
 *
 * Same trust level as `isSupabaseConfigured` in lib/supabase.ts: no API keys
 * set means the paywall is simply off rather than the app crashing, so this
 * runs fine with nothing configured yet — see EXPO_PUBLIC_REVENUECAT_IOS_KEY
 * / _ANDROID_KEY in .env.example.
 *
 * Everything here reads and grants exactly one entitlement, `PRO_ENTITLEMENT`
 * ("pro" in the RevenueCat dashboard). The free tier keeps every badge,
 * pioneer number and set — this entitlement gates the advanced trek
 * analytics screen only, nothing in the core trek/claim loop.
 */
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import Purchases, { LOG_LEVEL, type CustomerInfo } from 'react-native-purchases';
import RevenueCatUI, { PAYWALL_RESULT } from 'react-native-purchases-ui';

export const PRO_ENTITLEMENT = 'pro';

const IOS_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY;
const ANDROID_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY;

/** True once a real key exists for this platform. Web has no store to buy
 *  from at all, so it is never configured regardless of the env vars. */
export const isPurchasesConfigured =
  Platform.OS === 'ios' ? Boolean(IOS_KEY) : Platform.OS === 'android' ? Boolean(ANDROID_KEY) : false;

let configured = false;

/**
 * Call once, as early as app boot as possible (see _layout.tsx). Configures
 * with no `appUserID` — the SDK starts out under its own anonymous id;
 * `syncPurchasesIdentity` below links it to Summit's real user id once the
 * Supabase session resolves, which happens on its own schedule (anonymous
 * sign-in, a stored session refreshing, etc.) and shouldn't block the SDK
 * from being ready before then.
 */
export function configurePurchases(): void {
  if (configured || !isPurchasesConfigured) return;
  configured = true;

  if (__DEV__) Purchases.setLogLevel(LOG_LEVEL.DEBUG);
  Purchases.configure({ apiKey: (Platform.OS === 'ios' ? IOS_KEY : ANDROID_KEY) as string });
}

/**
 * Ties the RevenueCat customer to Summit's own Supabase user id (anonymous
 * or not — see features/auth/session.ts on why an anonymous id is still a
 * real, permanent one here). Safe to call every time the session resolves;
 * logging in with the same id twice is a no-op.
 */
export async function syncPurchasesIdentity(userId: string): Promise<void> {
  if (!isPurchasesConfigured) return;
  try {
    await Purchases.logIn(userId);
  } catch (error) {
    console.warn('[purchases] logIn failed', error);
  }
}

function hasEntitlement(info: CustomerInfo, entitlement: string): boolean {
  return info.entitlements.active[entitlement] !== undefined;
}

/**
 * Live entitlement status: null while the first check is in flight, then
 * true/false and kept current via RevenueCat's own update listener (a
 * purchase completing, a subscription lapsing, a restore). Unconfigured
 * resolves straight to false rather than null, since there is nothing to
 * wait on.
 */
export function usePro(): boolean | null {
  const [pro, setPro] = useState<boolean | null>(isPurchasesConfigured ? null : false);

  useEffect(() => {
    if (!isPurchasesConfigured) return;
    let active = true;

    Purchases.getCustomerInfo()
      .then((info) => {
        if (active) setPro(hasEntitlement(info, PRO_ENTITLEMENT));
      })
      .catch((error) => {
        console.warn('[purchases] getCustomerInfo failed', error);
        if (active) setPro(false);
      });

    const listener = (info: CustomerInfo) => setPro(hasEntitlement(info, PRO_ENTITLEMENT));
    Purchases.addCustomerInfoUpdateListener(listener);

    return () => {
      active = false;
      Purchases.removeCustomerInfoUpdateListener(listener);
    };
  }, []);

  return pro;
}

/**
 * Shows RevenueCat's own dashboard-configured paywall UI if (and only if)
 * the entitlement isn't already active — no custom paywall screen to build
 * or maintain here. Returns whether the user walked away with access,
 * purely as a same-call-site convenience; `usePro()` above is still the
 * real source of truth (its listener updates automatically the moment a
 * purchase completes, from this call or anywhere else).
 */
export async function presentPaywall(entitlement: string = PRO_ENTITLEMENT): Promise<boolean> {
  if (!isPurchasesConfigured) return false;
  const result = await RevenueCatUI.presentPaywallIfNeeded({ requiredEntitlementIdentifier: entitlement });
  return result === PAYWALL_RESULT.PURCHASED || result === PAYWALL_RESULT.RESTORED;
}
