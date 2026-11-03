// 最初の人のリンクで開いた端末（家族にまだ誰もいない）: 始める人が自分を入れる。
// 画面の欄は出さない（最初の人は家族の画面の人。0036）。入れたらサーバーが端末をその人のリンクに替える
import type { Member } from "../../shared/api";
import { MemberForm } from "../parts/MemberForm";
import { words } from "../words";

export function FirstPerson({ onDone }: { onDone: (m: Member) => void }) {
  return (
    <main>
      <h1>{words.firstPerson.title}</h1>
      <MemberForm setUpByMemberId={null} fixedRole="family" onDone={onDone} />
    </main>
  );
}
