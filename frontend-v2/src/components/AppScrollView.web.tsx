import React from 'react';
import {
  ScrollView,
  View,
  StyleSheet,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

/**
 * Web page scroller — do NOT use a nested overflow ScrollView.
 * Content grows with the document; html/body scroll, so mobile Chrome can
 * show its native pull-to-refresh from the address bar (Cricbuzz-style).
 * refreshControl is ignored on purpose.
 */
export default function AppScrollView({
  style,
  contentContainerStyle,
  children,
  horizontal,
  refreshControl: _refreshControl,
  ...rest
}: ScrollViewProps) {
  // Horizontal rows (chips, tabs) must keep real overflow scrolling.
  if (horizontal) {
    return (
      <ScrollView horizontal style={style} contentContainerStyle={contentContainerStyle} {...rest}>
        {children}
      </ScrollView>
    );
  }

  return (
    <View
      // RN Web → data-page-scroll="true"
      {...({ dataSet: { pageScroll: 'true' } } as object)}
      style={[style as StyleProp<ViewStyle>, styles.root]}
    >
      <View style={contentContainerStyle as StyleProp<ViewStyle>}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    // Grow with content; never create a nested scrollport.
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: 'auto',
    height: 'auto' as unknown as number,
    overflow: 'visible',
  },
});
