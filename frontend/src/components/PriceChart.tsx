import React from 'react';
import { View } from 'react-native';
import Svg, { Path, Defs, LinearGradient, Stop, Line, Text as SvgText } from 'react-native-svg';
import { theme } from '@/src/theme';

interface Props {
  data: number[];
  width: number;
  height: number;
  color?: string;
}

export default function PriceChart({ data, width, height, color }: Props) {
  if (!data || data.length < 2) return <View style={{ width, height }} />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const padTop = 8;
  const padBottom = 8;
  const drawH = height - padTop - padBottom;
  const stepX = width / (data.length - 1);

  const linePoints = data.map((v, i) => `${(i * stepX).toFixed(2)},${(padTop + drawH - ((v - min) / range) * drawH).toFixed(2)}`);
  const linePath = `M ${linePoints[0]} L ${linePoints.slice(1).join(' L ')}`;
  const fillPath = `${linePath} L ${linePoints[linePoints.length - 1].split(',')[0]},${height - padBottom} L 0,${height - padBottom} Z`;
  const stroke = color ?? (data[data.length - 1] >= data[0] ? theme.colors.success : theme.colors.error);

  // y-axis grid lines (3 lines)
  const gridLines = [0, 0.5, 1].map((p) => padTop + drawH * p);
  const id = `chartfill-${stroke.replace('#', '')}`;

  return (
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
    </Svg>
  );
}
