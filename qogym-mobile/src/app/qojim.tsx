import React from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { errMsg, qojimApi } from '@/lib/api';
import { useCached } from '@/lib/storage';
import { isTrue } from '@/lib/format';
import { colors, sessionImageUrl } from '@/theme';
import { Button, Card, Empty, Loader, Pill, ScreenHeader, T } from '@/components/ui';
import { useConfirm, useToast } from '@/components/Feedback';
import { useStartWorkout } from '@/workout/useStartWorkout';

export default function Qojim() {
  const toast = useToast();
  const confirm = useConfirm();
  const start = useStartWorkout();
  const { data, setData, loading } = useCached('qojim', async () => (await qojimApi.list()).sessions || []);

  const setIn = (id: number, v: boolean) => setData((d: any) => (d || []).map((s: any) => (s.id === id ? { ...s, in_library: v } : s)));

  const add = async (s: any) => {
    try {
      await qojimApi.add(s.id);
      setIn(s.id, true);
      toast('Ajoutée à ta bibliothèque', 'success');
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };
  const remove = async (s: any) => {
    if (!(await confirm({ title: 'Retirer cette séance de ta bibliothèque ?', confirmLabel: 'Retirer', variant: 'danger' }))) return;
    try {
      await qojimApi.remove(s.id);
      setIn(s.id, false);
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title="Séances Qojim" subtitle="Programmes certifiés, prêts à l'emploi" />
      {loading ? (
        <Loader />
      ) : (
        <FlatList
          data={data || []}
          keyExtractor={(s: any) => String(s.id)}
          contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 30 }}
          ListEmptyComponent={<Empty icon="ribbon-outline" text="Aucune séance Qojim disponible pour le moment" />}
          renderItem={({ item: s }) => {
            const img = sessionImageUrl(s.image_url);
            const inLib = isTrue(s.in_library);
            return (
              <Card style={{ minHeight: 150 }} onPress={() => router.push(`/session/${s.id}`)}>
                {img && (
                  <>
                    <Image source={{ uri: img }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" />
                    <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(8,13,24,0.62)' }]} />
                  </>
                )}
                <Pill label="Certifiée Qojim" icon="ribbon" color={colors.purple} bg={colors.purpleSoft} />
                <Text style={{ color: colors.text, fontSize: 19, fontWeight: '800', marginTop: 8 }}>{s.name}</Text>
                <T v="small">
                  {s.session_type_name}
                  {s.creator_username ? ` · par ${s.creator_username}` : ''}
                </T>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                  {inLib ? (
                    <>
                      <Button title="Démarrer" icon="play" variant="success" small onPress={() => start(String(s.id))} />
                      <Button title="Retirer" variant="danger" small onPress={() => remove(s)} />
                    </>
                  ) : (
                    <Button title="Ajouter à ma bibliothèque" icon="add" small onPress={() => add(s)} />
                  )}
                </View>
              </Card>
            );
          }}
        />
      )}
    </View>
  );
}
