import { useEffect, useState } from 'react';
import { Alert, Modal, Platform, Pressable, StyleSheet, View, type AlertButton } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Palette, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// react-native-web's Alert.alert does nothing, which silently breaks every
// confirmation and error message in the hosted web app. On web, Alert.alert is
// routed to this dialog instead (same buttons and callbacks as Android).

type Pending = { id: number; title: string; message?: string; buttons: AlertButton[] };

let nextId = 1;
let queue: Pending[] = [];
const listeners = new Set<(queue: Pending[]) => void>();
const emit = () => listeners.forEach((listener) => listener(queue));
const dismiss = (id: number) => {
  queue = queue.filter((item) => item.id !== id);
  emit();
};

if (Platform.OS === 'web') {
  Alert.alert = (title, message, buttons) => {
    queue = [...queue, { id: nextId++, title: String(title ?? ''), message: message || undefined, buttons: buttons?.length ? buttons : [{ text: 'OK' }] }];
    emit();
  };
}

export function WebAlertHost() {
  const theme = useTheme();
  const [items, setItems] = useState<Pending[]>(queue);

  useEffect(() => {
    listeners.add(setItems);
    return () => { listeners.delete(setItems); };
  }, []);

  if (Platform.OS !== 'web') return null;
  const current = items[0];
  if (!current) return null;

  function press(button?: AlertButton) {
    dismiss(current.id);
    button?.onPress?.();
  }

  const cancel = current.buttons.find((b) => b.style === 'cancel');
  return (
    <Modal transparent visible animationType="fade" onRequestClose={() => press(cancel)}>
      <Pressable style={styles.backdrop} onPress={() => cancel && press(cancel)}>
        <Pressable style={[styles.card, { borderColor: theme.backgroundSelected }]} onPress={() => {}}>
          {current.title ? <ThemedText type="subtitle" style={styles.title}>{current.title}</ThemedText> : null}
          {current.message ? <ThemedText themeColor="textSecondary" style={styles.message}>{current.message}</ThemedText> : null}
          <View style={styles.buttons}>
            {current.buttons.map((button, index) => {
              const destructive = button.style === 'destructive';
              const isCancel = button.style === 'cancel';
              return (
                <Pressable
                  key={`${button.text}-${index}`}
                  onPress={() => press(button)}
                  style={[styles.button, isCancel ? [styles.cancel, { borderColor: theme.backgroundSelected }] : destructive ? styles.destructive : styles.primary]}
                >
                  <ThemedText type="smallBold" style={isCancel ? undefined : destructive ? styles.lightText : styles.primaryText}>{button.text || 'OK'}</ThemedText>
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(2, 6, 23, 0.65)', alignItems: 'center', justifyContent: 'center', padding: Spacing.three },
  card: { backgroundColor: '#1E293B', width: '100%', maxWidth: 420, borderRadius: 20, borderWidth: 1, padding: Spacing.four, gap: Spacing.two },
  title: { fontSize: 20, lineHeight: 26 },
  message: { lineHeight: 22 },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: Spacing.two, marginTop: Spacing.two },
  button: { minWidth: 96, borderRadius: 999, paddingVertical: 10, paddingHorizontal: Spacing.three, alignItems: 'center' },
  primary: { backgroundColor: Palette.yellow },
  primaryText: { color: '#111827' },
  destructive: { backgroundColor: Palette.red },
  lightText: { color: Palette.white },
  cancel: { borderWidth: 1 },
});
