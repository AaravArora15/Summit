/**
 * League, screens 21 and 22 of the v4 mockup.
 *
 * One tab, two relationships to other people, in order of how much they ask
 * of you:
 *
 *   League  competitive, automatic  — 42 strangers, promotion and relegation
 *   Groups  competitive, opt-in     — a private league behind an invite code
 *
 * Two things this screen refuses to do. It never states the gap to promotion in
 * points alone: 380 points means nothing, one 6 km trek means an afternoon. And
 * it spells out the monthly reset on the screen the reset affects, because a
 * leaderboard that wipes without warning teaches people to stop caring.
 *
 * League and its standings are live (my_league / league_standings). Groups is
 * still placeholder: it has no tables yet, and is a membership system rather
 * than a query over one.
 */
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { InfoIcon } from '@/components/icons';
import {
  Avatar,
  Button,
  Card,
  Chip,
  Data,
  H2,
  IconButton,
  Label,
  ProgressBar,
  Segmented,
  Small,
  TierMeter,
  ZoneRule,
} from '@/components/ui';
import { DEMO_GROUP } from '@/lib/demo-data';
import { useLeague, useStandings, type StandingView } from '@/lib/queries';
import { colour, font, radius, size, space, type, withAlpha } from '@/theme/tokens';

const SEGMENTS = ['League', 'Groups'] as const;
type Segment = (typeof SEGMENTS)[number];

export default function LeagueScreen() {
  const insets = useSafeAreaInsets();
  const [segment, setSegment] = useState<Segment>('League');
  const { data: league } = useLeague();

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 8, paddingBottom: size.tabBar + 24 },
      ]}
      showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Label>{league.resetsOn}</Label>
          <H2 style={{ marginTop: 1 }}>{league.month}</H2>
        </View>
        <IconButton label="How the league works">
          <InfoIcon size={18} color={colour.ink} />
        </IconButton>
      </View>

      <Segmented options={SEGMENTS} value={segment} onChange={setSegment} />

      {segment === 'League' ? <LeaguePanel /> : null}
      {segment === 'Groups' ? <GroupPanel /> : null}
    </ScrollView>
  );
}

/* -------------------------------------------------------------------------- */
/* League                                                                     */
/* -------------------------------------------------------------------------- */

function LeaguePanel() {
  const { data: league } = useLeague();
  const { data: standings } = useStandings();

  return (
    <>
      <Card variant="dark" style={{ paddingVertical: 13 }}>
        <View style={styles.row}>
          <View style={{ gap: 2 }}>
            <Label style={styles.labelOnDark}>Your tier</Label>
            <H2 style={{ color: colour.n50, fontSize: 19 }}>
              {league.tiers[league.tierIndex]}
            </H2>
          </View>
          <View style={{ gap: 2, alignItems: 'flex-end' }}>
            <Label style={styles.labelOnDark}>Position</Label>
            <Data style={{ fontSize: 19, color: colour.sand }}>
              #{league.rank} of {league.divisionSize}
            </Data>
          </View>
        </View>

        <View style={{ marginTop: 12 }}>
          <TierMeter count={league.tiers.length} current={league.tierIndex} onDark />
        </View>

        <View style={styles.tierNames}>
          {league.tiers.map((tier, i) => (
            <Label
              key={tier}
              numberOfLines={1}
              style={[
                styles.tierName,
                i === league.tierIndex ? { color: colour.sand } : styles.labelOnDark,
              ]}>
              {tier}
            </Label>
          ))}
        </View>
      </Card>

      {/* The zones are drawn through the list rather than explained above it,
          so the boundary sits between the two rows it separates.

          A boundary that falls outside the division is not drawn at all. A new
          division has a handful of people in it, everyone is inside the top
          eight, and a rule labelled "relegation · bottom 1" under a list where
          nobody can be relegated is worse than no rule: it invents a threat to
          explain a line that only exists because the layout expected one. */}
      <View style={{ gap: 6 }}>
        {league.divisionSize > league.promotionCutoff ? (
          <ZoneRule tone="promotion" label={`Promotion · top ${league.promotionCutoff}`} />
        ) : null}
        {standings.map((row) => (
          <StandingRow key={row.rank} row={row} />
        ))}
        {league.divisionSize >= league.relegationCutoff ? (
          <ZoneRule
            tone="relegation"
            label={`Relegation · bottom ${league.divisionSize - league.relegationCutoff + 1}`}
          />
        ) : null}
      </View>

      {/* The gap, in walkable units. */}
      <Card variant="sandy" style={styles.noteCard}>
        <View style={styles.row}>
          <Small style={{ color: '#5C6B57' }}>
            {league.pointsToPromotion > 0
              ? `${league.pointsToPromotion.toLocaleString()} points to promotion`
              : 'Holding a promotion place'}
          </Small>
          <Data style={{ fontSize: 12.5, color: colour.forest }}>
            {league.pointsToPromotion > 0
              ? league.promotionInTreks
              : `${league.daysLeft} day${league.daysLeft === 1 ? '' : 's'} to hold it`}
          </Data>
        </View>
      </Card>

      <Card variant="flat" style={styles.noteCard}>
        <Small style={{ lineHeight: 18 }}>
          On {league.resetsOnLabel} points go back to zero and the tiers redraw.{' '}
          <Small style={styles.emphasis}>
            Badges, pioneer numbers, sets, titles, level and XP are untouched
          </Small>{' '}
          — the leaderboard is the only thing that resets.
        </Small>
      </Card>
    </>
  );
}

function StandingRow({ row }: { row: StandingView }) {
  const you = Boolean(row.isYou);
  return (
    <View style={[styles.standing, you && styles.standingYou]}>
      <Data style={[styles.rank, you && { color: colour.sand }]}>{row.rank}</Data>
      <Avatar
        initials={row.initials}
        size={28}
        background={row.tint}
        tint={you ? colour.forest : colour.n50}
      />
      <View style={styles.standingBody}>
        <Small style={[styles.standingName, you && { color: colour.n50 }]} numberOfLines={1}>
          {row.name}
        </Small>
        <Label style={you ? { color: 'rgba(242,242,238,0.7)' } : undefined}>
          {row.detail ?? `${row.treks} treks`}
        </Label>
      </View>
      <Data style={{ fontSize: 13, color: you ? colour.sand : colour.ink }}>
        {row.points.toLocaleString()}
      </Data>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Groups                                                                     */
/* -------------------------------------------------------------------------- */

function GroupPanel() {
  const leader = Math.max(...DEMO_GROUP.standings.map((m) => m.points));

  return (
    <>
      {/* An invite code, not a friend graph: a walking group can start one of
          these inside a WhatsApp message. */}
      <Card variant="ink">
        <View style={styles.row}>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Label style={styles.labelOnDark}>
              Private group · {DEMO_GROUP.memberCount} members
            </Label>
            <H2 style={{ color: colour.n50, fontSize: 19 }}>{DEMO_GROUP.name}</H2>
          </View>
          <Chip label={DEMO_GROUP.endsIn} small colour={colour.sand} onDark />
        </View>

        <View style={[styles.row, { marginTop: 13 }]}>
          {[
            { label: 'Scoring', value: DEMO_GROUP.scoring },
            { label: 'Window', value: DEMO_GROUP.window },
            { label: 'Stake', value: DEMO_GROUP.stake },
          ].map((facet) => (
            <View key={facet.label}>
              <Label style={styles.labelOnDark}>{facet.label}</Label>
              <Data style={{ fontSize: 13, color: '#F2F2EE' }}>{facet.value}</Data>
            </View>
          ))}
        </View>
      </Card>

      <View style={{ gap: 8 }}>
        <View style={styles.row}>
          <Label>Standings</Label>
          <Label>{DEMO_GROUP.updatedAgo}</Label>
        </View>
        {DEMO_GROUP.standings.map((row) => {
          const you = Boolean(row.isYou);
          return (
            <View
              key={row.rank}
              style={[styles.standing, styles.groupStanding, you && styles.standingYou]}>
              <Data style={[styles.rank, you && { color: colour.sand }]}>{row.rank}</Data>
              <Avatar
                initials={row.initials}
                size={30}
                background={row.tint}
                tint={you ? colour.forest : colour.n50}
              />
              <View style={[styles.standingBody, { gap: 2 }]}>
                <View style={styles.row}>
                  <Small style={[styles.standingName, you && { color: colour.n50 }]}>
                    {row.name}
                  </Small>
                  <Data style={{ fontSize: 13, color: you ? colour.sand : colour.ink }}>
                    {row.points.toLocaleString()}
                  </Data>
                </View>
                <ProgressBar
                  value={row.points / leader}
                  tint={you ? colour.sand : colour.forest}
                  track={you ? withAlpha(colour.n50, 0.22) : undefined}
                />
              </View>
            </View>
          );
        })}
      </View>

      {/* Same translation as the main league: name the trek that closes it. */}
      <Card variant="flat" style={styles.noteCard}>
        <View style={[styles.row, { marginBottom: 8 }]}>
          <Label>Gap to first</Label>
          <Data style={{ fontSize: 12.5 }}>{DEMO_GROUP.gapToFirst} pts</Data>
        </View>
        <Small style={{ lineHeight: 18 }}>{DEMO_GROUP.gapNote}</Small>
      </Card>

      <Card style={[styles.row, styles.noteCard]}>
        <View style={{ gap: 1 }}>
          <Label>Invite code</Label>
          <Data style={{ fontSize: 16, letterSpacing: 1.9 }}>{DEMO_GROUP.inviteCode}</Data>
        </View>
        <Button label="Copy" variant="ghost" small />
      </Card>
    </>
  );
}

/* -------------------------------------------------------------------------- */

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colour.bg },
  content: { paddingHorizontal: space.screenX, gap: 11 },

  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 2 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },

  labelOnDark: { color: 'rgba(242,242,238,0.6)' },
  emphasis: { fontFamily: font.uiSemi, color: colour.ink },

  tierNames: { flexDirection: 'row', gap: 3, marginTop: 7 },
  tierName: { flex: 1, fontSize: 8.5, letterSpacing: 0.26, textAlign: 'center' },

  standing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: radius.row,
    borderCurve: 'continuous',
    backgroundColor: colour.card,
    borderWidth: 1,
    borderColor: colour.line,
  },
  groupStanding: { paddingHorizontal: 12, paddingVertical: 11 },
  standingYou: { backgroundColor: colour.forest, borderColor: colour.forest },
  rank: { width: 22, fontSize: 12.5, color: colour.muted, textAlign: 'center' },
  standingBody: { flex: 1, minWidth: 0, gap: 0 },
  standingName: { ...type.xs, fontFamily: font.uiSemi, color: colour.ink },

  noteCard: { padding: 13, paddingVertical: 12 },
});
