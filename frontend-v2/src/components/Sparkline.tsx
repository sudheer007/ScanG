import React from 'react';
import { View } from 'react-native';
import Svg, { Polyline, Defs, LinearGradient, Stop, Path } from 'react-native-svg';
import { theme } from '@/src/theme';

interface Props {
  data: number[];
  width?: number;
  height?: number;
  strokeWidth?: number;
  color?: string;
  fill?: boolean;
}

export default function Sparkline({ data, width = 80, height = 28, strokeWidth = 1.5, color, fill = false }: Props) {
  if (!data || data.length < 2) {
    return <View style={{ width, height }} />;
  }
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const stepX = width / (data.length - 1);
  const points = data
    .map((v, i) => `${(i * stepX).toFixed(2)},${(height - ((v - min) / range) * height).toFixed(2)}`)
    .join(' ');
  const stroke = color ?? (data[data.length - 1] >= data[0] ? theme.colors.success : theme.colors.error);

  const id = `sparkfill-${stroke.replace('#', '')}`;
  const lastPoint = points.split(' ').pop() || `${width},${height}`;
  const firstPoint = points.split(' ')[0] || `0,${height}`;
  const fillPath = fill ? `M ${firstPoint} L ${points.split(' ').join(' L ')} L ${lastPoint.split(',')[0]},${height} L ${firstPoint.split(',')[0]},${height} Z` : '';

  return (
    <Svg width={width} height={height}>
      {fill && (
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={stroke} stopOpacity={0.25} />
            <Stop offset="1" stopColor={stroke} stopOpacity={0} />
          </LinearGradient>
        </Defs>
      )}
      {fill && <Path d={fillPath} fill={`url(#${id})`} />}
      <Polyline points={points} fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
    </Svg>
  );
}
