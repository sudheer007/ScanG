import React from 'react';
import { ScrollView, type ScrollViewProps } from 'react-native';

/**
 * Web page scroller — same nested ScrollView as native.
 * Document-level scrolling was tried for browser PTR but broke tab isolation
 * (inactive screens stacked/overlapped). Keep overflow scroll contained.
 */
export default function AppScrollView(props: ScrollViewProps) {
  return <ScrollView {...props} />;
}
