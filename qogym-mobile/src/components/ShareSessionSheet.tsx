import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { errMsg, friendsApi, shareApi } from '@/lib/api';
import { colors, radius } from '@/theme';
import { Sheet } from './Sheet';
import { Avatar, Button, Empty, Loader, T, tap } from './ui';

export function ShareSessionSheet({ session, onClose }: { session: any | null; onClose: () => void }) {
  const [friends, setFriends] = useState<any[] | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!session) return;
    setSelected([]);
    setMsg(null);
    setFriends(null);
    friendsApi
      .list()
      .then((r) => setFriends(r.friends || []))
      .catch(() => setFriends([]));
  }, [session]);

  const share = async () => {
    if (!session || !selected.length) return;
    setSending(true);
    setMsg(null);
    try {
      const r = await shareApi.share(session.id, selected);
      const n = r.shared?.length ?? 0;
      setMsg({ ok: true, text: n > 0 ? `Séance partagée avec ${n} ami${n > 1 ? 's' : ''} ! Ils ont reçu un email.` : 'Aucun nouveau partage (déjà envoyé).' });
      setSelected([]);
    } catch (e) {
      setMsg({ ok: false, text: errMsg(e, 'Erreur lors du partage') });
    } finally {
      setSending(false);
    }
  };

  return (
    <Sheet
      visible={!!session}
      onClose={onClose}
      title="Partager la séance"
      footer={<Button title={sending ? 'Envoi…' : `Partager${selected.length ? ` (${selected.length})` : ''}`} onPress={share} disabled={!selected.length} loading={sending} />}
    >
      <T v="small" style={{ marginBottom: 12 }}>
        « {session?.name} » — tes amis pourront l'accepter et l'utiliser comme la leur.
      </T>
      {msg && <Text style={[styles.msg, { color: msg.ok ? colors.success : colors.danger }]}>{msg.text}</Text>}
      {friends === null ? (
        <Loader />
      ) : friends.length === 0 ? (
        <Empty icon="people-outline" text="Tu n'as pas encore d'amis. Ajoute-en depuis le Feed !" />
      ) : (
        <View style={{ gap: 8, paddingBottom: 6 }}>
          {friends.map((f) => {
            const on = selected.includes(f.friend_id);
            return (
              <Pressable
                key={f.friend_id}
                onPress={() => {
                  tap();
                  setSelected((p) => (on ? p.filter((x) => x !== f.friend_id) : [...p, f.friend_id]));
                }}
                style={[styles.row, on && { borderColor: colors.gold, backgroundColor: colors.goldSoft }]}
              >
                <Avatar name={f.friend_username} pdp={f.friend_pdp} size={36} />
                <Text style={styles.name}>{f.friend_username}</Text>
                <Ionicons name={on ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={on ? colors.gold : colors.textFaint} />
              </Pressable>
            );
          })}
        </View>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface2,
  },
  name: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '600' },
  msg: { fontSize: 14, marginBottom: 10, fontWeight: '600' },
});
