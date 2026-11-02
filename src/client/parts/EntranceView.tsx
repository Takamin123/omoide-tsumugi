// 入り口の表示: 写真、添える家族の言葉（話者の呼ばれ方つき）、問いかけ一つ。
// 問いかけが null（固定の入り口）のときは、クライアントの固定の一文を出す。
import type { Entrance, Member } from "../../shared/api";
import { words } from "../words";
import { PhotoImage } from "./PhotoImage";

export function EntranceView({ entrance, members }: { entrance: Entrance; members: Member[] }) {
  const quoteBy = entrance.quote ? members.find((m) => m.id === entrance.quote?.speakerMemberId)?.calledAs : null;
  return (
    <div className="stack">
      <PhotoImage photo={entrance.photo} focus={entrance.focus} />
      {entrance.quote && (
        <figure className="quote">
          <blockquote style={{ margin: 0 }}>{entrance.quote.text}</blockquote>
          {quoteBy && <figcaption className="sub">{quoteBy}</figcaption>}
        </figure>
      )}
      <p className="question">{entrance.question ?? words.fixedQuestion}</p>
    </div>
  );
}
