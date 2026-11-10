import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { authApi, errMsg } from '@/lib/api';
import { Button, Card, Input, ScreenHeader, T } from '@/components/ui';
import { colors } from '@/theme';
import { authStyles } from './login';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!email.trim()) return;
    setLoading(true);
    setMsg(null);
    try {
      const r = await authApi.requestPasswordReset(email.trim());
      setMsg({ ok: true, text: r?.message || 'Si un compte existe, un email de réinitialisation a été envoyé.' });
    } catch (e) {
      setMsg({ ok: false, text: errMsg(e) });
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title="Mot de passe oublié" />
      <View style={{ padding: 20 }}>
        <Card style={{ gap: 14 }}>
          <T v="small" style={{ lineHeight: 20 }}>
            Entre ton email : tu recevras un lien pour choisir un nouveau mot de passe.
          </T>
          {msg && <Text style={msg.ok ? authStyles.info : authStyles.error}>{msg.text}</Text>}
          <Input label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" onSubmitEditing={submit} />
          <Button title="Envoyer le lien" onPress={submit} loading={loading} />
        </Card>
      </View>
    </View>
  );
}
