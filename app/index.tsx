import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useShareIntent } from "expo-share-intent";
import { SafeAreaView } from "react-native-safe-area-context";
import { isSupabaseConfigured } from "../src/config";
import { listReels, saveReel } from "../src/reels";
import type { Reel } from "../src/types";

export default function HomeScreen() {
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent();
  const [reels, setReels] = useState<Reel[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  const refresh = useCallback(async (q?: string) => {
    if (!isSupabaseConfigured) return;
    setLoading(true);
    try {
      setReels(await listReels(q));
    } catch (e) {
      setBanner(e instanceof Error ? e.message : "Failed to load saves.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Capture must never fail: the instant a reel is shared in, write it and confirm.
  useEffect(() => {
    if (!hasShareIntent) return;
    const shared = shareIntent.webUrl ?? shareIntent.text ?? "";
    if (!shared) return;
    (async () => {
      const result = await saveReel(shared, null);
      setBanner(result.ok ? "Saved. Search for it anytime." : `Save failed: ${result.error}`);
      resetShareIntent();
      await refresh(query);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasShareIntent]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!isSupabaseConfigured) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <Text style={styles.title}>Lately</Text>
          <Text style={styles.hint}>
            Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in a
            .env file (see .env.example) to connect your backend.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      {banner ? (
        <TouchableOpacity onPress={() => setBanner(null)} style={styles.banner}>
          <Text style={styles.bannerText}>{banner}</Text>
        </TouchableOpacity>
      ) : null}

      <TextInput
        style={styles.search}
        placeholder="Search what you remember…"
        value={query}
        onChangeText={setQuery}
        onSubmitEditing={() => refresh(query)}
        returnKeyType="search"
        autoCapitalize="none"
      />

      <FlatList
        data={reels}
        keyExtractor={(item) => item.id}
        contentContainerStyle={reels.length === 0 && styles.emptyWrap}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={() => refresh(query)} />
        }
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator style={{ marginTop: 40 }} />
          ) : (
            <Text style={styles.hint}>
              No saves yet. Share a reel to Lately to capture it.
            </Text>
          )
        }
        renderItem={({ item }) => <ReelCard reel={item} />}
      />
    </SafeAreaView>
  );
}

function ReelCard({ reel }: { reel: Reel }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.badge}>{statusLabel(reel.status)}</Text>
        {reel.category ? <Text style={styles.category}>{reel.category}</Text> : null}
      </View>
      <Text style={styles.cardTitle} numberOfLines={2}>
        {reel.title ?? reel.reason ?? reel.source_url}
      </Text>
      {reel.summary ? (
        <Text style={styles.cardSummary} numberOfLines={3}>
          {reel.summary}
        </Text>
      ) : null}
      <Text style={styles.cardUrl} numberOfLines={1}>
        {reel.source_url}
      </Text>
    </View>
  );
}

function statusLabel(status: Reel["status"]): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "enriched":
      return "Enriched";
    case "partial":
      return "Partial";
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  title: { fontSize: 28, fontWeight: "800", marginBottom: 12 },
  hint: { color: "#6b7280", textAlign: "center", paddingHorizontal: 24, marginTop: 16 },
  emptyWrap: { flexGrow: 1, justifyContent: "center" },
  banner: { backgroundColor: "#eef2ff", padding: 12 },
  bannerText: { color: "#3730a3", fontWeight: "600" },
  search: {
    margin: 16,
    padding: 12,
    borderRadius: 12,
    backgroundColor: "#f3f4f6",
    fontSize: 16,
  },
  card: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 16,
    borderRadius: 14,
    backgroundColor: "#fafafa",
    borderWidth: 1,
    borderColor: "#eee",
  },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  badge: { fontSize: 12, color: "#6b7280", fontWeight: "600" },
  category: { fontSize: 12, color: "#2563eb", fontWeight: "600" },
  cardTitle: { fontSize: 16, fontWeight: "700", marginBottom: 4 },
  cardSummary: { color: "#374151", marginBottom: 6 },
  cardUrl: { color: "#9ca3af", fontSize: 12 },
});
