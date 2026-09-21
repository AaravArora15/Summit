/**
 * Root error boundary.
 *
 * Catches any unhandled render error and shows a recovery screen instead of
 * crashing the entire app. The trek recorder runs in a separate JS context
 * managed by expo-task-manager, so a render error here does not stop GPS
 * recording or destroy the Zustand trek state.
 *
 * The user can tap "Try again" to re-render the failed component tree.
 */
import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { Button, H2, Label } from '@/components/ui';
import { colour, space } from '@/theme/tokens';

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  const router = useRouter();

  return (
    <View
      style={{
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: colour.bg,
        paddingHorizontal: space.screenX,
      }}>
      <H2 style={{ marginBottom: 8 }}>Something went wrong</H2>
      <Label style={{ color: colour.slate, textAlign: 'center', marginBottom: 24 }}>
        {__DEV__
          ? error.message
          : 'An unexpected error occurred. Your trek data is safe.'}
      </Label>
      <Button label="Try again" onPress={reset} />
      <Button
        label="Go home"
        variant="ghost"
        onPress={() => {
          reset();
          router.replace('/(tabs)');
        }}
      />
    </View>
  );
}
