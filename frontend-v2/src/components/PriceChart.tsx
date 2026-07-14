import React, { useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, PanResponder, GestureResponderEvent } from 'react-native';
import Svg, { Path, Defs, LinearGradient, Stop, Line, Circle, Text as SvgText, Rect } from 'react-native-svg';
import { theme } from '@/src/theme';

interface Props {
  data: number[];
  /** Optional matching timestamps (ISO strings or epoch seconds). Length must match data. */
  timestamps?: (string | number)[];
  width: number;
  height: number;
  color?: string;
  /** When true, shows the overall period change banner at the top. */
  showPeriodChange?: boolean;
}

/**
 * Interactive line chart:
 *  - Shows overall period % change at top.
 *  - Single-finger drag: vertical line + crosshair dot + tooltip with price (+ date if timestamps).
 *  - Two-finger drag: TWO vertical lines + % difference banner between them, updates live.
 *  - Release: clears all markers.
 */
export default function PriceChart({ data, timestamps, width, height, color, showPeriodChange = true }: Props) {
  const [touches, setTouches] = useState<number[]>([]); // x positions in chart coords (sorted)
  const containerX = useRef(0);

  const min = useMemo(() => (data.length ? Math.min(...data) : 0), [data]);
  const max = useMemo(() => (data.length ? Math.max(...data) : 1), [data]);
  const range = max - min || 1;

  const padTop = 28;       // room for the banner
  const padBottom = 12;
  const drawH = height - padTop - padBottom;
  const stepX = data.length > 1 ? width / (data.length - 1) : width;

  // overall % change
  const overallPct = useMemo(() => {
    if (!data || data.length < 2) return null;
    const first = data[0]; const last = data[data.length - 1];
    if (!first) return null;
    return ((last - first) / first) * 100;
  }, [data]);

  const stroke = color ?? ((data.length && data[data.length - 1] >= data[0]) ? theme.colors.success : theme.colors.error);

  const xToIndex = (x: number) => {
    const i = Math.round(x / stepX);
    return Math.max(0, Math.min(data.length - 1, i));
  };
  const yAtIndex = (i: number) => padTop + drawH - ((data[i] - min) / range) * drawH;

  // PanResponder — handles both single and double touch, tracks moves live
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => updateFromEvent(e),
      onPanResponderMove: (e) => updateFromEvent(e),
      onPanResponderRelease: () => setTouches([]),
      onPanResponderTerminate: () => setTouches([]),
    })
  ).current;

  function updateFromEvent(e: GestureResponderEvent) {
    const native = e.nativeEvent as any;
    const all = (native.touches || []) as Array<{ pageX: number; locationX?: number }>;
    if (!all.length) return;
    const xs = all
      .map((t) => (t.locationX != null ? t.locationX : t.pageX - containerX.current))
      .map((x) => Math.max(0, Math.min(width, x)))
      .sort((a, b) => a - b);
    setTouches(xs.slice(0, 2)); // up to two
  }

  if (!data || data.length < 2) return <View style={{ width, height }} />;

  const linePoints = data.map((v, i) => `${(i * stepX).toFixed(2)},${(padTop + drawH - ((v - min) / range) * drawH).toFixed(2)}`);
  const linePath = `M ${linePoints[0]} L ${linePoints.slice(1).join(' L ')}`;
  const lastX = (data.length - 1) * stepX;
  const fillPath = `${linePath} L ${lastX.toFixed(2)},${(height - padBottom).toFixed(2)} L 0,${(height - padBottom).toFixed(2)} Z`;

  const id = `chartfill-${stroke.replace('#', '')}`;
  const gridLines = [0, 0.5, 1].map((p) => padTop + drawH * p);

  // Compute crosshair info for current touches
  const cross = touches.map((x) => {
    const idx = xToIndex(x);
    return {
      x: idx * stepX,
      y: yAtIndex(idx),
      v: data[idx],
      t: timestamps?.[idx],
      idx,
    };
  });

  // % difference banner (when 2 touches)
  let diffPct: number | null = null;
  if (cross.length === 2) {
    const a = cross[0].v; const b = cross[1].v;
    if (a) diffPct = ((b - a) / a) * 100;
  }

  // single-touch tooltip
  const singleTip = cross.length === 1 ? cross[0] : null;

  function fmtDate(t?: string | number): string {
    if (t == null) return '';
    try {
      const d = typeof t === 'number' ? new Date(t * 1000) : new Date(t);
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch { return ''; }
  }

  return (
    <View
      style={{ width, height }}
      onLayout={(ev) => { containerX.current = ev.nativeEvent.layout.x; }}
      {...responder.panHandlers}
    >
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={stroke} stopOpacity={0.25} />
            <Stop offset="1" stopColor={stroke} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        {gridLines.map((y, i) => (
          <Line key={i} x1={0} x2={width} y1={y} y2={y} stroke={theme.colors.divider} strokeWidth={0.5} strokeDasharray="3 4" />
        ))}
        <Path d={fillPath} fill={`url(#${id})`} />
        <Path d={linePath} stroke={stroke} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
        <SvgText x={4} y={padTop + 4} fontSize={9} fill={theme.colors.textSubtle}>{max.toFixed(2)}</SvgText>
        <SvgText x={4} y={height - 2} fontSize={9} fill={theme.colors.textSubtle}>{min.toFixed(2)}</SvgText>

        {/* Crosshair lines + dots */}
        {cross.map((c, i) => (
          <React.Fragment key={i}>
            <Line x1={c.x} x2={c.x} y1={padTop} y2={height - padBottom} stroke={theme.colors.text} strokeWidth={1} strokeDasharray="2 3" opacity={0.7} />
            <Circle cx={c.x} cy={c.y} r={5} fill={stroke} stroke={theme.colors.bg} strokeWidth={2} />
          </React.Fragment>
        ))}

        {/* Two-touch range shade */}
        {cross.length === 2 ? (
          <Rect
            x={Math.min(cross[0].x, cross[1].x)}
            y={padTop}
            width={Math.abs(cross[1].x - cross[0].x)}
            height={drawH}
            fill={(diffPct ?? 0) >= 0 ? theme.colors.success : theme.colors.error}
            opacity={0.08}
          />
        ) : null}
      </Svg>

      {/* Top banner — overall % change (when no touch) or live diff (when touching) */}
      {showPeriodChange ? (
        <View style={styles.banner} pointerEvents="none">
          {cross.length === 2 && diffPct != null ? (
            <Text style={[styles.bannerText, { color: diffPct >= 0 ? theme.colors.success : theme.colors.error }]}>
              {diffPct >= 0 ? '+' : ''}{diffPct.toFixed(2)}% between points
              {cross[0].t && cross[1].t ? `  ·  ${fmtDate(cross[0].t)} → ${fmtDate(cross[1].t)}` : ''}
            </Text>
          ) : singleTip ? (
            <Text style={styles.bannerText}>
              <Text style={{ color: theme.colors.text, fontWeight: '800' }}>{singleTip.v.toFixed(2)}</Text>
              {singleTip.t ? <Text style={{ color: theme.colors.textMuted }}>  ·  {fmtDate(singleTip.t)}</Text> : null}
            </Text>
          ) : overallPct != null ? (
            <Text style={[styles.bannerText, { color: overallPct >= 0 ? theme.colors.success : theme.colors.error }]}>
              Period: {overallPct >= 0 ? '+' : ''}{overallPct.toFixed(2)}%
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 4,
    left: 8,
    right: 8,
    alignItems: 'flex-start',
  },
  bannerText: {
    color: theme.colors.text,
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    backgroundColor: theme.colors.bg2,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    overflow: 'hidden',
  },
});
