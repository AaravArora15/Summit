/**
 * What the device says about itself.
 *
 * Self-reported and therefore defeatable: a rooted phone can patch the very
 * call that reports rooting, and anyone running spoofing software has already
 * cleared a higher bar than this. It is recorded because it costs nothing and
 * is useful across many accounts at once, never as grounds for refusing a
 * single claim. Expo marks the root check experimental, which is about the
 * accuracy it deserves.
 */
import * as Device from 'expo-device';

export type DeviceIntegrity = 'ok' | 'rooted' | 'emulator' | 'unknown';

export async function deviceIntegrity(): Promise<DeviceIntegrity> {
  try {
    if (!Device.isDevice) return 'emulator';
    return (await Device.isRootedExperimentalAsync()) ? 'rooted' : 'ok';
  } catch {
    return 'unknown';
  }
}
