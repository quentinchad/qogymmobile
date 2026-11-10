import React, { useRef, useState } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, Text, TextInput, View , TextInputInstance } from 'react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { authApi, ApiError, errMsg } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button, Input, T } from '@/components/ui';
import { colors, radius } from '@/theme';

export default function Login() {
  const insets = useSafeAreaInsets();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);
  const [needsVerification, setNeedsVerification] = useState(false);
  const pwdRef = useRef<TextInputInstance>(null);

  const submit = async () => {
    setError('');
    setInfo('');
    setNeedsVerification(false);
    if (!email.trim() || !password) {
      setError('Email et mot de passe requis');
      return;
    }
    setLoading(true);
    try {
      const r = await authApi.login(email.trim(), password);
      if (r?.success && r.token) {
        await login(r.user, r.token); // la redirection est gérée par le layout racine
      } else setError('Erreur de connexion');
    } catch (e) {
      if (e instanceof ApiError && e.data?.code === 'EMAIL_NOT_VERIFIED') setNeedsVerification(true);
      setError(errMsg(e, 'Erreur de connexion'));
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    try {
      await authApi.resendVerification(email.trim());
      setInfo('Email de confirmation renvoyé !');
    } catch (e) {
      setError(errMsg(e));
    }
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        contentContainerStyle={[styles.wrap, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
      >
        <Image source={require('../../assets/splash-icon.png')} style={styles.logo} contentFit="contain" />
        <Text style={styles.brand}>QoGym</Text>
        <T v="small" style={{ textAlign: 'center', marginBottom: 28 }}>
          Connecte-toi pour reprendre tes entraînements
        </T>

        <View style={styles.card}>
          {!!error && <Text style={styles.error}>{error}</Text>}
          {!!info && <Text style={styles.info}>{info}</Text>}
          {needsVerification && <Button title="Renvoyer l'email de confirmation" variant="secondary" onPress={resend} small />}
          <Input
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            placeholder="ton@email.com"
            returnKeyType="next"
            onSubmitEditing={() => pwdRef.current?.focus()}
          />
          <Input
            ref={pwdRef}
            label="Mot de passe"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="current-password"
            placeholder="••••••••"
            returnKeyType="go"
            onSubmitEditing={submit}
          />
          <Text style={styles.link} onPress={() => router.push('/forgot-password')}>
            Mot de passe oublié ?
          </Text>
          <Button title="Se connecter" onPress={submit} loading={loading} />
        </View>

        <Text style={styles.footer}>
          Pas encore de compte ?{' '}
          <Text style={styles.linkInline} onPress={() => router.push('/register')}>
            S'inscrire
          </Text>
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export const authStyles = StyleSheet.create({
  error: { color: colors.danger, backgroundColor: colors.dangerSoft, padding: 12, borderRadius: radius.md, fontSize: 14 },
  info: { color: colors.success, backgroundColor: colors.successSoft, padding: 12, borderRadius: radius.md, fontSize: 14 },
});

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 22, flexGrow: 1 },
  logo: { width: 120, height: 120, alignSelf: 'center', marginBottom: 12 },
  brand: { fontSize: 32, fontWeight: '900', color: colors.goldLight, textAlign: 'center', letterSpacing: 0.5 },
  card: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: 18, gap: 14, borderWidth: 1, borderColor: colors.border },
  ...authStyles,
  link: { color: colors.goldLight, fontSize: 14, alignSelf: 'flex-end', fontWeight: '600' },
  linkInline: { color: colors.goldLight, fontWeight: '700' },
  footer: { color: colors.textDim, textAlign: 'center', marginTop: 22, fontSize: 15 },
});
