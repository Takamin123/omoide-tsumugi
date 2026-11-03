// 道すじと、家族の情報・本人の持ち方。画面の流れは docs/decisions/0008-first-day-screens-and-words.md
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { api, ApiError, type FamilyViewWithClock } from "./lib/api";
import { errorText } from "./lib/errors";
import { loadMe, saveMe } from "./lib/me";
import { tokenFromJoinPath } from "./lib/pure";
import { navigate, usePath } from "./lib/route";
import { DemoBar, type DemoProps } from "./parts/DemoBar";
import { ErrorLine } from "./parts/ErrorLine";
import { AddPhotos } from "./screens/AddPhotos";
import { Elder } from "./screens/Elder";
import { FamilySetup } from "./screens/FamilySetup";
import { Home } from "./screens/Home";
import { Join } from "./screens/Join";
import { Start } from "./screens/Start";
import { WhoAreYou } from "./screens/WhoAreYou";
import { words } from "./words";

/**
 * 開発用の確かめページ。ふだんの画面の読み込みを重くしないよう分ける。
 * 本番のビルドでは __CHECK_PAGE__ が false になり、chunk ごと入らない。/check はほかの知らない道と同じ扱いになる（0014）
 */
const CheckPage = __CHECK_PAGE__ ? lazy(() => import("./check/CheckPage")) : null;
/** 運営の記録の画面。本番のビルドにも入る（chunk は分ける）。守りはサーバーの運営の鍵（0030） */
const OpsRecordPage = lazy(() => import("./ops/RecordPage"));

type Load =
  | { state: "loading" }
  | { state: "ready"; view: FamilyViewWithClock }
  | { state: "no-session" }
  | { state: "error"; text: string };

export function App() {
  const path = usePath();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  /** 本人を変えたとき・デモの時計を進めたときに、画面を作り直す */
  const [tick, setTick] = useState(0);
  /** 作ったばかりの招待の合言葉。サーバーはハッシュしか持たないので、作ったときにだけ見せられる。端末には残さない */
  const [inviteToken, setInviteToken] = useState<string | null>(null);


  const reload = useCallback(async () => {
    try {
      const view = await api.getFamily();
      setLoad({ state: "ready", view });
    } catch (e) {
      if (e instanceof ApiError && e.kind === "unauthorized") setLoad({ state: "no-session" });
      else setLoad({ state: "error", text: errorText(e) });
    }
  }, []);

  const joinToken = tokenFromJoinPath(path);
  const isCheck = CheckPage !== null && path === "/check";
  const isOps = path === "/ops/record";
  const needsFamily = !joinToken && path !== "/start" && !isOps && !isCheck;
  useEffect(() => {
    if (needsFamily) void reload();
  }, [needsFamily, reload]);

  if (isCheck) {
    return (
      <Suspense fallback={<main><p>{words.loading}</p></main>}>
        <CheckPage />
      </Suspense>
    );
  }
  if (isOps) {
    return (
      <Suspense fallback={<main><p>{words.loading}</p></main>}>
        <OpsRecordPage />
      </Suspense>
    );
  }
  if (joinToken) {
    return (
      <Join
        token={joinToken}
        onJoined={() => {
          setLoad({ state: "loading" });
          navigate("/", { replace: true });
        }}
      />
    );
  }
  if (path === "/start") {
    return (
      <Start
        onCreated={(token) => {
          setInviteToken(token);
          setLoad({ state: "loading" });
          navigate("/", { replace: true });
        }}
      />
    );
  }

  if (load.state === "loading") return <main><p>{words.loading}</p></main>;
  if (load.state === "no-session") return <main><p>{words.noSession}</p></main>;
  if (load.state === "error") {
    return (
      <main className="stack">
        <ErrorLine text={load.text} />
        <button type="button" onClick={() => void reload()}>
          {words.retry}
        </button>
      </main>
    );
  }

  const view = load.view;
  const familyId = view.family.id;
  const setMe = (memberId: string | null) => {
    saveMe(memberId ? { familyId, memberId } : null);
    setTick((t) => t + 1);
  };
  const meId = loadMe(familyId);
  const meMember = view.members.find((m) => m.id === meId) ?? null;
  if (!meMember) {
    return (
      <WhoAreYou
        view={view}
        onChosen={(id) => {
          setMe(id);
          void reload();
        }}
      />
    );
  }

  // デモの操作。出すかどうかはサーバーが決める（canAdvanceClock）。出さないときは描かない
  const demo: DemoProps | null =
    view.family.canAdvanceClock === true
      ? {
          clock: view.family.clock,
          onAdvanced: () => {
            void reload();
            setTick((t) => t + 1);
          },
        }
      : null;

  const common = { view, me: meMember, reload };
  let screen;
  if (path === "/family") {
    screen = <FamilySetup {...common} inviteToken={inviteToken} onInviteToken={setInviteToken} />;
  } else if (path === "/photos") {
    screen = <AddPhotos {...common} />;
  } else if (meMember.role === "elder") {
    // 祖父母の画面は、録音済みファイルの送信も帯に入れるため、帯を自分で描く
    return <Elder key={`${meMember.id}-${tick}`} {...common} onSwitch={setMe} demo={demo} />;
  } else {
    // 家族の画面は、下のタブと重ならないよう、デモの帯を各タブのスクロールの一番下に自分で置く
    return <Home key={tick} {...common} onSwitchUser={() => setMe(null)} demo={demo} />;
  }
  return (
    <>
      {screen}
      {demo && (
        <div className="foot">
          <DemoBar {...demo} />
        </div>
      )}
    </>
  );
}
