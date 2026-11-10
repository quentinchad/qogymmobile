import React, { useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors, radius } from '@/theme';

const ROW = 56;

/**
 * Liste réordonnable par glisser-déposer (poignée à gauche). Les lignes ont
 * une hauteur fixe : la position cible se calcule directement depuis le
 * déplacement du doigt, et les autres lignes s'écartent en douceur.
 */
export function ReorderList<T>({
  items,
  keyOf,
  render,
  onReorder,
  onDragChange,
}: {
  items: T[];
  keyOf: (t: T) => string;
  render: (t: T, index: number) => React.ReactNode;
  onReorder: (from: number, to: number) => void;
  onDragChange?: (dragging: boolean) => void;
}) {
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const dy = useRef(new Animated.Value(0)).current;
  const dragRef = useRef<{ from: number; to: number } | null>(null);
  const itemsLen = useRef(items.length);
  itemsLen.current = items.length;
  const cbs = useRef({ onReorder, onDragChange });
  cbs.current = { onReorder, onDragChange };

  const makeResponder = (index: number) =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
        dy.setValue(0);
        dragRef.current = { from: index, to: index };
        setDrag({ from: index, to: index });
        cbs.current.onDragChange?.(true);
      },
      onPanResponderMove: (_, g) => {
        dy.setValue(g.dy);
        const d = dragRef.current;
        if (!d) return;
        const to = Math.max(0, Math.min(itemsLen.current - 1, d.from + Math.round(g.dy / ROW)));
        if (to !== d.to) {
          Haptics.selectionAsync().catch(() => {});
          dragRef.current = { ...d, to };
          setDrag({ ...d, to });
        }
      },
      onPanResponderRelease: () => finish(),
      onPanResponderTerminate: () => finish(),
    });

  const finish = () => {
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    dy.setValue(0);
    cbs.current.onDragChange?.(false);
    if (d && d.from !== d.to) cbs.current.onReorder(d.from, d.to);
  };

  // Un responder stable par position : ne doit pas changer pendant un geste.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const responders = useMemo(() => items.map((_, i) => makeResponder(i)), [items.length]);
  return (
    <View style={{ height: items.length * ROW }}>
      {items.map((it, i) => {
        const isDragged = drag?.from === i;
        let shift = 0;
        if (drag && !isDragged) {
          if (drag.from < drag.to && i > drag.from && i <= drag.to) shift = -ROW;
          if (drag.from > drag.to && i < drag.from && i >= drag.to) shift = ROW;
        }
        const responder = responders[i];
        return (
          <Animated.View
            key={keyOf(it)}
            style={[
              styles.row,
              { top: i * ROW },
              isDragged
                ? { zIndex: 10, elevation: 8, transform: [{ translateY: dy }, { scale: 1.02 }], backgroundColor: colors.surface3 }
                : { transform: [{ translateY: shift }] },
            ]}
          >
            <View {...responder.panHandlers} style={styles.grip} hitSlop={8}>
              <Ionicons name="reorder-three" size={26} color={isDragged ? colors.goldLight : colors.textDim} />
            </View>
            <Text style={styles.num}>{i + 1}</Text>
            <View style={{ flex: 1 }}>{render(it, i)}</View>
          </Animated.View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: ROW - 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surface2,
    borderRadius: radius.md,
    paddingRight: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  grip: { width: 48, height: '100%', alignItems: 'center', justifyContent: 'center' },
  num: { color: colors.textFaint, fontWeight: '800', width: 22, textAlign: 'center' },
});
