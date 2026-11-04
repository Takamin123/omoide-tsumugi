// マイクの許可を待つ一回ごとの決まり（React に頼らない。useRecorder が使う。0008 の追記）。
// - 待っている間の二度押しは無視する（"busy"）
// - 待っている間にやめたら、すぐ押し直せる。やめた試みが後から決着しても、録音は捨ててマイクを閉じる（"stale"）
//   許可の表示を閉じても決着しないまま残るブラウザ（Firefox）でも、やめた後に押し直せるように

export type MicStartResult<R> = { kind: "started"; rec: R } | { kind: "failed" } | { kind: "stale" } | { kind: "busy" };

export function createMicStart<R extends { cancel: () => void }>(open: () => Promise<R>) {
  /** 今の試みの番号。やめると進め、古い試みの結果を捨てる */
  let attempt = 0;
  let pending = false;
  return {
    /** 許可を待っているか */
    get pending() {
      return pending;
    },
    async start(): Promise<MicStartResult<R>> {
      if (pending) return { kind: "busy" };
      const mine = ++attempt;
      pending = true;
      try {
        const rec = await open();
        if (mine !== attempt) {
          rec.cancel();
          return { kind: "stale" };
        }
        return { kind: "started", rec };
      } catch {
        return mine === attempt ? { kind: "failed" } : { kind: "stale" };
      } finally {
        if (mine === attempt) pending = false;
      }
    },
    /** 待っている間にやめる。待っていなければ何もしない */
    cancel() {
      if (!pending) return;
      attempt++;
      pending = false;
    },
  };
}
