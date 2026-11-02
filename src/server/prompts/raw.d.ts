// Vite の ?raw（ファイルの中身を文字列として取り込む）。Workers のビルドにも、vitest にも入る
declare module "*.md?raw" {
  const text: string;
  export default text;
}
