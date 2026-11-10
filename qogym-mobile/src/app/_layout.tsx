import React, { useEffect } from 'react';
import { View } from 'react-native';
import { Stack, router, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import * as SystemUI from 'expo-system-ui';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '@/lib/auth';
import { ToastProvider, ConfirmProvider } from '@/components/Feedback';
import { ActiveWorkoutProvider } from '@/workout/ActiveWorkout';
import { UpdateProvider } from '@/lib/update';
import { LegacyMigrationProbe, useLegacyMigration } from '@/lib/migration';
import { colors } from '@/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});
SystemUI.setBackgroundColorAsync(colors.bg).catch(() => {});

const PUBLIC_ROUTES = new Set(['login', 'register', 'forgot-password']);

function Gate() {
  const { ready, user } = useAuth();
  const migration = useLegacyMigration();
  const segments = useSegments();
  const first = (segments[0] as string | undefined) ?? '';

  const booting = !ready || migration.pending;

  useEffect(() => {
    if (!booting) SplashScreen.hideAsync().catch(() => {});
  }, [booting]);

  // Redirections selon l'état de connexion
  useEffect(() => {
    if (booting) return;
    const isPublic = PUBLIC_ROUTES.has(first);
    if (!user && !isPublic) router.replace('/login');
    else if (user && isPublic) router.replace('/');
  }, [booting, user, first]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
          animation: 'slide_from_right',
          animationDuration: 220,
        }}
      >
        <Stack.Screen name="index" options={{ animation: 'fade' }} />
        <Stack.Screen name="login" options={{ animation: 'fade' }} />
        <Stack.Screen name="workout/[sessionId]" options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="workout-detail/[id]" options={{ animation: 'slide_from_bottom' }} />
      </Stack>
      {migration.running && <LegacyMigrationProbe onResult={migration.onResult} onTimeout={migration.finish} />}
    </View>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider style={{ backgroundColor: colors.bg }}>
      <StatusBar style="light" />
      <AuthProvider>
        <ToastProvider>
          <ConfirmProvider>
            <ActiveWorkoutProvider>
              <UpdateProvider>
                <Gate />
              </UpdateProvider>
            </ActiveWorkoutProvider>
          </ConfirmProvider>
        </ToastProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
