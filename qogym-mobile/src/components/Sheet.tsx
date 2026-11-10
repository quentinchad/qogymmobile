import React, { useEffect, useRef, useState } from 'react';
import { Animated, BackHandler, Dimensions, Easing, KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius } from '@/theme';
import { IconBtn } from './ui';

/**
 * Feuille modale qui monte du bas (animations natives via useNativeDriver).
 */
export function Sheet({
  visible,
  onClose,
  title,
  children,
  footer,
  scroll = true,
  maxHeight = 0.88,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  scroll?: boolean;
  maxHeight?: number;
}) {
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(visible);
  const anim = useRef(new Animated.Value(0)).current;
  const H = Dimensions.get('window').height;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.timing(anim, { toValue: 1, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    } else if (mounted) {
      Animated.timing(anim, { toValue: 0, duration: 180, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(() =>
        setMounted(false),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  if (!mounted) return null;
  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [H * 0.6, 0] });

  return (
    <Modal transparent visible statusBarTranslucent navigationBarTranslucent animationType="none" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay, opacity: anim }]}>
          <Pressable style={{ flex: 1 }} onPress={onClose} />
        </Animated.View>
        <View style={{ flex: 1, justifyContent: 'flex-end' }} pointerEvents="box-none">
          <Animated.View style={[styles.sheet, { maxHeight: H * maxHeight, paddingBottom: Math.max(insets.bottom, 12), transform: [{ translateY }] }]}>
            <View style={styles.grip} />
            {title ? (
              <View style={styles.head}>
                <Text style={styles.title} numberOfLines={1}>
                  {title}
                </Text>
                <IconBtn name="close" onPress={onClose} color={colors.textDim} label="Fermer" />
              </View>
            ) : null}
            {scroll ? (
              <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 12 }}>
                {children}
              </ScrollView>
            ) : (
              <View style={{ paddingHorizontal: 18, flexShrink: 1 }}>{children}</View>
            )}
            {footer ? <View style={styles.footer}>{footer}</View> : null}
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** Gère le bouton retour Android pour fermer un overlay maison. */
export function useBackClose(active: boolean, onClose: () => void) {
  useEffect(() => {
    if (!active) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [active, onClose]);
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  grip: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, marginTop: 8, marginBottom: 4 },
  head: { flexDirection: 'row', alignItems: 'center', paddingLeft: 18, paddingRight: 8, paddingBottom: 6 },
  title: { flex: 1, fontSize: 18, fontWeight: '800', color: colors.text },
  footer: { paddingHorizontal: 18, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border },
});
