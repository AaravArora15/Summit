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
 * Both halves are live. The league reads my_league / league_standings and the
 * whole division scrolls, the promotion and relegation rules drawn through the
 * list at the exact ranks where they fall. Groups (0016_groups.sql) are one per
 * climber: creating makes you its leader, joining by code sends a request the
 * leader answers, and the segment's amber dot plus the leader's inbox card are
 * fed by a fifteen-second poll, which is the "ping".
 */
import * as Clipboard from 'expo-clipboard';
import { Fragment, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';

import { InfoIcon } from '@/components/icons';
import {
  Avatar,
  Body,
  Button,
  Card,
  Chip,
  Data,
  H2,
  H3,
  IconButton,
  Label,
  ProgressBar,
  Segmented,
  Sheet,
  Small,
  TierMeter,
  ZoneRule,
} from '@/components/ui';
import { Skeleton } from '@/components/skeleton';
import { alertUser } from '@/lib/alert';
import { DEMO_GROUP } from '@/lib/demo-data';
import {
  gapInTreks,
  useCreateGroup,
  useGroupStandings,
  useLeague,
  useMyGroup,
  useMyGroupRequest,
  usePendingJoinRequests,
  useRequestToJoin,
  useRespondToJoinRequest,
  useStandings,
  type GroupStandingView,
  type GroupView,
  type JoinRequestView,
  type LeagueView,
  type StandingView,
} from '@/lib/queries';
import { colour, font, radius, size, space, type, withAlpha } from '@/theme/tokens';

const SEGMENTS = ['League', 'Groups'] as const;
type Segment = (typeof SEGMENTS)[number];

export default function LeagueScreen() {
  const insets = useSafeAreaInsets();
  const [segment, setSegment] = useState<Segment>('League');
  const [infoOpen, setInfoOpen] = useState(false);
  const { data: league } = useLeague();

  // The leader's inbox is polled from here rather than only inside the Groups
  // panel so the amber dot on the segment is visible before anyone taps over.
  const { group } = useMyGroup();
  const { data: joinRequests } = usePendingJoinRequests(Boolean(group?.isLeader));

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
        <IconButton label="How the league works" onPress={() => setInfoOpen(true)}>
          <InfoIcon size={18} color={colour.ink} />
        </IconButton>
      </View>

      <Segmented
        options={SEGMENTS}
        value={segment}
        onChange={setSegment}
        dotOn={joinRequests.length > 0 ? 'Groups' : null}
      />

      {segment === 'League' ? <LeaguePanel /> : null}
      {segment === 'Groups' ? <GroupPanel /> : null}

      <LeagueInfoSheet visible={infoOpen} onClose={() => setInfoOpen(false)} league={league} />
    </ScrollView>
  );
}

function LeagueInfoSheet({
  visible,
  onClose,
  league,
}: {
  visible: boolean;
  onClose: () => void;
  league: LeagueView;
}) {
  const relegated = league.divisionSize - league.relegationCutoff + 1;

  return (
    <Sheet visible={visible} onClose={onClose}>
      <H3>How the league works</H3>
      <View style={{ gap: 12, marginTop: 12 }}>
        <View>
          <Label>Tiers</Label>
          <Body style={{ marginTop: 3 }}>
            Five tiers, {league.tiers.join(' → ')}. Everyone starts in the
            middle and moves up or down by how many points they earn this
            month.
          </Body>
        </View>
        <View>
          <Label>Promotion and relegation</Label>
          <Body style={{ marginTop: 3 }}>
            The top {league.promotionCutoff} of your {league.divisionSize}-person
            division move up a tier next month; the bottom {relegated} move
            down. Everyone else holds their tier.
          </Body>
        </View>
        <View>
          <Label>The reset</Label>
          <Body style={{ marginTop: 3 }}>
            On {league.resetsOnLabel} the leaderboard goes back to zero and
            tiers redraw for the new month. Badges, pioneer numbers, sets,
            titles, level and XP are untouched — only this board resets.
          </Body>
        </View>
      </View>
      <View style={{ marginTop: 18 }}>
        <Button label="Got it" full onPress={onClose} />
      </View>
    </Sheet>
  );
}

/* -------------------------------------------------------------------------- */
/* League                                                                     */
/* -------------------------------------------------------------------------- */

function LeaguePanel() {
  const { data: league, isLoading: leagueLoading } = useLeague();
  const { data: standings, isLoading: standingsLoading } = useStandings();

  if (leagueLoading || standingsLoading) return <LeaguePanelSkeleton />;

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

      <StandingsList league={league} standings={standings} />

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

function LeaguePanelSkeleton() {
  return (
    <>
      <Card variant="dark" style={{ paddingVertical: 13 }}>
        <View style={styles.row}>
          <View style={{ gap: 6 }}>
            <Skeleton height={9} width={60} radius={4} />
            <Skeleton height={17} width={90} radius={4} />
          </View>
          <View style={{ gap: 6, alignItems: 'flex-end' }}>
            <Skeleton height={9} width={50} radius={4} />
            <Skeleton height={17} width={70} radius={4} />
          </View>
        </View>
        <View style={{ marginTop: 14 }}>
          <Skeleton height={6} width="100%" radius={99} />
        </View>
      </Card>

      <View style={{ gap: 6 }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <View key={i} style={styles.standing}>
            <Skeleton width={22} height={12} radius={4} />
            <Skeleton width={28} height={28} radius={14} />
            <View style={{ flex: 1, gap: 5 }}>
              <Skeleton height={11} width="50%" radius={4} />
              <Skeleton height={9} width="30%" radius={4} />
            </View>
            <Skeleton width={36} height={12} radius={4} />
          </View>
        ))}
      </View>
    </>
  );
}

/**
 * Every place in the division, with the two boundaries drawn between the rows
 * they actually separate rather than explained above the list: promotion opens
 * below the last promoted place, relegation begins above the first relegated
 * one. On a board you scroll, a rule that travels with its rows tells you at a
 * glance whether the person above the line is catchable and the one below is
 * safe, which is the whole reason to scroll.
 *
 * A boundary that falls outside the division is still not drawn. A new division
 * has a handful of people in it, everyone is inside the top eight, and a rule
 * labelled "relegation · bottom 1" under a list where nobody can be relegated
 * is worse than no rule: it invents a threat to explain a line that only exists
 * because the layout expected one.
 */
function StandingsList({
  league,
  standings,
}: {
  league: LeagueView;
  standings: StandingView[];
}) {
  const showPromotion = league.divisionSize > league.promotionCutoff;
  const showRelegation = league.divisionSize >= league.relegationCutoff;

  return (
    <View style={{ gap: 6 }}>
      {standings.map((row) => (
        <Fragment key={row.rank}>
          {showRelegation && row.rank === league.relegationCutoff ? (
            <ZoneRule
              tone="relegation"
              label={`Relegation · bottom ${league.divisionSize - league.relegationCutoff + 1}`}
            />
          ) : null}
          <StandingRow row={row} />
          {showPromotion && row.rank === league.promotionCutoff ? (
            <ZoneRule tone="promotion" label={`Promotion · top ${league.promotionCutoff}`} />
          ) : null}
        </Fragment>
      ))}
    </View>
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

/**
 * Copies the invite code, then swaps its own label to "Copied" for a beat —
 * a scale pulse on the swap, so the confirmation reads as something
 * happening rather than a checkbox silently flipping.
 */
function CopyInviteButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const scale = useSharedValue(1);

  async function handleCopy() {
    await Clipboard.setStringAsync(code);
    setCopied(true);
    scale.value = withSequence(withTiming(1.12, { duration: 110 }), withTiming(1, { duration: 160 }));
    setTimeout(() => setCopied(false), 1500);
  }

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View style={animatedStyle}>
      <Button label={copied ? 'Copied' : 'Copy'} variant="ghost" small onPress={handleCopy} />
    </Animated.View>
  );
}

/* -------------------------------------------------------------------------- */
/* Groups                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * One panel, three truths about the caller: still loading, running the review
 * build without a backend (demo), nobody in a group yet (the join screen), or
 * seated somewhere. The dispatch is explicit because the four look nothing
 * alike and each is somebody's first impression of the tab.
 */
function GroupPanel() {
  const { group, isDemo, isLoading } = useMyGroup();

  if (isLoading) return <GroupPanelSkeleton />;
  if (isDemo) return <DemoGroupPanel />;
  if (!group) return <GroupEmptyState />;
  return <LiveGroupPanel group={group} />;
}

function GroupPanelSkeleton() {
  return (
    <>
      <Card variant="ink">
        <View style={{ gap: 7 }}>
          <Skeleton height={9} width={150} radius={4} />
          <Skeleton height={17} width={180} radius={4} />
        </View>
        <View style={{ marginTop: 16, flexDirection: 'row', gap: 18 }}>
          {[70, 64, 58].map((w) => (
            <View key={w} style={{ gap: 6 }}>
              <Skeleton height={9} width={40} radius={4} />
              <Skeleton height={12} width={w} radius={4} />
            </View>
          ))}
        </View>
      </Card>

      <View style={{ gap: 6 }}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={[styles.standing, styles.groupStanding]}>
            <Skeleton width={22} height={12} radius={4} />
            <Skeleton width={30} height={30} radius={15} />
            <View style={{ flex: 1, gap: 7 }}>
              <Skeleton height={11} width="55%" radius={4} />
              <Skeleton height={5} width="100%" radius={99} />
            </View>
          </View>
        ))}
      </View>
    </>
  );
}

function DemoGroupPanel() {
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
        {DEMO_GROUP.standings.map((row) => (
          <GroupStandingRow
            key={row.rank}
            topPoints={leader}
            row={{
              rank: row.rank,
              name: row.name,
              initials: row.initials,
              tint: row.tint,
              points: row.points,
              isYou: row.isYou ?? false,
              isLeader: row.rank === 1,
            }}
          />
        ))}
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
        <CopyInviteButton code={DEMO_GROUP.inviteCode} />
      </Card>
    </>
  );
}

/**
 * Nobody in a group. Two doors, sized honestly: starting one is the bigger
 * commitment and gets the primary button; joining by code is a text field.
 * Any outgoing request hangs above both, so the state someone is most likely
 * to be in -- sent an ask, waiting on a friend -- is the first thing rendered.
 */
function GroupEmptyState() {
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);
  const create = useCreateGroup();
  const join = useRequestToJoin();
  const { request } = useMyGroupRequest(true);

  const waiting = request?.status === 'pending';

  async function handleCreate() {
    const trimmed = name.trim();
    if (trimmed.length < 3 || create.isPending) return;
    try {
      await create.mutateAsync(trimmed);
      setName('');
      setCreateOpen(false);
    } catch {
      // Shown under the field from create.error.
    }
  }

  async function handleJoin() {
    const trimmed = code.trim();
    if (!trimmed || join.isPending) return;
    setJoinError(null);
    try {
      await join.mutateAsync(trimmed);
      setCode('');
    } catch (e) {
      setJoinError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <>
      {request && waiting ? (
        <Card variant="sandy" style={styles.noteCard}>
          <Label>Request sent</Label>
          <Small style={{ lineHeight: 18, marginTop: 4 }}>
            Waiting for {request.leaderName} to let you into {request.groupName}. It appears here
            the moment they do.
          </Small>
        </Card>
      ) : null}

      {request && !waiting ? (
        <Card variant="flat" style={styles.noteCard}>
          <Label>Request declined</Label>
          <Small style={{ lineHeight: 18, marginTop: 4 }}>
            {request.leaderName} declined your ask to join {request.groupName}. Send it again below,
            or start a group of your own.
          </Small>
        </Card>
      ) : null}

      <Card>
        <H3>Your own group</H3>
        <Small style={{ lineHeight: 18, marginTop: 5 }}>
          A private leaderboard behind an invite code. You lead it: anyone with the code asks to
          join, and you decide who gets in.
        </Small>
        <View style={{ marginTop: 13 }}>
          <Button label="Create a group" full onPress={() => setCreateOpen(true)} />
        </View>
      </Card>

      <Card>
        <Label>Have a code?</Label>
        <TextInput
          value={code}
          onChangeText={(next) => {
            setCode(next);
            if (joinError) setJoinError(null);
          }}
          placeholder="WALK-7QK2"
          placeholderTextColor={colour.dim}
          autoCapitalize="characters"
          autoCorrect={false}
          autoComplete="off"
          maxLength={12}
          style={[styles.input, styles.codeInput]}
        />
        {joinError ? <Small style={{ color: colour.stop, marginTop: 7 }}>{joinError}</Small> : null}
        <View style={{ marginTop: 10 }}>
          <Button
            label="Ask to join"
            variant="ghost"
            full
            loading={join.isPending}
            onPress={handleJoin}
          />
        </View>
      </Card>

      <Sheet visible={createOpen} onClose={() => setCreateOpen(false)}>
        <H3>Name your group</H3>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Sunday Walkers"
          placeholderTextColor={colour.dim}
          autoCorrect={false}
          autoComplete="off"
          maxLength={40}
          style={[styles.input, { marginTop: 12 }]}
        />
        {create.error ? (
          <Small style={{ color: colour.stop, marginTop: 7 }}>{create.error.message}</Small>
        ) : null}
        <View style={{ marginTop: 14 }}>
          <Button label="Create group" full loading={create.isPending} onPress={handleCreate} />
        </View>
        <View style={{ marginTop: 9 }}>
          <Button label="Cancel" variant="ghost" full onPress={() => setCreateOpen(false)} />
        </View>
      </Sheet>
    </>
  );
}

/**
 * A live group. The leader's inbox sits between the invite code and the
 * standings because it is the one part of this panel asking its reader for an
 * answer; everything else only reports.
 */
function LiveGroupPanel({ group }: { group: GroupView }) {
  const { data: standings } = useGroupStandings(true);
  const { data: requests } = usePendingJoinRequests(group.isLeader);
  const respond = useRespondToJoinRequest();
  const [decidingId, setDecidingId] = useState<string | null>(null);

  const topPoints = Math.max(1, standings[0]?.points ?? 1);
  const mine = standings.find((r) => r.isYou);
  const top = standings[0];
  // Null only while the list has not loaded; zero means leading (a solo group
  // leads itself, which is a true statement about a group of one).
  const gap = mine && top ? Math.max(0, top.points - mine.points) : null;
  const daysLeft = daysLeftThisMonth();

  async function decide(id: string, accept: boolean) {
    if (decidingId) return;
    setDecidingId(id);
    try {
      await respond.mutateAsync({ requestId: id, accept });
    } catch (e) {
      alertUser('Could not answer', e instanceof Error ? e.message : String(e));
    } finally {
      setDecidingId(null);
    }
  }

  return (
    <>
      <Card variant="ink">
        <View style={styles.row}>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Label style={styles.labelOnDark}>
              Private group · {group.memberCount} member{group.memberCount === 1 ? '' : 's'}
            </Label>
            <H2 style={{ color: colour.n50, fontSize: 19 }}>{group.name}</H2>
          </View>
          <Chip
            label={`Ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`}
            small
            colour={colour.sand}
            onDark
          />
        </View>

        <View style={[styles.row, { marginTop: 13 }]}>
          {[
            { label: 'Scoring', value: 'Total points' },
            { label: 'Window', value: windowLabel() },
            { label: 'Stake', value: 'Bragging' },
          ].map((facet) => (
            <View key={facet.label}>
              <Label style={styles.labelOnDark}>{facet.label}</Label>
              <Data style={{ fontSize: 13, color: '#F2F2EE' }}>{facet.value}</Data>
            </View>
          ))}
        </View>
      </Card>

      <Card style={[styles.row, styles.noteCard]}>
        <View style={{ gap: 1 }}>
          <Label>Invite code</Label>
          <Data style={{ fontSize: 16, letterSpacing: 1.9 }}>{group.inviteCode}</Data>
        </View>
        <CopyInviteButton code={group.inviteCode} />
      </Card>

      {group.isLeader && requests.length > 0 ? (
        <Card variant="flat" style={styles.noteCard}>
          <View style={[styles.row, { marginBottom: 2 }]}>
            <Label>Join requests</Label>
            <Chip label={`${requests.length} waiting`} small colour={colour.warn} />
          </View>
          {requests.map((request) => (
            <JoinRequestRow
              key={request.id}
              request={request}
              busy={decidingId !== null}
              loading={decidingId === request.id}
              onDecide={(accept) => decide(request.id, accept)}
            />
          ))}
        </Card>
      ) : null}

      <View style={{ gap: 8 }}>
        <View style={styles.row}>
          <Label>Standings</Label>
          <Label>{windowLabel()}</Label>
        </View>
        {standings.map((row) => (
          <GroupStandingRow key={row.rank} row={row} topPoints={topPoints} />
        ))}
      </View>

      {/* Same translation as the main league: name the trek that closes it. */}
      {gap !== null && mine && top ? (
        <Card variant="sandy" style={styles.noteCard}>
          <View style={styles.row}>
            <Small style={{ color: '#5C6B57' }}>
              {gap === 0
                ? mine.rank === 1
                  ? 'Leading the group'
                  : 'Tied at the top'
                : `${gap.toLocaleString()} points behind ${top.name}`}
            </Small>
            <Data style={{ fontSize: 12.5, color: colour.forest }}>
              {gap === 0
                ? `${daysLeft} day${daysLeft === 1 ? '' : 's'} to defend it`
                : gapInTreks(gap)}
            </Data>
          </View>
        </Card>
      ) : null}
    </>
  );
}

/**
 * One standings row shared by the demo and live groups: private leagues score
 * one thing, so the row is a bar against whoever leads, not a division line.
 */
function GroupStandingRow({
  row,
  topPoints,
}: {
  row: GroupStandingView;
  topPoints: number;
}) {
  const you = Boolean(row.isYou);
  return (
    <View style={[styles.standing, styles.groupStanding, you && styles.standingYou]}>
      <Data style={[styles.rank, you && { color: colour.sand }]}>{row.rank}</Data>
      <Avatar
        initials={row.initials}
        size={30}
        background={row.tint}
        tint={you ? colour.forest : colour.n50}
      />
      <View style={[styles.standingBody, { gap: 2 }]}>
        <View style={styles.row}>
          <View style={[styles.row, { justifyContent: 'flex-start', flexShrink: 1 }]}>
            <Small numberOfLines={1} style={[styles.standingName, you && { color: colour.n50 }]}>
              {row.name}
            </Small>
            {row.isLeader ? (
              <Chip label="Leader" small colour={colour.sand} onDark={you} />
            ) : null}
          </View>
          <Data style={{ fontSize: 13, color: you ? colour.sand : colour.ink }}>
            {row.points.toLocaleString()}
          </Data>
        </View>
        <ProgressBar
          value={row.points / topPoints}
          tint={you ? colour.sand : colour.forest}
          track={you ? withAlpha(colour.n50, 0.22) : undefined}
        />
      </View>
    </View>
  );
}

function JoinRequestRow({
  request,
  busy,
  loading,
  onDecide,
}: {
  request: JoinRequestView;
  /** Another row's decision is in flight; presses are swallowed, not queued. */
  busy: boolean;
  loading: boolean;
  onDecide: (accept: boolean) => void;
}) {
  return (
    <View style={styles.inboxRow}>
      <Avatar initials={request.initials} size={30} background={request.tint} />
      <View style={[styles.standingBody, { gap: 1 }]}>
        <Small numberOfLines={1} style={styles.standingName}>
          {request.name}
        </Small>
        <Label>{askedAgo(request.createdAt)}</Label>
      </View>
      <Button
        label="Decline"
        variant="ghost"
        small
        loading={loading}
        onPress={() => {
          if (!busy) onDecide(false);
        }}
      />
      <Button
        label="Accept"
        small
        loading={loading}
        onPress={() => {
          if (!busy) onDecide(true);
        }}
      />
    </View>
  );
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The scoring window's label, written the way the demo card writes it: "1–31 Aug". */
function windowLabel(): string {
  const now = new Date();
  const total = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return `1–${total} ${MONTH_SHORT[now.getMonth()]}`;
}

/** Days until the window closes, today included: on 23 August that is nine,
 *  which is the same number the demo card quotes. */
function daysLeftThisMonth(): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate() + 1;
}

/** "asked 5m ago". Hours and days stay approximate; nobody cross-references. */
function askedAgo(iso: string): string {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `asked ${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `asked ${h}h ago`;
  return `asked ${Math.floor(h / 24)}d ago`;
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
  codeInput: { fontSize: 16, letterSpacing: 2.5 },
  inboxRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
});
