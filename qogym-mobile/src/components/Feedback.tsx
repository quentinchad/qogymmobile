import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { colors, radius } from '@/theme';
import { Button } from './ui';

// ── Toasts ──────────────────────────────────────────────────────────────
type ToastKind = 'success' | 'error' | 'info';
type ToastFn = (msg: string, kind?: ToastKind) => void;
const ToastCtx = createContext<ToastFn>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<{ msg: string; kind: ToastKind; id: number } | null>(null);
  const anim = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback<ToastFn>(
    (msg, kind = 'info') => {
      if (timer.current) clearTimeout(timer.current);
      setToast({ msg, kind, id: Date.now() });
      if (kind === 'error') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      if (kind === 'success') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      anim.setValue(0);
      Animated.timing(anim, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
      timer.current = setTimeout(() => {
        Animated.timing(anim, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => setToast(null));
      }, kind === 'error' ? 3800 : 2600);
    },
    [anim],
  );

  const icon = toast?.kind === 'success' ? 'checkmark-circle' : toast?.kind === 'error' ? 'alert-circle' : 'information-circle';
  const tint = toast?.kind === 'success' ? colors.success : toast?.kind === 'error' ? colors.danger : colors.gold;

  return (
    <ToastCtx.Provider value={show}>
      {children}
      {toast && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.toast,
            {
              top: insets.top + 10,
              opacity: anim,
              transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-20, 0] }) }],
            },
          ]}
        >
          <Ionicons name={icon} size={20} color={tint} />
          <Text style={styles.toastText}>{toast.msg}</Text>
        </Animated.View>
      )}
    </ToastCtx.Provider>
  );
}

// ── Confirmation ────────────────────────────────────────────────────────
type ConfirmOpts = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'primary' | 'danger';
};
type ConfirmFn = (o: ConfirmOpts) => Promise<boolean>;
const ConfirmCtx = createContext<ConfirmFn>(async () => false);
export const useConfirm = () => useContext(ConfirmCtx);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOpts | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((o) => {
    return new Promise<boolean>((resolve) => {
      // Une confirmation déjà ouverte est annulée proprement.
      resolver.current?.(false);
      resolver.current = resolve;
      setOpts(o);
    });
  }, []);

  const close = (v: boolean) => {
    resolver.current?.(v);
    resolver.current = null;
    setOpts(null);
  };

  const value = useMemo(() => confirm, [confirm]);
  return (
    <ConfirmCtx.Provider value={value}>
      {children}
      <Modal transparent visible={!!opts} animationType="fade" statusBarTranslucent onRequestClose={() => close(false)}>
        <Pressable style={styles.backdrop} onPress={() => close(false)}>
          <Pressable style={styles.dialog} onPress={() => {}}>
            <Text style={styles.dTitle}>{opts?.title}</Text>
            {opts?.message ? <Text style={styles.dMsg}>{opts.message}</Text> : null}
            <View style={styles.dActions}>
              <Button title={opts?.cancelLabel || 'Annuler'} variant="secondary" onPress={() => close(false)} style={{ flex: 1 }} />
              <Button
                title={opts?.confirmLabel || 'Confirmer'}
                variant={opts?.variant === 'danger' ? 'danger' : 'primary'}
                onPress={() => close(true)}
                style={[{ flex: 1 }, opts?.variant === 'danger' && { backgroundColor: colors.danger, borderColor: colors.danger }]}
              />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </ConfirmCtx.Provider>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface3,
    borderRadius: radius.md,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    elevation: 12,
    zIndex: 1000,
  },
  toastText: { color: colors.text, fontSize: 14, fontWeight: '600', flex: 1 },
  backdrop: { flex: 1, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center', padding: 24 },
  dialog: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dTitle: { fontSize: 18, fontWeight: '800', color: colors.text, marginBottom: 8 },
  dMsg: { fontSize: 15, color: colors.textDim, lineHeight: 21 },
  dActions: { flexDirection: 'row', gap: 10, marginTop: 20 },
});
