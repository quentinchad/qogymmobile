import React, { useState } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { authApi, errMsg } from '@/lib/api';
import { Button, Input, ScreenHeader, T } from '@/components/ui';
import { colors, radius } from '@/theme';
import { authStyles } from './login';

export default function Register() {
  const insets = useSafeAreaInsets();
  const [f, setF] = useState({ username: '', email: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);
  const [registered, setRegistered] = useState<string | null>(null);

  const submit = async () => {
    setError('');
    if (!f.username.trim() || !f.email.trim() || !f.password) return setError('Tous les champs sont requis');
    if (f.password !== f.confirm) return setError('Les mots de passe ne correspondent pas');
    if (f.password.length < 6) return setError('Le mot de passe doit contenir au moins 6 caractères');
    setLoading(true);
    try {
      const r = await authApi.register(f.email.trim(), f.username.trim(), f.password);
      if (r?.success) setRegistered(r.email || f.email.trim());
    } catch (e) {
      setError(errMsg(e, "Erreur lors de l'inscription"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title="Créer un compte" />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 30 }} keyboardShouldPersistTaps="handled">
          {registered ? (
            <View style={styles.card}>
              <T v="h2">Vérifie ta boîte mail 📬</T>
              <T v="small" style={{ lineHeight: 20 }}>
                Un email de confirmation a été envoyé à <Text style={{ color: colors.text, fontWeight: '700' }}>{registered}</Text>. Clique sur le
                lien qu'il contient pour activer ton compte (valable 24 h), puis reviens te connecter.
              </T>
              {!!info && <Text style={authStyles.info}>{info}</Text>}
              <Button
                title="Je n'ai rien reçu, renvoyer"
                variant="secondary"
                onPress={async () => {
                  try {
                    await authApi.resendVerification(registered);
                    setInfo('Email renvoyé !');
                  } catch (e) {
                    setInfo(errMsg(e));
                  }
                }}
              />
              <Button title="Aller à la connexion" onPress={() => router.replace('/login')} />
            </View>
          ) : (
            <View style={styles.card}>
              {!!error && <Text style={authStyles.error}>{error}</Text>}
              <Input label="Nom d'utilisateur" value={f.username} onChangeText={(v) => setF({ ...f, username: v })} autoCapitalize="none" placeholder="tonpseudo" />
              <Input label="Email" value={f.email} onChangeText={(v) => setF({ ...f, email: v })} autoCapitalize="none" keyboardType="email-address" placeholder="ton@email.com" />
              <Input label="Mot de passe" value={f.password} onChangeText={(v) => setF({ ...f, password: v })} secureTextEntry placeholder="6 caractères minimum" />
              <Input label="Confirmer le mot de passe" value={f.confirm} onChangeText={(v) => setF({ ...f, confirm: v })} secureTextEntry onSubmitEditing={submit} />
              <Button title="S'inscrire" onPress={submit} loading={loading} />
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: 18, gap: 14, borderWidth: 1, borderColor: colors.border },
});
