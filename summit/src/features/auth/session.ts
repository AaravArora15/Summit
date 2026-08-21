/**
 * Who the user is.
 *
 * The trek loop has been unable to complete since it was written, because
 * sync.ts asks Supabase for a user and there was never any code that created
 * one. This is that code.
 *
 * ---------------------------------------------------------------------------
 * Why anonymous sign-in is the default path
 * ---------------------------------------------------------------------------
 *
 * Summit's first action is going outside and walking somewhere. Putting an
 * account wall in front of that trades the thing the product is for the thing
 * the backend wants. An anonymous session is a real Supabase user with a real
 * uuid, so RLS, pioneer allocation and the league all work identically; it
 * simply has no email attached yet.
 *
 * The upgrade path is why this is not a throwaway local id: `linkIdentity`
 * attaches Apple or Google to the SAME user row later, so badges and pioneer
 * numbers earned as a guest survive. A local-only id would have to be migrated,
 * and a permanent number that moves between accounts is exactly the thing this
 * product cannot afford to get wrong.
 *
 * The cost, stated plainly: an anonymous session lives in this app's storage.
 * Delete the app and the identity goes with it, along with every pioneer number
 * on it. So the app should ask for a real identity once the user holds
 * something worth losing, which is the first claim, not the first launch.
 */
import { useEffect, useState } from 'react';

import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';

export type SessionState =
  | { status: 'loading' }
  | { status: 'unconfigured' }
  | { status: 'signed-out' }
  | { status: 'signed-in'; userId: string; isAnonymous: boolean };

/**
 * Current session, kept live.
 *
 * onAuthStateChange rather than a one-shot getSession: the token refreshes on
 * its own schedule, and a screen holding a stale "signed out" would send
 * someone back to the gate mid-trek.
 */
export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>(
    isSupabaseConfigured ? { status: 'loading' } : { status: 'unconfigured' },
  );

  useEffect(() => {
    if (!isSupabaseConfigured) return;

    const supabase = getSupabase();
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (active) setState(toState(data.session));
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setState(toState(session));
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return state;
}

function toState(session: { user: { id: string; is_anonymous?: boolean } } | null): SessionState {
  if (!session?.user) return { status: 'signed-out' };
  return {
    status: 'signed-in',
    userId: session.user.id,
    isAnonymous: Boolean(session.user.is_anonymous),
  };
}

/**
 * Start walking without an account.
 *
 * Requires "Allow anonymous sign-ins" in the Supabase project's auth settings.
 * It is off by default and the error when it is off is unhelpfully generic, so
 * that is the first thing to check if this fails.
 */
export async function continueAsGuest(): Promise<void> {
  const { error } = await getSupabase().auth.signInAnonymously();
  if (error) throw new Error(error.message);
}

/**
 * Attach a permanent identity to the CURRENT user, keeping their claims.
 *
 * linkIdentity, not signInWithOAuth: signing in would create a second user and
 * silently strand every pioneer number earned as a guest on the first one.
 */
export async function attachIdentity(provider: 'apple' | 'google'): Promise<void> {
  const { error } = await getSupabase().auth.linkIdentity({ provider });
  if (error) throw new Error(error.message);
}

export async function signOut(): Promise<void> {
  await getSupabase().auth.signOut();
}
