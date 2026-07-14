import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';

type Props = {
  /** 0–1 share of the ring for principal investment. */
  principalRatio: number;
  centerLabel: string;
  size?: number;
  strokeWidth?: number;
  principalColor?: string;
  returnsColor?: string;
};

export function DonutChart({
  principalRatio,
  centerLabel,
  size = 132,
  strokeWidth = 20,
  principalColor = '#1A82FF',
  returnsColor = '#FFFFFF',
}: Props) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const principal = Math.min(1, Math.max(0, Number.isFinite(principalRatio) ? principalRatio : 1));
  const returns = 1 - principal;

  const principalDash = principal * circumference;
  const returnsDash = returns * circumference;

  const arcs = useMemo(
    () => ({
      principalDash,
      returnsDash,
      gap: circumference,
    }),
    [principalDash, returnsDash, circumference],
  );

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <G transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          {/* Returns segment (white) */}
          {arcs.returnsDash > 0.5 ? (
            <Circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              stroke={returnsColor}
              strokeWidth={strokeWidth}
              fill="none"
              strokeDasharray={`${arcs.returnsDash} ${arcs.gap}`}
              strokeDashoffset={0}
            />
          ) : null}
          {/* Principal segment (light blue), continues after returns */}
          {arcs.principalDash > 0.5 ? (
            <Circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              stroke={principalColor}
              strokeWidth={strokeWidth}
              fill="none"
              strokeDasharray={`${arcs.principalDash} ${arcs.gap}`}
              strokeDashoffset={-arcs.returnsDash}
            />
          ) : null}
        </G>
      </Svg>
      <View style={[StyleSheet.absoluteFillObject, styles.center]} pointerEvents="none">
        <Text style={styles.centerText}>{centerLabel}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  centerText: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
});
