// 審査員の道（/demo/<鍵> の下。0062）の head。検索に載せない・URL の鍵を外に漏らさない。外のものを読み込まないページだが、重ねて置く
import { useLayoutEffect } from "react";

export function useGuideHead() {
  useLayoutEffect(() => {
    const metas = [
      ["robots", "noindex, nofollow"],
      ["referrer", "no-referrer"],
    ].map(([name, content]) => {
      const m = document.createElement("meta");
      m.name = name!;
      m.content = content!;
      document.head.appendChild(m);
      return m;
    });
    return () => metas.forEach((m) => m.remove());
  }, []);
}
