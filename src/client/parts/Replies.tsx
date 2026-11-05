// 返事のタブ（0058）: この人に届いたもの（自分の語りへの返事と、自分が入れた写真への語り）を、写真ごとに新しく届いた順に出す。
// 写真ごとの節の頭に小さめの写真（押すと拡大。0040）と写真の記録（撮影日・場所。0047。なければ出さない）、その下に届いたものを含む糸
// （自分の語りへの返事なら自分の語りが上に。lib/replies.ts）。その場で返事を書ける（Narrations・ReplyBox。言葉の糸は出さない）。
// 届いたものがなければ一行だけ（画面ごとの文。催促にしない）。見出し・呼ばれ方は置かない。
// 写真ごとに白いカード（0059）。開いた時点でまだ見ていなかった語りは淡い青の箱と札「新しい」（そのタブを開いている間だけ。0061）。
import type { ReactNode } from "react";
import { formatPlace, formatTakenDate } from "../lib/pure";
import type { ReplyGroup } from "../lib/replies";
import { useScreen } from "../lib/screen";
import { Narrations } from "./Narrations";
import { ZoomablePhoto } from "./ZoomablePhoto";

type Props = {
  groups: ReplyGroup[];
  nameOf: (memberId: string) => string;
  openReplyId: string | null;
  onOpenReply: (narrationId: string | null) => void;
  onSent: () => void;
  /** 開いた時点でまだ見ていなかった語りの ID（「新しい」。0061） */
  fresh?: ReadonlySet<string>;
  /** 一覧をまだ読めていない（読み込み中・読めなかった）。空の文を出さない */
  loading: boolean;
  /** 一番下に置くもの（デモの帯） */
  footer?: ReactNode;
};

export function Replies({ groups, nameOf, openReplyId, onOpenReply, onSent, fresh, loading, footer }: Props) {
  const { variant, elder, w } = useScreen();
  return (
    <div className="home-scroll">
      <main className="stack home replies">
        {!loading && groups.length === 0 && <p className={elder ? undefined : "sub"}>{w.noReplies}</p>}
        {groups.map((group, i) => {
          const { item } = group;
          const taken = formatTakenDate(item.photo.takenAt);
          const place = formatPlace(item.photo.place);
          return (
            <section key={item.photo.id} className="replies-group card-soft" data-photo={item.photo.id}>
              <div className="replies-head">
                <div className="replies-photo">
                  <ZoomablePhoto photo={item.photo} variant={variant} lazy={i > 2} />
                </div>
                {(taken || place) && (
                  <p className="photo-facts">
                    {taken && <span>{taken}</span>}
                    {place && <span>{place}</span>}
                  </p>
                )}
              </div>
              <Narrations
                narrations={group.narrations}
                nameOf={nameOf}
                openReplyId={openReplyId}
                onOpenReply={onOpenReply}
                onSent={onSent}
                fresh={fresh}
              />
            </section>
          );
        })}
      </main>
      {footer}
    </div>
  );
}
