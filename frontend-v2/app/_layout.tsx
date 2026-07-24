import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { LogBox, Platform, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import { AuthProvider } from "@/src/auth/AuthContext";
import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { api } from "@/src/api";
import { useDocumentScrollUnlock } from "@/src/web/useDocumentScrollUnlock";

LogBox.ignoreAllLogs(true);

SplashScreen.preventAutoHideAsync();

const rootStyle =
  Platform.OS === "web"
    ? ({
        flexGrow: 1,
        minHeight: "100dvh",
        height: "auto",
        backgroundColor: "#0A0A0C",
      } as const)
    : ({ flex: 1, backgroundColor: "#0A0A0C" } as const);

export default function RootLayout() {
  const [loaded, error] = useIconFonts();
  useDocumentScrollUnlock();

  useEffect(() => {
    // Wake Render free-tier API as early as possible (before tab data fetches).
    api.wakeBackend();
  }, []);

  useEffect(() => {
    if (loaded || error) {
      SplashScreen.hideAsync();
    }
  }, [loaded, error]);

  if (!loaded && !error) return null;

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <View style={rootStyle}>
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: "#0A0A0C" },
            }}
          />
        </View>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
