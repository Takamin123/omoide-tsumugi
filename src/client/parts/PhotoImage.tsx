import type { Entrance, Photo } from "../../shared/api";

/** 写真。focus（0〜1 の比率）があれば、その中心が見えるように寄せる */
export function PhotoImage({ photo, focus }: { photo: Photo; focus?: Entrance["focus"] }) {
  const position = focus ? `${(focus.x + focus.w / 2) * 100}% ${(focus.y + focus.h / 2) * 100}%` : undefined;
  return (
    <img
      className="photo"
      src={photo.imageUrl}
      width={photo.width}
      height={photo.height}
      alt=""
      style={position ? { objectPosition: position } : undefined}
    />
  );
}
