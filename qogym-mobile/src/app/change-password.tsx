import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { authApi, errMsg } from '@/lib/api';
import { colors, radius } from '@/theme';
import { Button, Card, Input, ScreenHeader } from '@/components/ui';
import { useToast } from '@/components/Feedback';

export default function ChangePassword() {
  const toast = useToast();
  const [f, setF] = useState({ cur: '', next: '', confirm: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError('');
    if (!f.cur || !f.next) return setError('Tous les champs sont requis');
    if (f.next.length < 6) return setError('Le nouveau mot de passe doit contenir au moins 6 caractères');
    if (f.next !== f.confirm) return setError('Les mots de passe ne correspondent pas');
    setLoading(true);
    try {
      await authApi.changePassword(f.cur, f.next);
      toast('Mot de passe modifié', 'success');
      router.back();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title="Mot de passe" />
      <View style={{ padding: 16 }}>
        <Card style={{ gap: 12 }}>
          {!!error && <Text style={{ color: colors.danger, backgroundColor: colors.dangerSoft, padding: 10, borderRadius: radius.md }}>{error}</Text>}
          <Input label="Mot de passe actuel" value={f.cur} onChangeText={(v) => setF({ ...f, cur: v })} secureTextEntry autoComplete="current-password" />
          <Input label="Nouveau mot de passe" value={f.next} onChangeText={(v) => setF({ ...f, next: v })} secureTextEntry autoComplete="new-password" />
          <Input label="Confirmer" value={f.confirm} onChangeText={(v) => setF({ ...f, confirm: v })} secureTextEntry onSubmitEditing={submit} />
          <Button title="Modifier le mot de passe" onPress={submit} loading={loading} />
        </Card>
      </View>
    </View>
  );
}
