import { Image } from "expo-image";
import { View, type ViewStyle } from "react-native";

import { colors } from "../theme/tokens";
import { Icon } from "./Icon";

const GAP = 2;

function Cell({ uri, flex = 1 }: { uri: string; flex?: number }) {
  return <Image source={{ uri }} contentFit="cover" style={{ flex, backgroundColor: colors.raised }} />;
}

/** Stack cover: 0–4 thumbnails arranged in one rounded square frame (Stitch "07 Stacks"). */
export function StackCollage({ covers, radius = 14, size }: { covers: string[]; radius?: number; size?: number }) {
  const frame: ViewStyle = {
    width: size ?? "100%",
    aspectRatio: 1,
    borderRadius: radius,
    overflow: "hidden",
    backgroundColor: colors.raised,
  };
  const [a, b, c, d] = covers;
  let body;
  if (!a) {
    body = (
      <View className="flex-1 items-center justify-center">
        <Icon name="folder-open" size={size && size < 60 ? 18 : 32} color={colors.ink3} />
      </View>
    );
  } else if (!b) {
    body = <Cell uri={a} />;
  } else if (!c) {
    body = (
      <View style={{ flex: 1, flexDirection: "row", gap: GAP }}>
        <Cell uri={a} />
        <Cell uri={b} />
      </View>
    );
  } else {
    body = (
      <View style={{ flex: 1, flexDirection: "row", gap: GAP }}>
        <View style={{ flex: 1, gap: GAP }}>
          <Cell uri={a} />
          {d ? <Cell uri={d} /> : null}
        </View>
        <View style={{ flex: 1, gap: GAP }}>
          <Cell uri={b} />
          <Cell uri={c} />
        </View>
      </View>
    );
  }
  return (
    <View className="border border-hairline" style={frame}>
      {body}
    </View>
  );
}
