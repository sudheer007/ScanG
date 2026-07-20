import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { LogBox, Platform, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { AuthProvider } from "@/src/auth/AuthContext";

LogBox.ignoreAllLogs(true);

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useIconFonts();

  useEffect(() => {
    if (loaded || error) {
      SplashScreen.hideAsync();
    }
  }, [loaded, error]);

  if (!loaded && !error) return null;

  // On web, a phone-sized app stretched across a full desktop window spreads
  // the bottom tab bar (and everything else) edge-to-edge with huge gaps —
  // the labels end up far enough apart that most of them go unnoticed.
  // Native builds are unaffected (phones are already narrow).
  const content = (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: "#0A0A0C" },
        }}
      />
    </>
  );

  return (
    <AuthProvider>
      <SafeAreaProvider>
        {Platform.OS === "web" ? (
          <View style={{ flex: 1, backgroundColor: "#000" }}>
            <View style={{ flex: 1, width: "100%", maxWidth: 480, alignSelf: "center", backgroundColor: "#0A0A0C" }}>
              {content}
            </View>
          </View>
        ) : (
          <View style={{ flex: 1, backgroundColor: "#0A0A0C" }}>{content}</View>
        )}
      </SafeAreaProvider>
    </AuthProvider>
  );
}
