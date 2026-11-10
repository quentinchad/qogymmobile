import React, { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { errMsg, sessionApi } from '@/lib/api';
import { isTrue } from '@/lib/format';
import { colors, radius, sessionImageUrl } from '@/theme';
import { Button, Card, IconBtn, Loader, Pill, ScreenHeader, T } from '@/components/ui';
import { ExercisePreview } from '@/components/ExercisePreview';
import { useStartWorkout } from '@/workout/useStartWorkout';

export default function SessionDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const start = useStartWorkout();
  const [s, setS] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    sessionApi
      .get(id)
      .then((r) => setS(r.session))
      .catch((e) => setError(errMsg(e, 'Séance non trouvée')));
  }, [id]);

  const editable = s && isTrue(s.is_owner) && !isTrue(s.is_qojim_session);
  const img = sessionImageUrl(s?.image_url);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader
        title={s?.name || 'Séance'}
        right={editable ? <IconBtn name="create-outline" onPress={() => router.push(`/session/edit?id=${id}`)} label="Modifier" /> : undefined}
      />
      {!s ? (
        error ? <Text style={{ color: colors.danger, padding: 20 }}>{error}</Text> : <Loader />
      ) : (
        <>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 110 }}>
            {img && <Image source={{ uri: img }} style={{ height: 180, borderRadius: radius.lg }} contentFit="cover" cachePolicy="memory-disk" />}
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              {!!s.session_type_name && <Pill label={s.session_type_name} />}
              {isTrue(s.is_qojim_session) && <Pill label="Certifiée Qojim" icon="ribbon" color={colors.purple} bg={colors.purpleSoft} />}
              <Pill label={`${(s.exercises || []).length} exercices`} icon="barbell-outline" />
            </View>
            {!!s.description && <T v="small">{s.description}</T>}
            <Card style={{ gap: 10 }}>
              <T v="h3">Exercices</T>
              <ExercisePreview exercises={s.exercises || []} />
            </Card>
          </ScrollView>
          <View style={{ position: 'absolute', left: 16, right: 16, bottom: insets.bottom + 14 }}>
            <Button title="Démarrer cette séance" icon="play" variant="success" onPress={() => start(String(id))} />
          </View>
        </>
      )}
    </View>
  );
}
