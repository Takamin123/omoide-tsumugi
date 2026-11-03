// 祖父母の画面（スマホとタブレット）。家族の画面と同じ形（下のタブ「今日」「アルバム」、答え方「はなす」「かく」、アルバム、返事）で、
// 違うのは言葉（ひらがなのボタン、祖父母のエラーの文）と大きさ（祖父母の画面の定数）、問いかけの読み上げだけ（0043）。
// 上にメニューは置かない（家族のことは触れない。0036）。話す人はリンクで決まり、切り替えの道は置かない（0036、0037）。
// デモの帯の録音済みファイルは、今日の答えのマイクと同じ送る流れに入る（Home の answer。0008）
import type { FamilyView, Member } from "../../shared/api";
import type { DemoProps } from "../parts/DemoBar";
import { Home } from "./Home";

type Props = { view: FamilyView; me: Member; demo: DemoProps | null };

export function Elder(props: Props) {
  return <Home {...props} variant="elder" />;
}
