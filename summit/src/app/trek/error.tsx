/**
 * Trek error boundary.
 *
 * Catches render errors on the live trek and arrival screens. These screens
 * sit above the tabs and are where the product's core action happens, so
 * the recovery UI is slightly more reassuring: the trek data lives in
 * Zustand and SQLite, not in React state, so a render crash here does not
 * destroy the recording.
 *
 * The background recorder runs in a separate JS context via expo-task-manager.
 * A render error in this tree cannot stop it.
 */
import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { Button, H2, Label } from '@/components/ui';
import { colour, space } from '@/theme/tokens';

export default function TrekErrorBoundary({
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
        backgroundColor: colour.forest,
        paddingHorizontal: space.screenX,
      }}>
      <H2 style={{ color: colour.n50, marginBottom: 8 }}>Something went wrong</H2>
      <Label style={{ color: 'rgba(242,242,238,0.7)', textAlign: 'center', marginBottom: 24 }}>
        {__DEV__
          ? error.message
          : 'Your trek is still being recorded. Tap below to return to it.'}
      </Label>
      <Button label="Retry" onPress={reset} />
      <Button
        label="Back to trek"
        variant="ghost"
        onPress={() => {
          reset();
          router.back();
        }}
      />
    </View>
  );
}
