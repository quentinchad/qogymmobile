import React, { useEffect, useRef, useState } from 'react';
import { NativeScrollEvent, NativeSyntheticEvent, Pressable, ScrollView, ScrollViewInstance, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { colors, radius } from '@/theme';
import { Sheet } from './Sheet';
import { Button } from './ui';

// 0 → 5 min par pas de 15 s (comme sur le site)
const STEP = 15;
const VALUES = Array.from({ length: 300 / STEP + 1 }, (_, i) => i * STEP);
const ITEM_H = 46;
const VISIBLE = 5;

export const formatRest = (s: number) => {
  if (s === 0) return '0s';
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m === 0) return `${sec}s`;
  if (sec === 0) return `${m}min`;
  return `${m}m${String(sec).padStart(2, '0')}`;
};

/** Roue de sélection native (défilement aimanté) pour le temps de repos. */
export function RestTimePicker({
  visible,
  value,
  onChange,
  onClose,
  title = 'Temps de repos',
}: {
  visible: boolean;
  value: number;
  onChange: (v: number) => void;
  onClose: () => void;
  title?: string;
}) {
  const snap = (v: number) => VALUES[Math.max(0, Math.min(VALUES.length - 1, Math.round((v || 0) / STEP)))];
  const [selected, setSelected] = useState(snap(value));
  const ref = useRef<ScrollViewInstance>(null);

  useEffect(() => {
    if (!visible) return;
    const v = snap(value);
    setSelected(v);
    const t = setTimeout(() => ref.current?.scrollTo({ y: VALUES.indexOf(v) * ITEM_H, animated: false }), 30);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const idx = Math.max(0, Math.min(VALUES.length - 1, Math.round(e.nativeEvent.contentOffset.y / ITEM_H)));
    const v = VALUES[idx];
    if (v !== selected) {
      setSelected(v);
      Haptics.selectionAsync().catch(() => {});
    }
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={title}
      scroll={false}
      footer={
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Button title="Annuler" variant="secondary" onPress={onClose} style={{ flex: 1 }} />
          <Button
            title="Valider"
            onPress={() => {
              onChange(selected);
              onClose();
            }}
            style={{ flex: 1 }}
          />
        </View>
      }
    >
      <View style={styles.wheel}>
        <View pointerEvents="none" style={styles.window} />
        <ScrollView
          ref={ref}
          showsVerticalScrollIndicator={false}
          snapToInterval={ITEM_H}
          decelerationRate="fast"
          onScroll={onScroll}
          scrollEventThrottle={32}
          nestedScrollEnabled
          contentContainerStyle={{ paddingVertical: ITEM_H * Math.floor(VISIBLE / 2) }}
        >
          {VALUES.map((v) => (
            <Pressable
              key={v}
              style={styles.item}
              onPress={() => {
                setSelected(v);
                ref.current?.scrollTo({ y: VALUES.indexOf(v) * ITEM_H, animated: true });
              }}
            >
              <Text style={[styles.itemText, v === selected && styles.itemSel]}>{formatRest(v)}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  wheel: { height: ITEM_H * VISIBLE, marginVertical: 8 },
  window: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: ITEM_H * Math.floor(VISIBLE / 2),
    height: ITEM_H,
    borderRadius: radius.md,
    backgroundColor: colors.goldSoft,
    borderWidth: 1,
    borderColor: 'rgba(212,166,74,0.4)',
  },
  item: { height: ITEM_H, alignItems: 'center', justifyContent: 'center' },
  itemText: { fontSize: 18, color: colors.textFaint, fontWeight: '600' },
  itemSel: { fontSize: 22, color: colors.goldLight, fontWeight: '800' },
});
