import React, { useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { authApi, errMsg, isExternalId } from '@/lib/api';
import { store } from '@/lib/storage';
import { colors, radius } from '@/theme';
import { Button, Card, SectionTitle, T } from '@/components/ui';
import { useConfirm, useToast } from '@/components/Feedback';

/**
 * Liaison avec Recomp, l'appli partenaire (voir RECOMP-FEED-SOLUTION.md).
 * Les séances Recomp arrivent dans le fil et les profils avec un id
 * "recomp:…" et `source: 'recomp'`.
 */

export const isRecomp = (w: any) => !!w && (w.source === 'recomp' || isExternalId(w.id));

/** Route du détail : une séance Recomp a besoin de l'id QoGym du propriétaire. */
export const workoutDetailHref = (w: any, ownerId?: number | string) =>
  isRecomp(w)
    ? `/workout-detail/${encodeURIComponent(String(w.id))}?owner_id=${ownerId ?? w.user_id}`
    : `/workout-detail/${w.id}`;

export const RecompBadge = ({ small }: { small?: boolean }) => (
  <View style={[styles.badge, small && { paddingHorizontal: 6, paddingVertical: 1 }]}>
    <Ionicons name="sync" size={small ? 10 : 12} color={colors.recomp} />
    <Text style={[styles.badgeText, small && { fontSize: 10 }]}>Recomp</Text>
  </View>
);

/** Bandeau à la place de l'image (une séance Recomp n'a pas d'image). */
export const RecompBanner = () => (
  <View style={styles.banner}>
    <Ionicons name="sync" size={18} color={colors.recomp} />
    <Text style={styles.bannerText}>Séance faite sur Recomp</Text>
  </View>
);

// ── Annonce du partenariat (une seule fois, après la mise à jour) ──────
const ANNOUNCE_KEY = 'qg_announce_recomp_v1';

export function PartnerAnnouncement({ enabled }: { enabled: boolean }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    store.get<number>(ANNOUNCE_KEY, 0).then((seen) => {
      if (alive && !seen) setVisible(true);
    });
    return () => {
      alive = false;
    };
  }, [enabled]);

  const close = () => {
    setVisible(false);
    store.set(ANNOUNCE_KEY, Date.now());
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close} statusBarTranslucent>
      <View style={styles.overlay}>
        <View style={styles.dialog}>
          <View style={styles.logos}>
            <View style={[styles.logo, { backgroundColor: colors.goldSoft }]}>
              <Ionicons name="barbell" size={26} color={colors.goldLight} />
            </View>
            <Ionicons name="add" size={20} color={colors.textDim} />
            <View style={[styles.logo, { backgroundColor: colors.recompSoft }]}>
              <Ionicons name="sync" size={26} color={colors.recomp} />
            </View>
          </View>
          <Text style={styles.kicker}>NOUVEAU PARTENARIAT</Text>
          <Text style={styles.title}>QoGym s'associe à Recomp</Text>
          <Text style={styles.text}>
            QoGym s'associe à <Text style={styles.strong}>Recomp</Text>, la future appli de musculation de{' '}
            <Text style={styles.strong}>Pakito</Text>.
          </Text>
          <View style={styles.points}>
            <Point icon="people" text="Une seule liste d'amis pour les deux applis." />
            <Point icon="newspaper" text="Les séances Recomp de tes amis s'afficheront dans ton fil, avec un badge Recomp." />
            <Point icon="heart" text="Like et commentaires possibles, comme pour une séance QoGym." />
            <Point icon="lock-closed" text="Ta confidentialité est respectée : en « Privé », personne ne voit tes séances, dans aucune des deux applis." />
          </View>
          <Text style={styles.small}>
            Tu pourras relier ton compte depuis Recomp à sa sortie, et le délier à tout moment depuis ton Profil (« Applis reliées »).
          </Text>
          <Button title="Super !" onPress={close} full />
        </View>
      </View>
    </Modal>
  );
}

const Point = ({ icon, text }: { icon: any; text: string }) => (
  <View style={styles.point}>
    <Ionicons name={icon} size={16} color={colors.recomp} style={{ marginTop: 2 }} />
    <Text style={styles.pointText}>{text}</Text>
  </View>
);

// ── Profil : applis reliées au compte ──────────────────────────────────
export function LinkedAppsCard({ active }: { active: boolean }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [partners, setPartners] = useState<any[] | null>(null);

  const load = () =>
    authApi
      .partners()
      .then((r) => setPartners(Array.isArray(r?.partners) ? r.partners : []))
      .catch(() => setPartners([]));

  useEffect(() => {
    if (active) load();
  }, [active]);

  const revoke = async (p: any) => {
    if (
      !(await confirm({
        title: `Délier ${p.name} ?`,
        message: `${p.name} n'aura plus accès à ton compte QoGym. Tu pourras le relier à nouveau depuis ${p.name}.`,
        confirmLabel: 'Délier',
        variant: 'danger',
      }))
    )
      return;
    try {
      await authApi.revokePartner(p.app);
      toast(`${p.name} délié`, 'success');
      load();
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };

  return (
    <Card style={{ gap: 8 }}>
      <SectionTitle>Applis reliées</SectionTitle>
      {partners && partners.length > 0 ? (
        partners.map((p) => (
          <View key={p.app} style={styles.partnerRow}>
            <View style={[styles.logo, { width: 36, height: 36, backgroundColor: colors.recompSoft }]}>
              <Ionicons name="sync" size={18} color={colors.recomp} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontWeight: '700' }}>{p.name}</Text>
              <T v="tiny">Accès limité au fil, aux amis et à la confidentialité</T>
            </View>
            <Button title="Délier" small variant="outline" onPress={() => revoke(p)} />
          </View>
        ))
      ) : (
        <T v="small">
          Aucune appli reliée. Avec <Text style={{ color: colors.recomp, fontWeight: '700' }}>Recomp</Text> (bientôt), tes séances et celles de tes amis
          seront visibles dans les deux applis.
        </T>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.recompSoft,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    alignSelf: 'flex-start',
  },
  badgeText: { color: colors.recomp, fontSize: 11, fontWeight: '800' },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    marginHorizontal: 14,
    padding: 12,
    borderRadius: radius.md,
    backgroundColor: colors.recompSoft,
  },
  bannerText: { color: colors.recomp, fontWeight: '700' },
  overlay: { flex: 1, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center', padding: 22 },
  dialog: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: 22,
    gap: 12,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  logos: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  logo: { width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  kicker: { color: colors.recomp, fontSize: 11, fontWeight: '900', letterSpacing: 1.2, textAlign: 'center' },
  title: { color: colors.text, fontSize: 21, fontWeight: '900', textAlign: 'center' },
  text: { color: colors.text, fontSize: 15, lineHeight: 21, textAlign: 'center' },
  strong: { fontWeight: '800', color: colors.goldLight },
  points: { gap: 8, marginTop: 2 },
  point: { flexDirection: 'row', gap: 10 },
  pointText: { color: colors.text, fontSize: 14, lineHeight: 20, flex: 1 },
  small: { color: colors.textDim, fontSize: 12, lineHeight: 17 },
  partnerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
