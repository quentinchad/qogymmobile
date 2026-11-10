import React, { useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, View , TextInputInstance } from 'react-native';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { errMsg, feedApi, sessionApi, workoutApi } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { store } from '@/lib/storage';
import { fmtDateTime, fmtDuration, fmtRelative, isTrue } from '@/lib/format';
import { bestOneRepMax } from '@/lib/oneRepMax';
import { groupBySupersets, supersetLetter } from '@/lib/supersets';
import { colors, radius, sessionImageUrl } from '@/theme';
import { Avatar, Button, Card, IconBtn, Input, Loader, Pill, ScreenHeader, T } from '@/components/ui';
import { OrmBadge } from '@/components/Visuals';
import { Sheet } from '@/components/Sheet';
import { MenuItem } from '@/screens/SessionsScreen';
import { useConfirm, useToast } from '@/components/Feedback';
import { useStartWorkout } from '@/workout/useStartWorkout';

export default function WorkoutDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const confirm = useConfirm();
  const startWorkout = useStartWorkout();
  const [w, setW] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [replyTo, setReplyTo] = useState<{ id: number; username: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [menu, setMenu] = useState(false);
  const [editNotes, setEditNotes] = useState(false);
  const [notesDraft, setNotesDraft] = useState('');
  const [launching, setLaunching] = useState(false);
  const inputRef = useRef<TextInputInstance>(null);

  const load = async () => {
    try {
      const r = await feedApi.detail(Number(id));
      setW(r.workout || r);
    } catch (e) {
      setError(errMsg(e, 'Erreur de chargement'));
    }
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const isOwn = !!(w && user && Number(w.user_id) === Number(user.id));

  const fetchSession = async (sid: any) => {
    if (!sid) return null;
    try {
      return (await sessionApi.get(sid)).session || null;
    } catch {
      return null;
    }
  };

  // Même logique que WorkoutLaunchActions du site
  const launch = async () => {
    if (!w || launching) return;
    setLaunching(true);
    try {
      const s = await fetchSession(w.workout_session_id);
      if (s && (Number(s.is_owner) === 1 || Number(s.in_library) === 1) && (s.exercises || []).length > 0) {
        startWorkout(String(s.id));
        return;
      }
      const r = await workoutApi.cloneFromWorkout(w.id, true);
      if (!r.session_id) throw new Error('Impossible de lancer cette séance');
      startWorkout(String(r.session_id), { isEmptyWorkout: !r.exercises_count });
    } catch (e) {
      toast(errMsg(e, 'Impossible de lancer cette séance'), 'error');
    } finally {
      setLaunching(false);
    }
  };

  const saveToLibrary = async () => {
    setMenu(false);
    try {
      const s = await fetchSession(w.workout_session_id);
      if (s && Number(s.in_library) === 1) return toast('Cette séance est déjà dans ta bibliothèque', 'info');
      if (s && Number(s.is_owner) === 1 && (s.exercises || []).length > 0) {
        if (Number(s.is_archived) === 1) {
          await sessionApi.patch(s.id, { is_archived: 0 });
          toast('Séance ajoutée à ta bibliothèque', 'success');
        } else toast('Cette séance est déjà dans ta bibliothèque', 'info');
        return;
      }
      await workoutApi.cloneFromWorkout(w.id, false);
      toast('Séance ajoutée à ta bibliothèque', 'success');
    } catch (e) {
      toast(errMsg(e, "Impossible d'enregistrer la séance"), 'error');
    }
  };

  const remove = async () => {
    setMenu(false);
    if (!(await confirm({ title: 'Supprimer cet entraînement ?', message: 'Il disparaîtra de ton historique et du Feed.', confirmLabel: 'Supprimer', variant: 'danger' })))
      return;
    try {
      await workoutApi.remove(w.id);
      store.set('qg_needs_refresh', Date.now());
      toast('Entraînement supprimé', 'success');
      router.back();
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };

  const like = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const liked = isTrue(w.user_has_liked);
    setW({ ...w, user_has_liked: !liked, likes_count: Number(w.likes_count) + (liked ? -1 : 1) });
    feedApi.toggleLike(w.id).catch(() => load());
  };

  const send = async () => {
    const text = comment.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await feedApi.comment(w.id, text, replyTo?.id ?? null);
      setComment('');
      setReplyTo(null);
      await load();
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setSending(false);
    }
  };

  const deleteComment = async (cid: number) => {
    if (!(await confirm({ title: 'Supprimer ce commentaire ?', confirmLabel: 'Supprimer', variant: 'danger' }))) return;
    try {
      await feedApi.deleteComment(cid);
      await load();
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };

  const saveNotes = async () => {
    try {
      const t = notesDraft.trim();
      await workoutApi.updateNotes(w.id, t);
      setW({ ...w, notes: t });
      setEditNotes(false);
      toast('Description mise à jour', 'success');
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };

  const threads = useMemo(() => {
    const cs: any[] = w?.comments || [];
    const roots = cs.filter((c) => !c.parent_comment_id);
    const by: Record<string, any[]> = {};
    cs.filter((c) => c.parent_comment_id).forEach((c) => (by[c.parent_comment_id] = by[c.parent_comment_id] || []).push(c));
    return roots.map((r) => ({ root: r, replies: by[r.id] || [] }));
  }, [w?.comments]);

  const openExercise = (name: string) => router.push(`/exercises/${w.user_id}/${encodeURIComponent(name)}`);

  if (!w) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <ScreenHeader title="Entraînement" />
        {error ? <Text style={{ color: colors.danger, padding: 20 }}>{error}</Text> : <Loader />}
      </View>
    );
  }

  const img = sessionImageUrl(w.session_image);
  const liked = isTrue(w.user_has_liked);

  const renderComment = (c: any, rootId: number, isReply: boolean) => (
    <View key={c.id} style={[styles.comment, isReply && styles.reply]}>
      <Avatar name={c.username} pdp={c.user_pdp} size={isReply ? 28 : 34} onPress={() => router.push(`/user/${c.user_id}`)} />
      <View style={{ flex: 1 }}>
        <Text style={styles.cUser}>
          {c.username} <Text style={styles.cTime}>· {fmtRelative(c.created_at)}</Text>
        </Text>
        <Text style={styles.cText}>{c.comment}</Text>
        <View style={{ flexDirection: 'row', gap: 16, marginTop: 4 }}>
          <Text
            style={styles.cAction}
            onPress={() => {
              setReplyTo({ id: isReply ? rootId : c.id, username: c.username });
              setComment(`@${c.username} `);
              inputRef.current?.focus();
            }}
          >
            Répondre
          </Text>
          {isTrue(c.is_owner) && (
            <Text style={[styles.cAction, { color: colors.danger }]} onPress={() => deleteComment(c.id)}>
              Supprimer
            </Text>
          )}
        </View>
      </View>
    </View>
  );

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title={w.session_name || 'Entraînement'} right={<IconBtn name="ellipsis-vertical" onPress={() => setMenu(true)} label="Plus d'actions" />} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
        <Pressable style={styles.author} onPress={() => router.push(`/user/${w.user_id}`)}>
          <Avatar name={w.user_username} pdp={w.user_pdp} size={44} />
          <View style={{ flex: 1 }}>
            <Text style={styles.cUser}>{w.user_username}</Text>
            <Text style={styles.cTime}>{fmtDateTime(w.completed_at)}</Text>
          </View>
        </Pressable>

        {img && <Image source={{ uri: img }} style={styles.img} contentFit="cover" cachePolicy="memory-disk" />}

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {!!w.session_type_name && <Pill label={w.session_type_name} />}
          {w.duration_seconds > 0 && <Pill label={fmtDuration(w.duration_seconds)} icon="time-outline" />}
          {!!w.participants && <Pill label={`Avec ${w.participants}`} icon="people" color={colors.purple} bg={colors.purpleSoft} />}
        </View>

        <Button title="Lancer cette séance" icon="play" onPress={launch} loading={launching} />

        {/* Exercices */}
        {(w.exercises || []).length > 0 && (
          <Card style={{ gap: 12 }}>
            <T v="h3">Exercices</T>
            {groupBySupersets(w.exercises).map((block: any, bi: number) => {
              const list = block.type === 'solo' ? [block.exercise] : block.exercises;
              return (
                <View key={bi} style={block.type === 'superset' ? styles.ss : undefined}>
                  {block.type === 'superset' && (
                    <Text style={styles.ssHead}>
                      <Ionicons name="link" size={12} color={colors.purple} /> Superset · {list.length} exercices
                    </Text>
                  )}
                  {list.map((ex: any, i: number) => {
                    const orm = bestOneRepMax(ex.completed_sets);
                    const name = ex.exercise_name || ex.name;
                    return (
                      <View key={ex.id ?? `${bi}-${i}`} style={styles.ex}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          {block.type === 'superset' && <Text style={styles.letter}>{supersetLetter(i)}</Text>}
                          <Text style={styles.exName} onPress={() => openExercise(name)}>
                            {name}
                          </Text>
                          {orm && <OrmBadge value={orm.oneRepMax} />}
                        </View>
                        <View style={styles.sets}>
                          {(ex.completed_sets || []).map((s: any, k: number) => (
                            <Text key={k} style={styles.setChip}>
                              {s.weight ? `${s.weight} kg × ` : ''}
                              {s.reps}
                            </Text>
                          ))}
                        </View>
                      </View>
                    );
                  })}
                </View>
              );
            })}
          </Card>
        )}

        {/* Description */}
        {(isOwn || !!w.notes) && (
          <Card style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <T v="h3">Description</T>
              {isOwn && !editNotes && (
                <Text
                  style={styles.cAction}
                  onPress={() => {
                    setNotesDraft(w.notes || '');
                    setEditNotes(true);
                  }}
                >
                  {w.notes ? 'Modifier' : '+ Ajouter'}
                </Text>
              )}
            </View>
            {editNotes ? (
              <>
                <Input value={notesDraft} onChangeText={setNotesDraft} multiline maxLength={1000} placeholder="Comment s'est passé l'entraînement ?" />
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Button title="Annuler" variant="secondary" small onPress={() => setEditNotes(false)} style={{ flex: 1 }} />
                  <Button title="Enregistrer" small onPress={saveNotes} style={{ flex: 1 }} />
                </View>
              </>
            ) : w.notes ? (
              <Text style={styles.notes}>« {w.notes} »</Text>
            ) : (
              <T v="small">Aucune description.</T>
            )}
          </Card>
        )}

        {/* Likes + commentaires */}
        <Card style={{ gap: 12 }}>
          <Pressable onPress={like} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }} hitSlop={6}>
            <Ionicons name={liked ? 'heart' : 'heart-outline'} size={26} color={liked ? colors.danger : colors.textDim} />
            <Text style={{ color: colors.text, fontWeight: '700' }}>
              {w.likes_count} j'aime
            </Text>
          </Pressable>
          <T v="h3">Commentaires ({(w.comments || []).length})</T>
          {threads.length === 0 ? (
            <T v="small">Aucun commentaire pour l'instant.</T>
          ) : (
            threads.map((t) => (
              <View key={t.root.id}>
                {renderComment(t.root, t.root.id, false)}
                {t.replies.map((r: any) => renderComment(r, t.root.id, true))}
              </View>
            ))
          )}
        </Card>
      </ScrollView>

      {/* Saisie de commentaire */}
      <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        {replyTo && (
          <View style={styles.replyBanner}>
            <Text style={{ color: colors.textDim, flex: 1 }}>
              Réponse à <Text style={{ color: colors.goldLight, fontWeight: '700' }}>@{replyTo.username}</Text>
            </Text>
            <IconBtn
              name="close"
              size={18}
              color={colors.textDim}
              onPress={() => {
                setReplyTo(null);
                setComment('');
              }}
            />
          </View>
        )}
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <TextInput
            ref={inputRef}
            value={comment}
            onChangeText={setComment}
            placeholder={replyTo ? 'Écris ta réponse…' : 'Ajouter un commentaire…'}
            placeholderTextColor={colors.textFaint}
            style={styles.input}
            multiline
            selectionColor={colors.gold}
          />
          <IconBtn name="send" color={comment.trim() ? '#1a1406' : colors.textFaint} bg={comment.trim() ? colors.gold : colors.surface3} onPress={send} label="Envoyer" />
        </View>
      </View>

      <Sheet visible={menu} onClose={() => setMenu(false)} title="Actions">
        <View style={{ paddingBottom: 8 }}>
          <MenuItem icon="bookmark-outline" label="Enregistrer dans ma bibliothèque" onPress={saveToLibrary} />
          {isOwn && <MenuItem icon="trash-outline" label="Supprimer l'entraînement" danger onPress={remove} />}
        </View>
      </Sheet>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  author: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  img: { height: 190, borderRadius: radius.lg, backgroundColor: colors.surface2 },
  ss: { borderLeftWidth: 3, borderLeftColor: colors.purple, paddingLeft: 10, gap: 4 },
  ssHead: { color: colors.purple, fontWeight: '800', fontSize: 12, marginBottom: 2 },
  ex: { gap: 6, paddingVertical: 4 },
  exName: { color: colors.text, fontWeight: '700', fontSize: 15, flexShrink: 1, textDecorationLine: 'underline', textDecorationColor: colors.borderStrong },
  letter: { color: colors.purple, fontWeight: '900', width: 16 },
  sets: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  setChip: {
    color: colors.text,
    backgroundColor: colors.surface2,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    fontSize: 12,
    fontWeight: '700',
    overflow: 'hidden',
  },
  notes: { color: colors.text, fontStyle: 'italic', lineHeight: 21 },
  comment: { flexDirection: 'row', gap: 10, paddingVertical: 8 },
  reply: { marginLeft: 40 },
  cUser: { color: colors.text, fontWeight: '800', fontSize: 14 },
  cTime: { color: colors.textFaint, fontWeight: '400', fontSize: 12 },
  cText: { color: colors.text, fontSize: 14, lineHeight: 20, marginTop: 2 },
  cAction: { color: colors.goldLight, fontWeight: '700', fontSize: 13 },
  composer: { paddingHorizontal: 12, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface },
  replyBanner: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  input: {
    flex: 1,
    maxHeight: 110,
    minHeight: 44,
    backgroundColor: colors.surface2,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 15,
  },
});
