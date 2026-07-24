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
 * Web: pass-through only (no custom pull gesture / spinner).
 * Custom in-app PTR was firing mid-scroll; browser PTR needs document scroll
 * which breaks Expo tab isolation. ScrollView still clones this as a wrapper.
 */
export default function AppRefreshControl({ style, children }: Props) {
  return <View style={[{ flex: 1, minHeight: 0 }, style]}>{children}</View>;
}
