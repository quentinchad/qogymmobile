import React, { memo } from 'react';
import {
  ActivityIndicator,
  Pressable,
  PressableProps,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  TextInputInstance,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { avatarUrl, colors, font, radius, space } from '@/theme';

export type IconName = React.ComponentProps<typeof Ionicons>['name'];

export const tap = () => {
  Haptics.selectionAsync().catch(() => {});
};

// ── Texte ───────────────────────────────────────────────────────────────
export const T = ({
  v = 'body',
  style,
  children,
  ...rest
}: { v?: keyof typeof font; style?: StyleProp<TextStyle>; children?: React.ReactNode } & React.ComponentProps<typeof Text>) => (
  <Text style={[font[v], style]} {...rest}>
    {children}
  </Text>
);

// ── Carte ───────────────────────────────────────────────────────────────
export const Card = ({ style, children, onPress, onLongPress }: { style?: StyleProp<ViewStyle>; children: React.ReactNode; onPress?: () => void; onLongPress?: () => void }) =>
  onPress || onLongPress ? (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      android_ripple={{ color: 'rgba(255,255,255,0.05)' }}
      style={({ pressed }) => [s.card, pressed && { opacity: 0.92 }, style]}
    >
      {children}
    </Pressable>
  ) : (
    <View style={[s.card, style]}>{children}</View>
  );

// ── Boutons ─────────────────────────────────────────────────────────────
type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'outline';
export const Button = memo(function Button({
  title,
  onPress,
  variant = 'primary',
  icon,
  loading,
  disabled,
  small,
  style,
  full,
}: {
  title: string;
  onPress?: () => void;
  variant?: BtnVariant;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
  full?: boolean;
}) {
  const v = btnVariants[variant];
  const off = disabled || loading;
  return (
    <Pressable
      onPress={() => {
        if (off) return;
        tap();
        onPress?.();
      }}
      android_ripple={{ color: 'rgba(255,255,255,0.12)' }}
      style={({ pressed }) => [
        s.btn,
        small && s.btnSmall,
        { backgroundColor: v.bg, borderColor: v.border },
        full && { alignSelf: 'stretch' },
        pressed && !off && { transform: [{ scale: 0.98 }] },
        off && { opacity: 0.5 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={v.fg} />
      ) : (
        <>
          {icon && <Ionicons name={icon} size={small ? 15 : 18} color={v.fg} />}
          <Text style={[s.btnText, small && { fontSize: 13 }, { color: v.fg }]} numberOfLines={1}>
            {title}
          </Text>
        </>
      )}
    </Pressable>
  );
});

const btnVariants: Record<BtnVariant, { bg: string; fg: string; border: string }> = {
  primary: { bg: colors.gold, fg: '#1a1406', border: colors.gold },
  secondary: { bg: colors.surface3, fg: colors.text, border: colors.surface3 },
  ghost: { bg: 'transparent', fg: colors.textDim, border: 'transparent' },
  danger: { bg: colors.danger, fg: '#ffffff', border: colors.danger },
  success: { bg: colors.success, fg: '#04150c', border: colors.success },
  outline: { bg: 'transparent', fg: colors.text, border: colors.borderStrong },
};

export const IconBtn = ({
  name,
  onPress,
  color = colors.text,
  size = 22,
  bg,
  badge,
  style,
  hitSlop = 8,
  label,
}: {
  name: IconName;
  onPress?: () => void;
  color?: string;
  size?: number;
  bg?: string;
  badge?: number;
  style?: StyleProp<ViewStyle>;
  hitSlop?: number;
  label?: string;
}) => (
  <Pressable
    onPress={() => {
      tap();
      onPress?.();
    }}
    hitSlop={hitSlop}
    accessibilityLabel={label}
    android_ripple={{ color: 'rgba(255,255,255,0.15)', borderless: true }}
    style={({ pressed }) => [s.iconBtn, bg ? { backgroundColor: bg } : null, pressed && { opacity: 0.6 }, style]}
  >
    <Ionicons name={name} size={size} color={color} />
    {!!badge && badge > 0 && (
      <View style={s.badge}>
        <Text style={s.badgeText}>{badge > 9 ? '9+' : badge}</Text>
      </View>
    )}
  </Pressable>
);

// ── Champs ──────────────────────────────────────────────────────────────
export const Input = React.forwardRef<TextInputInstance, TextInputProps & { label?: string; containerStyle?: StyleProp<ViewStyle> }>(
  function Input({ label, containerStyle, style, ...props }, ref) {
    return (
      <View style={[{ gap: 6 }, containerStyle]}>
        {label ? <Text style={s.label}>{label}</Text> : null}
        <TextInput
          ref={ref}
          placeholderTextColor={colors.textFaint}
          selectionColor={colors.gold}
          cursorColor={colors.gold}
          style={[s.input, props.multiline && { minHeight: 90, textAlignVertical: 'top', paddingTop: 12 }, style]}
          {...props}
        />
      </View>
    );
  },
);

export const Chip = ({ label, active, onPress, icon }: { label: string; active?: boolean; onPress?: () => void; icon?: IconName }) => (
  <Pressable
    onPress={() => {
      tap();
      onPress?.();
    }}
    style={[s.chip, active && { backgroundColor: colors.goldSoft, borderColor: colors.gold }]}
  >
    {icon && <Ionicons name={icon} size={14} color={active ? colors.goldLight : colors.textDim} />}
    <Text style={[s.chipText, active && { color: colors.goldLight }]}>{label}</Text>
  </Pressable>
);

export const Pill = ({ label, color = colors.textDim, bg = colors.surface3, icon }: { label: string; color?: string; bg?: string; icon?: IconName }) => (
  <View style={[s.pill, { backgroundColor: bg }]}>
    {icon && <Ionicons name={icon} size={12} color={color} />}
    <Text style={[s.pillText, { color }]}>{label}</Text>
  </View>
);

// ── Avatar ──────────────────────────────────────────────────────────────
export const Avatar = memo(function Avatar({ name, pdp, size = 40, onPress }: { name?: string; pdp?: string | null; size?: number; onPress?: () => void }) {
  const url = avatarUrl(pdp);
  const inner = url ? (
    <Image source={{ uri: url }} style={{ width: size, height: size, borderRadius: size / 2 }} cachePolicy="memory-disk" transition={120} />
  ) : (
    <View style={[s.avatarFallback, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={{ color: colors.goldLight, fontWeight: '800', fontSize: size * 0.42 }}>{(name || '?').charAt(0).toUpperCase()}</Text>
    </View>
  );
  return onPress ? (
    <Pressable onPress={onPress} hitSlop={4}>
      {inner}
    </Pressable>
  ) : (
    inner
  );
});

// ── États ───────────────────────────────────────────────────────────────
export const Loader = ({ label, style }: { label?: string; style?: StyleProp<ViewStyle> }) => (
  <View style={[{ padding: 40, alignItems: 'center', gap: 12 }, style]}>
    <ActivityIndicator color={colors.gold} size="large" />
    {label ? <T v="small">{label}</T> : null}
  </View>
);

export const Empty = ({ icon = 'sparkles-outline', title, text, action }: { icon?: IconName; title?: string; text?: string; action?: React.ReactNode }) => (
  <View style={s.empty}>
    <View style={s.emptyIcon}>
      <Ionicons name={icon} size={30} color={colors.gold} />
    </View>
    {title ? <T v="h3" style={{ textAlign: 'center' }}>{title}</T> : null}
    {text ? <T v="small" style={{ textAlign: 'center', lineHeight: 19 }}>{text}</T> : null}
    {action}
  </View>
);

export const SectionTitle = ({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) => (
  <View style={s.sectionRow}>
    <Text style={s.sectionTitle}>{children}</Text>
    {right}
  </View>
);

// ── En-tête d'écran (écrans hors onglets) ───────────────────────────────
export const ScreenHeader = ({ title, subtitle, right, onBack }: { title: string; subtitle?: string; right?: React.ReactNode; onBack?: () => void }) => {
  const insets = useSafeAreaInsets();
  return (
    <View style={[s.header, { paddingTop: insets.top + 6 }]}>
      <IconBtn
        name="chevron-back"
        size={26}
        onPress={onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/')))}
        label="Retour"
      />
      <View style={{ flex: 1, marginLeft: 4 }}>
        <Text style={s.headerTitle} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={font.small} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  );
};

/** Titre de page dans les onglets principaux */
export const TabTitle = ({ title, right }: { title: string; right?: React.ReactNode }) => (
  <View style={s.tabTitleRow}>
    <Text style={font.h1}>{title}</Text>
    <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>{right}</View>
  </View>
);

export const Divider = ({ style }: { style?: StyleProp<ViewStyle> }) => <View style={[{ height: 1, backgroundColor: colors.border }, style]} />;

export const Row = ({ children, style, gap = 8 }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; gap?: number }) => (
  <View style={[{ flexDirection: 'row', alignItems: 'center', gap }, style]}>{children}</View>
);

export const PressRow = ({ children, onPress, style }: { children: React.ReactNode; onPress: () => void } & Omit<PressableProps, 'children' | 'style'> & { style?: StyleProp<ViewStyle> }) => (
  <Pressable onPress={onPress} android_ripple={{ color: 'rgba(255,255,255,0.05)' }} style={({ pressed }) => [style, pressed && { opacity: 0.85 }]}>
    {children}
  </Pressable>
);

export const s = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  btn: {
    minHeight: 46,
    paddingHorizontal: 18,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    overflow: 'hidden',
  },
  btnSmall: { minHeight: 36, paddingHorizontal: 12, borderRadius: 10 },
  btnText: { fontSize: 15, fontWeight: '700' },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute',
    top: 2,
    right: 0,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: { color: 'white', fontSize: 10, fontWeight: '800' },
  label: { fontSize: 13, fontWeight: '600', color: colors.textDim },
  input: {
    backgroundColor: colors.surface2,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    fontSize: 16,
    paddingHorizontal: 14,
    minHeight: 48,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    height: 34,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface2,
  },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.textDim },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  pillText: { fontSize: 12, fontWeight: '700' },
  avatarFallback: { backgroundColor: colors.purpleSoft, alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', paddingVertical: 36, paddingHorizontal: 24, gap: 10 },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.goldSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  sectionTitle: { fontSize: 13, fontWeight: '800', color: colors.textDim, textTransform: 'uppercase', letterSpacing: 0.8 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingBottom: 8,
    backgroundColor: colors.bg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: { fontSize: 18, fontWeight: '800', color: colors.text },
  tabTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, minHeight: 44 },
});
