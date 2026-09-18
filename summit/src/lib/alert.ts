/**
 * react-native-web's Alert.alert() is a total no-op — its entire
 * implementation is `static alert() {}` — so anything routed through
 * RN's Alert on web is exactly as visible as never calling it at all.
 * window.alert()/window.confirm() are the web-native equivalent for the
 * two shapes this app actually uses.
 */
import { Alert, Platform } from 'react-native';

export function alertUser(title: string, message?: string): void {
  if (Platform.OS === 'web') {
    window.alert(message ? `${title}\n\n${message}` : title);
    return;
  }
  Alert.alert(title, message);
}

export function confirmUser(
  title: string,
  message: string | undefined,
  onConfirm: () => void,
  options?: { confirmLabel?: string; destructive?: boolean },
): void {
  if (Platform.OS === 'web') {
    if (window.confirm(message ? `${title}\n\n${message}` : title)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    {
      text: options?.confirmLabel ?? 'OK',
      style: options?.destructive ? 'destructive' : 'default',
      onPress: onConfirm,
    },
  ]);
}
