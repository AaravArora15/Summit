/**
 * Suggestion review — the reviewer UI 0014_location_suggestions.sql's own
 * header comment said didn't exist yet: approving a suggestion into a real,
 * claimable location used to mean someone running SQL by hand against the
 * live project. See 0022_titles_and_review.sql for the RPCs behind this.
 *
 * Gated on profile.isAdmin, checked here rather than only hidden from
 * settings.tsx's nav: a direct deep link must refuse the same way a missing
 * menu item would, not just be harder to find. pending_location_suggestions()
 * enforces the same check server-side regardless — this is a courtesy, not
 * the real access control.
 *
 * A suggestion only ever carries a name and a point (see suggest_location(),
 * 0014); everything else a real location needs — rarity, difficulty, which
 * set if any — is decided right here at approval time.
 */
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BackIcon } from '@/components/icons';
import { Skeleton } from '@/components/skeleton';
import { Button, Card, Chip, H2, Label, Sheet, Small } from '@/components/ui';
import { alertUser } from '@/lib/alert';
import {
  useApproveSuggestion,
  useProfile,
  useRejectSuggestion,
  useSetProgress,
  usePendingSuggestions,
  type PendingSuggestionView,
} from '@/lib/queries';
import { colour, radius, rarityColour, space } from '@/theme/tokens';

const RARITIES = ['common', 'rare', 'epic', 'legendary'] as const;
type Rarity = (typeof RARITIES)[number];
const DIFFICULTIES = [1, 2, 3, 4] as const;
const DIFFICULTY_LABEL: Record<(typeof DIFFICULTIES)[number], string> = {
  1: 'Easy',
  2: 'Medium',
  3: 'Hard',
  4: 'Extreme',
};

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40) || 'location';
}

export default function ReviewScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { data: profile, isLoading: profileLoading } = useProfile();
  const { data: suggestions, isLoading } = usePendingSuggestions();
  const [reviewing, setReviewing] = useState<PendingSuggestionView | null>(null);
  const [rejecting, setRejecting] = useState<PendingSuggestionView | null>(null);

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 8 }]}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.back()}
          style={({ pressed }) => [styles.iconButton, pressed && { opacity: 0.7 }]}>
          <BackIcon size={18} color={colour.ink} />
        </Pressable>
        <H2>Review submissions</H2>
        <View style={{ width: 38 }} />
      </View>

      {!profileLoading && !profile.isAdmin ? (
        <Card variant="flat" style={styles.emptyCard}>
          <Small style={{ textAlign: 'center' }}>
            This screen is for reviewers only.
          </Small>
        </Card>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: insets.bottom + 24, gap: 9 }}
          showsVerticalScrollIndicator={false}>
          {isLoading ? (
            Array.from({ length: 3 }, (_, i) => (
              <Card key={i} style={styles.row}>
                <Skeleton height={13} width="45%" radius={4} />
                <View style={{ marginTop: 8 }}>
                  <Skeleton height={10} width="70%" radius={4} />
                </View>
              </Card>
            ))
          ) : suggestions.length === 0 ? (
            <Card variant="flat" style={styles.emptyCard}>
              <Small style={{ textAlign: 'center' }}>Nothing waiting on review.</Small>
            </Card>
          ) : (
            suggestions.map((s) => (
              <Card key={s.id} style={styles.row}>
                <View style={styles.rowTop}>
                  <Label>{s.name}</Label>
                  <Small style={{ color: colour.dim }}>{s.dateLabel}</Small>
                </View>
                <Small style={{ color: colour.dim, marginTop: 4 }}>
                  From {s.submitter} · {s.lat.toFixed(4)}, {s.lng.toFixed(4)}
                  {s.hasPhoto ? ' · photo attached' : ''}
                </Small>
                {s.notes ? (
                  <Small style={{ color: colour.ink, marginTop: 8 }}>{s.notes}</Small>
                ) : null}
                <View style={styles.actions}>
                  <Button label="Approve" small onPress={() => setReviewing(s)} />
                  <Button
                    label="Reject"
                    variant="ghost"
                    small
                    onPress={() => setRejecting(s)}
                  />
                </View>
              </Card>
            ))
          )}
        </ScrollView>
      )}

      <ApproveSheet suggestion={reviewing} onClose={() => setReviewing(null)} />
      <RejectSheet suggestion={rejecting} onClose={() => setRejecting(null)} />
    </View>
  );
}

function ApproveSheet({
  suggestion,
  onClose,
}: {
  suggestion: PendingSuggestionView | null;
  onClose: () => void;
}) {
  return (
    <Sheet visible={suggestion !== null} onClose={onClose}>
      {suggestion ? (
        // Keyed by suggestion id so opening a different suggestion remounts
        // this with fresh state, rather than carrying over the previous
        // one's slug/rarity/difficulty picks.
        <ApproveForm key={suggestion.id} suggestion={suggestion} onClose={onClose} />
      ) : null}
    </Sheet>
  );
}

function ApproveForm({
  suggestion,
  onClose,
}: {
  suggestion: PendingSuggestionView;
  onClose: () => void;
}) {
  const approve = useApproveSuggestion();
  const { data: sets } = useSetProgress();
  const [slug, setSlug] = useState(() => slugify(suggestion.name));
  const [rarity, setRarity] = useState<Rarity>('common');
  const [difficulty, setDifficulty] = useState<(typeof DIFFICULTIES)[number]>(1);
  const [setId, setSetId] = useState<string | null>(null);

  async function handleApprove() {
    if (approve.isPending) return;
    try {
      await approve.mutateAsync({
        suggestionId: suggestion.id,
        slug: slug.trim() || slugify(suggestion.name),
        setId,
        rarity,
        difficulty,
      });
      onClose();
    } catch (error) {
      alertUser('Could not approve', error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <>
      <H2>{`Add "${suggestion.name}"`}</H2>
      <Small style={{ color: colour.muted, marginTop: 4 }}>
        Becomes a real, claimable location as soon as you approve it.
      </Small>

      <Label style={{ marginTop: 16 }}>Slug</Label>
      <TextInput
        value={slug}
        onChangeText={setSlug}
        autoCapitalize="none"
        autoCorrect={false}
        style={[styles.input, { marginTop: 6 }]}
      />

      <Label style={{ marginTop: 14 }}>Rarity</Label>
      <View style={styles.chipRow}>
        {RARITIES.map((r) => (
          <SelectChip
            key={r}
            label={r}
            selected={r === rarity}
            tint={rarityColour[r]}
            onPress={() => setRarity(r)}
          />
        ))}
      </View>

      <Label style={{ marginTop: 14 }}>Difficulty</Label>
      <View style={styles.chipRow}>
        {DIFFICULTIES.map((d) => (
          <SelectChip
            key={d}
            label={DIFFICULTY_LABEL[d]}
            selected={d === difficulty}
            onPress={() => setDifficulty(d)}
          />
        ))}
      </View>

      {sets.length > 0 ? (
        <>
          <Label style={{ marginTop: 14 }}>Set</Label>
          <View style={styles.chipRow}>
            <SelectChip label="No set" selected={setId === null} onPress={() => setSetId(null)} />
            {sets.map((s) => (
              <SelectChip
                key={s.setId}
                label={s.name}
                selected={setId === s.setId}
                onPress={() => setSetId(s.setId)}
              />
            ))}
          </View>
        </>
      ) : null}

      <View style={{ marginTop: 16 }}>
        <Button label="Add to the map" full loading={approve.isPending} onPress={handleApprove} />
      </View>
      <View style={{ marginTop: 9 }}>
        <Button label="Cancel" variant="ghost" full onPress={onClose} />
      </View>
    </>
  );
}

function RejectSheet({
  suggestion,
  onClose,
}: {
  suggestion: PendingSuggestionView | null;
  onClose: () => void;
}) {
  const reject = useRejectSuggestion();
  const [note, setNote] = useState('');

  async function handleReject() {
    if (!suggestion || reject.isPending) return;
    try {
      await reject.mutateAsync({ suggestionId: suggestion.id, reviewNote: note.trim() || undefined });
      setNote('');
      onClose();
    } catch (error) {
      alertUser('Could not reject', error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <Sheet visible={suggestion !== null} onClose={onClose}>
      {suggestion ? (
        <>
          <H2>{`Not adding "${suggestion.name}"`}</H2>
          <Small style={{ color: colour.muted, marginTop: 4 }}>
            Shown to whoever sent this in — see it in My suggestions.
          </Small>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="Reason (optional)"
            placeholderTextColor={colour.dim}
            multiline
            style={[styles.input, { marginTop: 12, minHeight: 60, textAlignVertical: 'top' }]}
          />
          <View style={{ marginTop: 14 }}>
            <Button label="Reject" full loading={reject.isPending} onPress={handleReject} />
          </View>
          <View style={{ marginTop: 9 }}>
            <Button label="Cancel" variant="ghost" full onPress={onClose} />
          </View>
        </>
      ) : null}
    </Sheet>
  );
}

function SelectChip({
  label,
  selected,
  tint,
  onPress,
}: {
  label: string;
  selected: boolean;
  tint?: string;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => pressed && { opacity: 0.7 }}>
      <Chip label={label} small tone={selected ? 'on' : 'default'} colour={selected ? undefined : tint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colour.bg, paddingHorizontal: space.screenX, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: radius.control,
    backgroundColor: colour.card,
    borderWidth: 1,
    borderColor: colour.n200,
    alignItems: 'center',
    justifyContent: 'center',
  },

  row: { padding: 13 },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  emptyCard: { paddingVertical: 24 },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  input: {
    borderRadius: radius.control,
    backgroundColor: colour.card,
    borderWidth: 1,
    borderColor: colour.n200,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colour.ink,
  },
});
