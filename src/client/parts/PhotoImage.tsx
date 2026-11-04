import type { Entrance, Photo } from "../../shared/api";

/** 写真。focus（0〜1 の比率）があれば、その中心が見えるように寄せる */
/** lazy: 画面に近づいてから読む（一覧の小さい写真。0053） */
export function PhotoImage({ photo, focus, lazy }: { photo: Photo; focus?: Entrance["focus"]; lazy?: boolean }) {
  const position = focus ? `${(focus.x + focus.w / 2) * 100}% ${(focus.y + focus.h / 2) * 100}%` : undefined;
  return (
    <img
      className="photo"
      src={photo.imageUrl}
      width={photo.width}
      height={photo.height}
      alt=""
      loading={lazy ? "lazy" : undefined}
      style={position ? { objectPosition: position } : undefined}
    />
  );
}
