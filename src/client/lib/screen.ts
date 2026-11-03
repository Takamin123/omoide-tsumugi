// 祖父母の画面と家族の画面は、同じ部品を使い、言葉と大きさだけが違う（0043）。
// どちらの画面の中かを、部品（ReplyBox、Narrations、Album）に配る。大きさは styles.css の .home-shell.elder が替える。
import { createContext, useContext } from "react";
import { words } from "../words";

export type ScreenVariant = "elder" | "family";

export const ScreenContext = createContext<ScreenVariant>("family");

/**
 * 祖父母の画面で残している「おくりました」の場所。残るのは一つだけで、次に答え始める・返事を始めると消える（0028、0043）。
 * 家族の画面では null（部品はしばらく出して消す）
 */
export type SentNotice = { at: string | null; show: (at: string) => void; clear: () => void };
export const SentNoticeContext = createContext<SentNotice | null>(null);
export const useSentNotice = () => useContext(SentNoticeContext);

/** 今の画面と、その画面の部品の言葉 */
export function useScreen() {
  const variant = useContext(ScreenContext);
  return { variant, elder: variant === "elder", w: words.screen[variant] };
}
