import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUpdate } from '@/lib/update';
import { colors, radius } from '@/theme';
import { Bar } from './Visuals';
import { Button } from './ui';

/** Bannière "Nouvelle version disponible" — l'utilisateur peut toujours choisir "Plus tard". */
export function UpdateBanner() {
  const u = useUpdate();
  const insets = useSafeAreaInsets();
  if (!u.available || u.dismissed || !u.info) return <View style={{ height: insets.top }} />;
  return (
    <View style={[styles.wrap, { paddingTop: insets.top + 8 }]}>
      <View style={styles.row}>
        <Ionicons name="cloud-download" size={22} color={colors.goldLight} />
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>
            {u.mandatory ? 'Mise à jour requise' : 'Nouvelle version disponible'}
            {u.info.latestVersion ? ` — ${u.info.latestVersion}` : ''}
          </Text>
          {!!u.info.releaseNotes && (
            <Text style={styles.notes} numberOfLines={2}>
              {u.info.releaseNotes}
            </Text>
          )}
        </View>
      </View>
      {u.progress !== null ? (
        <View style={{ gap: 6, marginTop: 10 }}>
          <Bar pct={u.progress * 100} color={colors.gold} />
          <Text style={styles.notes}>Téléchargement… {Math.round(u.progress * 100)} %</Text>
        </View>
      ) : (
        <View style={styles.actions}>
          {!u.mandatory && <Button title="Plus tard" variant="ghost" small onPress={u.dismiss} />}
          <Button title="Mettre à jour" small icon="download-outline" onPress={u.install} />
        </View>
      )}
      {!!u.error && (
        <View style={{ marginTop: 6, gap: 6 }}>
          <Text style={[styles.notes, { color: colors.danger }]}>{u.error}</Text>
          <Button title="Ouvrir dans le navigateur" variant="ghost" small icon="open-outline" onPress={u.openInBrowser} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.surface2,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(212,166,74,0.35)',
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
  },
  row: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  title: { color: colors.text, fontWeight: '800', fontSize: 14 },
  notes: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 8 },
});
