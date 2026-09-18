/**
 * My suggestions, reached from Profile and from the confirmation at the end
 * of Suggest a location.
 *
 * Review itself happens elsewhere now — see review.tsx and
 * 0022_titles_and_review.sql, reachable from Settings for an admin. This
 * screen only has to show the caller what happened to what they sent in,
 * not let them do anything about it.
 */
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BackIcon } from '@/components/icons';
import { Skeleton } from '@/components/skeleton';
import { Card, H2, Label, Small } from '@/components/ui';
import { useSuggestions, type SuggestionView } from '@/lib/queries';
import { colour, radius, space } from '@/theme/tokens';

export default function SuggestionsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { data: suggestions, isLoading } = useSuggestions();

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
        <H2>My suggestions</H2>
        <View style={{ width: 38 }} />
      </View>

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
            <Small style={{ textAlign: 'center' }}>
              {"Nothing yet — found somewhere that isn't in the collection?"}
            </Small>
          </Card>
        ) : (
          suggestions.map((s) => <SuggestionRow key={s.id} suggestion={s} />)
        )}
      </ScrollView>
    </View>
  );
}

const STATUS_LABEL: Record<SuggestionView['status'], string> = {
  pending: 'Under review',
  approved: 'Added',
  rejected: 'Not added',
};

const STATUS_COLOUR: Record<SuggestionView['status'], string> = {
  pending: colour.warn,
  approved: colour.ok,
  rejected: colour.stop,
};

function SuggestionRow({ suggestion }: { suggestion: SuggestionView }) {
  return (
    <Card style={styles.row}>
      <View style={styles.rowTop}>
        <Label>{suggestion.name}</Label>
        <Small style={{ color: STATUS_COLOUR[suggestion.status] }}>
          {STATUS_LABEL[suggestion.status]}
        </Small>
      </View>

      <Small style={{ color: colour.dim, marginTop: 4 }}>Sent {suggestion.dateLabel}</Small>

      {suggestion.notes ? (
        <Small style={{ color: colour.ink, marginTop: 8 }}>{suggestion.notes}</Small>
      ) : null}

      {suggestion.reviewNote ? (
        <Small style={{ color: colour.ink, marginTop: 8 }}>{suggestion.reviewNote}</Small>
      ) : null}
    </Card>
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

  emptyCard: { paddingVertical: 24 },
});
