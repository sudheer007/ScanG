import React from 'react';
import { RefreshControl, type RefreshControlProps } from 'react-native';

import { theme } from '@/src/theme';

/**
 * Native pull-to-refresh. Defaults match app dark theme (iOS tint + Android spinner).
 */
export default function AppRefreshControl({
  tintColor = theme.colors.text,
  colors = [theme.colors.text],
  progressBackgroundColor = theme.colors.bg2,
  ...rest
}: RefreshControlProps) {
  return (
    <RefreshControl
      tintColor={tintColor}
      colors={colors}
      progressBackgroundColor={progressBackgroundColor}
      {...rest}
    />
  );
}
