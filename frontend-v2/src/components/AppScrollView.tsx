import React from 'react';
import { ScrollView, type ScrollViewProps } from 'react-native';

/**
 * Page-level vertical scroller. On native this is a normal ScrollView
 * (with pull-to-refresh). On web see AppScrollView.web.tsx — content flows
 * into the document so Chrome's address-bar pull-to-refresh can work.
 */
export default function AppScrollView(props: ScrollViewProps) {
  return <ScrollView {...props} />;
}
