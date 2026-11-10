import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { errMsg, friendsApi } from '@/lib/api';
import { colors, radius } from '@/theme';
import { Sheet } from './Sheet';
import { Avatar, Button, Chip, Empty, Input, Loader } from './ui';
import { useConfirm, useToast } from './Feedback';

type Tab = 'received' | 'friends' | 'sent' | 'search';

export function FriendsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [tab, setTab] = useState<Tab>('friends');
  const [friends, setFriends] = useState<any[]>([]);
  const [received, setReceived] = useState<any[]>([]);
  const [sent, setSent] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<any[] | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [f, r, s] = await Promise.all([friendsApi.list(), friendsApi.received(), friendsApi.sent()]);
      setFriends(f.friends || []);
      setReceived(r.pending_requests || []);
      setSent(s.sent_requests || []);
      if ((r.pending_requests || []).length > 0) setTab('received');
    } catch {
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) {
      setTerm('');
      setResults(null);
      load();
    }
  }, [visible, load]);

  // Recherche au fil de la frappe (débouncée)
  useEffect(() => {
    if (tab !== 'search') return;
    const q = term.trim();
    if (q.length < 2) {
      setResults(null);
      return;
    }
    const t = setTimeout(() => {
      friendsApi
        .search(q)
        .then((r) => setResults(r.users || []))
        .catch(() => setResults([]));
    }, 350);
    return () => clearTimeout(t);
  }, [term, tab]);

  const run = async (fn: () => Promise<any>, ok?: string) => {
    try {
      await fn();
      if (ok) toast(ok, 'success');
      await load();
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };

  const open = (id: number) => {
    onClose();
    router.push(`/user/${id}`);
  };

  const Row = ({ id, name, pdp, children, sub }: { id: number; name: string; pdp?: string; children?: React.ReactNode; sub?: string }) => (
    <View style={styles.row}>
      <Avatar name={name} pdp={pdp} size={40} onPress={() => open(id)} />
      <Pressable style={{ flex: 1 }} onPress={() => open(id)}>
        <Text style={styles.name}>{name}</Text>
        {sub ? <Text style={styles.sub}>{sub}</Text> : null}
      </Pressable>
      {children}
    </View>
  );

  return (
    <Sheet visible={visible} onClose={onClose} title="Amis" maxHeight={0.92}>
      <View style={styles.tabs}>
        <Chip label={`Reçues${received.length ? ` (${received.length})` : ''}`} active={tab === 'received'} onPress={() => setTab('received')} />
        <Chip label={`Amis (${friends.length})`} active={tab === 'friends'} onPress={() => setTab('friends')} />
        <Chip label="Envoyées" active={tab === 'sent'} onPress={() => setTab('sent')} />
        <Chip label="Chercher" icon="search" active={tab === 'search'} onPress={() => setTab('search')} />
      </View>

      {loading && tab !== 'search' ? (
        <Loader />
      ) : tab === 'received' ? (
        received.length === 0 ? (
          <Empty icon="mail-outline" text="Aucune demande reçue" />
        ) : (
          received.map((r) => (
            <Row key={r.friendship_id} id={r.sender_id} name={r.sender_username} pdp={r.sender_pdp}>
              <Button title="Accepter" small variant="success" onPress={() => run(() => friendsApi.accept(r.friendship_id), 'Ami ajouté')} />
              <Button title="✕" small variant="danger" onPress={() => run(() => friendsApi.decline(r.friendship_id))} />
            </Row>
          ))
        )
      ) : tab === 'friends' ? (
        friends.length === 0 ? (
          <Empty icon="people-outline" text="Aucun ami pour le moment. Cherche-les par pseudo !" action={<Button title="Chercher" small onPress={() => setTab('search')} />} />
        ) : (
          friends.map((f) => (
            <Row key={f.friendship_id} id={f.friend_id} name={f.friend_username} pdp={f.friend_pdp}>
              <Button
                title="Retirer"
                small
                variant="ghost"
                onPress={async () => {
                  if (await confirm({ title: `Retirer ${f.friend_username} de tes amis ?`, confirmLabel: 'Retirer', variant: 'danger' }))
                    run(() => friendsApi.remove(f.friendship_id));
                }}
              />
            </Row>
          ))
        )
      ) : tab === 'sent' ? (
        sent.length === 0 ? (
          <Empty icon="paper-plane-outline" text="Aucune demande envoyée" />
        ) : (
          sent.map((s) => (
            <Row key={s.friendship_id} id={s.receiver_id} name={s.receiver_username} pdp={s.receiver_pdp} sub="En attente…">
              <Button title="Annuler" small variant="ghost" onPress={() => run(() => friendsApi.remove(s.friendship_id))} />
            </Row>
          ))
        )
      ) : (
        <View style={{ gap: 10 }}>
          <Input value={term} onChangeText={setTerm} placeholder="Pseudo (2 lettres min.)" autoCapitalize="none" autoFocus />
          {results === null ? null : results.length === 0 ? (
            <Empty icon="search-outline" text="Aucun utilisateur trouvé" />
          ) : (
            results.map((u) => (
              <Row key={u.id} id={u.id} name={u.username} pdp={u.pdp}>
                <Button title="Ajouter" small icon="person-add" onPress={() => run(() => friendsApi.send(u.id), 'Demande envoyée')} />
              </Row>
            ))
          )}
        </View>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  name: { color: colors.text, fontWeight: '700', fontSize: 15 },
  sub: { color: colors.textDim, fontSize: 12 },
  _unused: { borderRadius: radius.sm },
});
