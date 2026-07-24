import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

type Props = {
  refreshing?: boolean;
  onRefresh?: () => void;
  tintColor?: string;
  colors?: string[];
  enabled?: boolean;
  progressViewOffset?: number;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactElement;
  title?: string;
  titleColor?: string;
};

/**
 * Web: no custom pull-to-refresh UI or gesture.
 * ScrollView clones this around itself — we only pass layout through so the
 * browser's native pull-to-refresh (Chrome address-bar spinner, Cricbuzz-style)
 * can run. In-app PTR was firing mid-scroll and showing a spinner inside content.
 */
export default function AppRefreshControl({ style, children }: Props) {
  return <View style={[{ flex: 1, minHeight: 0 }, style]}>{children}</View>;
}
