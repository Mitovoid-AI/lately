import { InstagramScreen } from "../screens/InstagramScreen";

/** A new account's first screen: connect Instagram before anything else (no back, no skip). */
export default function ConnectInstagram() {
  return <InstagramScreen required />;
}
