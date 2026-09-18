/**
 * Line icons, transcribed from the paths in design-mockup-v4.html.
 *
 * One stroke width across the whole set (see tokens.strokeWidth). Mixed weights
 * were a large part of what made v3 read as cartoonish, so resist adding an
 * icon at a different weight "just for this one screen".
 */
import Svg, { Circle, Path } from 'react-native-svg';

import { colour, strokeWidth } from '@/theme/tokens';

type IconProps = {
  size?: number;
  color?: string;
  strokeWidth?: number;
};

const base = (p: IconProps) => ({
  width: p.size ?? 21,
  height: p.size ?? 21,
  viewBox: '0 0 24 24',
});

const stroke = (p: IconProps) => ({
  stroke: p.color ?? colour.muted,
  strokeWidth: p.strokeWidth ?? strokeWidth,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  fill: 'none',
});

export function HomeIcon(p: IconProps) {
  return (
    <Svg {...base(p)}>
      <Path d="M3 18l5.5-9L12 15l2.5-4L21 18Z" {...stroke(p)} />
    </Svg>
  );
}

/** The shield, echoing the badge shape language. */
export function CollectIcon(p: IconProps) {
  return (
    <Svg {...base(p)}>
      <Path d="M12 3l7 2.5v6c0 4-3 6.8-7 8.5-4-1.7-7-4.5-7-8.5v-6Z" {...stroke(p)} />
    </Svg>
  );
}

export function ExploreIcon(p: IconProps) {
  return (
    <Svg {...base(p)}>
      <Circle cx="12" cy="12" r="9" {...stroke(p)} />
      <Path d="M15.4 8.6 13.4 13.4 8.6 15.4 10.6 10.6Z" {...stroke(p)} />
    </Svg>
  );
}

export function LeagueIcon(p: IconProps) {
  return (
    <Svg {...base(p)}>
      <Path d="M4 20h16" {...stroke(p)} />
      <Path d="M6 20v-6h3.5v6" {...stroke(p)} />
      <Path d="M10.2 20V7.5h3.6V20" {...stroke(p)} />
      <Path d="M14.5 20v-4H18v4" {...stroke(p)} />
    </Svg>
  );
}

export function ProfileIcon(p: IconProps) {
  return (
    <Svg {...base(p)}>
      <Circle cx="12" cy="8" r="3.4" {...stroke(p)} />
      <Path d="M5 20c0-3.6 3.1-5.6 7-5.6s7 2 7 5.6" {...stroke(p)} />
    </Svg>
  );
}

export function ChevronIcon(p: IconProps) {
  return (
    <Svg {...base(p)}>
      <Path d="m9 5 7 7-7 7" {...stroke(p)} />
    </Svg>
  );
}

/** Back, the mockup's own path (left-pointing) rather than a rotated ChevronIcon. */
export function BackIcon(p: IconProps) {
  return (
    <Svg {...base(p)}>
      <Path d="m14 5-7 7 7 7" {...stroke(p)} />
    </Svg>
  );
}

/** The claimed mark. Small and quiet on purpose: a tick, not a badge. */
export function CheckIcon(p: IconProps) {
  return (
    <Svg {...base(p)}>
      <Path d="m5 12.5 4.5 4.5L19 7.5" {...stroke(p)} />
    </Svg>
  );
}


export function CloseIcon(p: IconProps) {
  return (
    <Svg {...base(p)}>
      <Path d="M6 6 18 18M18 6 6 18" {...stroke(p)} />
    </Svg>
  );
}

export function SearchIcon(p: IconProps) {
  return (
    <Svg {...base(p)}>
      <Circle cx="11" cy="11" r="6.5" {...stroke(p)} />
      <Path d="m16 16 4.5 4.5" {...stroke(p)} />
    </Svg>
  );
}

/** Three sliders, transcribed from the map-controls path in the v4 mockup. */
export function FilterIcon(p: IconProps) {
  return (
    <Svg {...base(p)}>
      <Path d="M4 7h16M4 12h16M4 17h10" {...stroke(p)} />
      <Circle cx="16" cy="17" r="2.4" fill={p.color ?? colour.muted} />
    </Svg>
  );
}

/** Not from the mockup: this screen (suggest a location) is new. Kept to the
 *  same single stroke weight as the rest of the set rather than a filled dot,
 *  so it doesn't read as a different, heavier icon family next to it. */
export function PlusIcon(p: IconProps) {
  return (
    <Svg {...base(p)}>
      <Path d="M12 5v14M5 12h14" {...stroke(p)} />
    </Svg>
  );
}

export function InfoIcon(p: IconProps) {
  return (
    <Svg {...base(p)}>
      <Circle cx="12" cy="12" r="8.5" {...stroke(p)} />
      <Path d="M12 16.4v-4.8M12 8.2v.2" {...stroke(p)} />
    </Svg>
  );
}

export function SettingsIcon(p: IconProps) {
  return (
    <Svg {...base(p)}>
      <Circle cx="12" cy="12" r="3" {...stroke(p)} />
      <Path
        d="M19.2 14.6a1.7 1.7 0 0 0 .34 1.88 2 2 0 1 1-2.83 2.83 1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56 2 2 0 1 1-4 0 1.7 1.7 0 0 0-1.06-1.53 1.7 1.7 0 0 0-1.88.34 2 2 0 1 1-2.83-2.83 1.7 1.7 0 0 0 .34-1.88 1.7 1.7 0 0 0-1.56-1.03 2 2 0 1 1 0-4A1.7 1.7 0 0 0 4.4 8.6a1.7 1.7 0 0 0-.34-1.88 2 2 0 1 1 2.83-2.83 1.7 1.7 0 0 0 1.88.34 1.7 1.7 0 0 0 1.03-1.56 2 2 0 1 1 4 0 1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.88-.34 2 2 0 1 1 2.83 2.83 1.7 1.7 0 0 0-.34 1.88 1.7 1.7 0 0 0 1.56 1.03 2 2 0 1 1 0 4 1.7 1.7 0 0 0-1.56 1.03Z"
        {...stroke(p)}
      />
    </Svg>
  );
}

export function CalendarIcon(p: IconProps) {
  return (
    <Svg {...base(p)}>
      <Path d="M4 6h16v13H4z" {...stroke(p)} />
      <Path d="M4 10h16" {...stroke(p)} />
      <Path d="M9 3v3M15 3v3" {...stroke(p)} />
    </Svg>
  );
}

export function DotsIcon(p: IconProps) {
  return (
    <Svg {...base(p)}>
      <Circle cx="12" cy="12" r="1.6" fill={p.color ?? colour.muted} />
      <Circle cx="12" cy="5.5" r="1.6" fill={p.color ?? colour.muted} />
      <Circle cx="12" cy="18.5" r="1.6" fill={p.color ?? colour.muted} />
    </Svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Badge glyphs                                                               */
/* -------------------------------------------------------------------------- */
/*
 * The marks that sit inside a shield. They are drawn at the same stroke weight
 * as the interface icons on purpose: a badge is a record of a place, not a
 * sticker, and a heavier glyph would push it back toward the v3 look.
 */

/** Water, for coastal badges. */
export function DropIcon(p: IconProps) {
  return (
    <Svg {...base(p)}>
      <Path d="M12 3c3 4 5 6 5 9a5 5 0 0 1-10 0c0-3 2-5 5-9z" {...stroke(p)} />
    </Svg>
  );
}

/** Canopy, for trail and park badges. */
export function TreeIcon(p: IconProps) {
  return (
    <Svg {...base(p)}>
      <Path d="M12 3l4.4 6.4h-2.6L18 16H6l4.2-6.6H7.6z" {...stroke(p)} />
    </Svg>
  );
}

/** A flagged tower, for expedition badges. */
export function FortIcon(p: IconProps) {
  return (
    <Svg {...base(p)}>
      <Path d="M6 21V8.5h5V21" {...stroke(p)} />
      <Path d="M8.5 8.5V4l7 2.2-7 2.3" {...stroke(p)} />
    </Svg>
  );
}

/** A standard on a pole, for crews. */
export function PennantIcon(p: IconProps) {
  return (
    <Svg {...base(p)}>
      <Path d="M6 21V4" {...stroke(p)} />
      <Path d="M6 4.5h11l-2 3.5 2 3.5H6" {...stroke(p)} />
    </Svg>
  );
}

export function WalkingIcon(p: IconProps) {
  return (
    <Svg {...base(p)}>
      <Circle cx="13.5" cy="4.4" r="1.9" {...stroke(p)} />
      <Path d="M11 21l1.6-6.2-2.6-2.2 1-4 3.4 2.4 2.6.9" {...stroke(p)} />
      <Path d="M9.6 12.8 7 17" {...stroke(p)} />
    </Svg>
  );
}

export function CyclingIcon(p: IconProps) {
  return (
    <Svg {...base(p)}>
      <Circle cx="6" cy="16.5" r="3.4" {...stroke(p)} />
      <Circle cx="18" cy="16.5" r="3.4" {...stroke(p)} />
      <Path d="M6 16.5 10.5 9H15l3 7.5" {...stroke(p)} />
      <Path d="M9.4 9h4.2" {...stroke(p)} />
    </Svg>
  );
}

export function RunningIcon(p: IconProps) {
  return (
    <Svg {...base(p)}>
      <Circle cx="15.4" cy="4.5" r="1.9" {...stroke(p)} />
      <Path d="M8 21l3.2-5.4-2.2-3.2 1.6-3.9 3.6 3.1 3 .8" {...stroke(p)} />
      <Path d="M9.6 11.4 6.2 12.6" {...stroke(p)} />
    </Svg>
  );
}

export function ScenicIcon(p: IconProps) {
  return (
    <Svg {...base(p)}>
      <Circle cx="17.2" cy="6.6" r="2.3" {...stroke(p)} />
      <Path d="M3 19l5.4-7.2 3.4 4.4L15 12.6 21 19Z" {...stroke(p)} />
    </Svg>
  );
}

export function UrbanIcon(p: IconProps) {
  return (
    <Svg {...base(p)}>
      <Path d="M4 20V9.5h5.5V20" {...stroke(p)} />
      <Path d="M9.5 20V4H20v16" {...stroke(p)} />
      <Path d="M12.6 8h4M12.6 12h4M12.6 16h4" {...stroke(p)} />
    </Svg>
  );
}

export function CoastalIcon(p: IconProps) {
  return (
    <Svg {...base(p)}>
      <Path d="M3 15.5c2-2 4-2 6 0s4 2 6 0 4-2 6 0" {...stroke(p)} />
      <Path d="M3 20c2-2 4-2 6 0s4 2 6 0 4-2 6 0" {...stroke(p)} />
      <Path d="M7.5 10.5a4.5 4.5 0 0 1 9 0" {...stroke(p)} />
    </Svg>
  );
}

export function IslandsIcon(p: IconProps) {
  return (
    <Svg {...base(p)}>
      <Path d="M4 17c3.5-1.6 5.5-6 8-6s4.5 4.4 8 6" {...stroke(p)} />
      <Path d="M4 20.5h16" {...stroke(p)} />
      <Circle cx="12" cy="5.4" r="2" {...stroke(p)} />
    </Svg>
  );
}

export function TimerOffIcon(p: IconProps) {
  return (
    <Svg {...base(p)}>
      <Circle cx="12" cy="12" r="8.5" {...stroke(p)} />
      <Path d="M12 7.4v5l3 1.8" {...stroke(p)} />
      <Path d="m4 4 3 3" {...stroke(p)} />
    </Svg>
  );
}

export function ShieldCheckIcon(p: IconProps) {
  return (
    <Svg {...base(p)}>
      <Path d="M12 3.5 19.5 7v5.6c0 4-3.2 7-7.5 8.9-4.3-1.9-7.5-4.9-7.5-8.9V7z" {...stroke(p)} />
      <Path d="m9.2 12.2 2 2 3.6-3.9" {...stroke(p)} />
    </Svg>
  );
}

export function AlertTriangleIcon(p: IconProps) {
  return (
    <Svg {...base(p)}>
      <Path d="M12 3.6 21 19H3z" {...stroke(p)} />
      <Path d="M12 10v4" {...stroke(p)} />
      <Path d="M12 16.4v.2" {...stroke(p)} />
    </Svg>
  );
}

export function RefreshIcon(p: IconProps) {
  return (
    <Svg {...base(p)}>
      <Circle cx="12" cy="12" r="8.5" {...stroke(p)} />
      <Path d="M12 16.4v-4.8M12 8.2v.2" {...stroke(p)} />
    </Svg>
  );
}

/** The Summit mark: two peaks and a flag. Used in the header, not the tab bar. */
export function SummitMark({ size = 22, color = colour.forest }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      <Path d="M20 27 L34 53 H4 Z" fill={color} />
      <Path d="M39 16 L62 53 H16 Z" fill={color} />
      <Path d="M37.6 2.5 h2.8 v16 h-2.8 Z" fill={color} />
      <Path d="M40.4 3.6 L53 7.8 L40.4 12 Z" fill={color} />
    </Svg>
  );
}
