import { Redirect } from "expo-router";

// The Save tab opens the save sheet (see the tabs layout), so this screen is only reached by a
// direct link or a reload on /save: send it to the sheet instead of an empty page.
export default function SaveTab() {
  return <Redirect href="/save-sheet" />;
}
