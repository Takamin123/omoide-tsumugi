// 道すじと、家族の情報。端末の人はサーバーが決める（view.me。リンクが人を指す。0036）。画面の流れは 0008 と 0036
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { api, ApiError, type FamilyViewWithClock } from "./lib/api";
import { errorText } from "./lib/errors";
import { screenFor, tokenFromJoinPath } from "./lib/pure";
import { navigate, usePath } from "./lib/route";
import { DemoBar, type DemoProps } from "./parts/DemoBar";
import { ErrorLine } from "./parts/ErrorLine";
import { AddPhotos } from "./screens/AddPhotos";
import { Elder } from "./screens/Elder";
import { FamilySetup } from "./screens/FamilySetup";
import { FirstPerson } from "./screens/FirstPerson";
import { Home } from "./screens/Home";
import { Join } from "./screens/Join";
import { Start } from "./screens/Start";
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
  /** デモの時計を進めたときに、画面を作り直す */
  const [tick, setTick] = useState(0);

  const reload = useCallback(async () => {
    try {
      const view = await api.getFamily();
      setLoad({ state: "ready", view });
    } catch (e) {
      if (e instanceof ApiError && e.kind === "unauthorized") setLoad({ state: "no-session" });
      else setLoad({ state: "error", text: errorText(e) });
    }
  }, []);

  /** 静かに読み直す: 失敗しても今の画面のまま（家族のことを開いたとき。0053） */
  const refresh = useCallback(async () => {
    try {
      const view = await api.getFamily();
      setLoad({ state: "ready", view });
    } catch {
      // 前の家族の様子を残す
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
        onCreated={() => {
          setLoad({ state: "loading" });
          navigate("/", { replace: true });
        }}
      />
    );
  }

  // 人がまだ決まっていない間（読み込み中・リンクなし・読めなかった）は、祖父母の画面の人かもしれないので、祖父母の画面の大きさで出す（0060）
  if (load.state === "loading") return <main className="elder"><p>{words.loading}</p></main>;
  if (load.state === "no-session") return <main className="elder"><p>{words.noSession}</p></main>;
  if (load.state === "error") {
    return (
      <main className="stack elder">
        <ErrorLine text={load.text} />
        <button type="button" onClick={() => void reload()}>
          {words.retry}
        </button>
      </main>
    );
  }

  const view = load.view;
  const meMember = view.me;
  const kind = screenFor(meMember, view.members.length, path);
  // 最初の人のリンクで、もう誰かいる（同じリンクを二台目で開いたなど）: このリンクでは入れない
  if (kind === "no-session") return <main className="elder"><p>{words.noSession}</p></main>;
  if (kind === "first-person" || !meMember) return <FirstPerson onDone={() => void reload()} />;

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

  const key = `${meMember.id}-${tick}`;
  // 祖父母の画面の人は、どの道でも祖父母の画面（/family、/photos は出さない。家族のことはサーバーも 403。0036）。
  // 録音済みファイルの送信も帯に入れるため、帯を自分で描く
  if (kind === "elder") return <Elder key={key} view={view} me={meMember} demo={demo} />;
  let screen;
  if (kind === "family-setup") {
    screen = <FamilySetup view={view} me={meMember} reload={reload} refresh={refresh} />;
  } else if (kind === "photos") {
    screen = <AddPhotos me={meMember} members={view.members} />;
  } else {
    // 家族の画面は、下のタブと重ならないよう、デモの帯を各タブのスクロールの一番下に自分で置く
    return <Home key={key} view={view} me={meMember} demo={demo} />;
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
