// 押すと拡大の画面（PhotoViewer）で大きく見られる写真（0040）。
// 戻る操作（ブラウザの戻る、Android の戻る）でも閉じる: 開くときに履歴を一つ積み、閉じるボタンは履歴を戻して閉じる。
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Entrance, Photo } from "../../shared/api";
import { words } from "../words";
import { PhotoImage } from "./PhotoImage";
import { PhotoViewer } from "./PhotoViewer";

/** 履歴に積む印。この印の上にいる間だけ、戻る操作を「閉じる」とみなす */
const VIEWER_STATE = "omoide.photoViewer";

type Props = {
  photo: Photo;
  focus?: Entrance["focus"];
  variant: "elder" | "family";
  /** 押してよいか。アルバムの帯では、めくった直後の指離れで開かないよう、帯が止まっているときだけ真 */
  canOpen?: () => boolean;
  /** 押せるか（帯の見えていない写真は -1 にしてフォーカスを渡さない） */
  tabIndex?: number;
};

type State = "closed" | "open" | "closing";

export function ZoomablePhoto({ photo, focus, variant, canOpen, tabIndex }: Props) {
  const [state, setState] = useState<State>("closed");
  const buttonRef = useRef<HTMLButtonElement>(null);
  const pushed = useRef(false);
  /** 押した瞬間に沈める（:active は指で付かない端末があるので、自分で印を付ける） */
  const [pressed, setPressed] = useState(false);

  const open = () => {
    if (state !== "closed" || (canOpen && !canOpen())) return;
    history.pushState({ [VIEWER_STATE]: true }, "");
    pushed.current = true;
    setState("open");
  };

  // 戻る操作で閉じる
  useEffect(() => {
    if (state !== "open") return;
    const onPop = () => {
      if (!pushed.current) return;
      pushed.current = false;
      setState("closing");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [state]);

  // 閉じるボタン・Esc: 積んだ履歴を戻す（popstate で閉じ始める）。履歴が替わっていればそのまま閉じる
  const requestClose = useCallback(() => {
    if (pushed.current && (history.state as Record<string, unknown> | null)?.[VIEWER_STATE]) history.back();
    else {
      pushed.current = false;
      setState("closing");
    }
  }, []);

  const onClosed = useCallback(() => {
    setState("closed");
    buttonRef.current?.focus({ preventScroll: true });
  }, []);

  // 開いたまま画面が外れたら（タブを替えた、日が替わった）、積んだ履歴は残しても害はない（戻ると何も起きない）
  const origin = useCallback(() => buttonRef.current?.querySelector("img") ?? null, []);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="photo-button"
        aria-label={words.photoView.open}
        tabIndex={tabIndex}
        data-pressed={pressed || undefined}
        onPointerDown={() => setPressed(true)}
        onPointerUp={() => setPressed(false)}
        onPointerCancel={() => setPressed(false)}
        onPointerLeave={() => setPressed(false)}
        onClick={open}
      >
        <PhotoImage photo={photo} focus={focus} />
      </button>
      {state !== "closed" &&
        createPortal(
          <PhotoViewer
            photo={photo}
            origin={origin}
            closing={state === "closing"}
            onRequestClose={requestClose}
            onClosed={onClosed}
            closeLabel={variant === "elder" ? words.elder.close : words.home.close}
            label={words.photoView.label}
          />,
          document.body,
        )}
    </>
  );
}
