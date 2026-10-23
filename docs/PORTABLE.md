# Chromeで直接使うHTMLファイル版

配布ファイルは `release/PDF-Editor.html`。フォント、画面、PDF処理ライブラリ、Worker、CMap、標準フォント、WASM、ライセンス通知を1ファイルに同梱している。

## 使い方

1. HTMLファイルをPCへ保存する。
2. Google Chromeで `Ctrl+O` を押し、保存した `PDF-Editor.html` を選ぶ。
3. 「PDFファイルを選択」で編集したいPDFを開く。
4. PDF上の文字をクリックするか一覧から選び、右の欄で変更する。
5. 置換方式の注意事項を確認し、「変更を適用」を押す。
6. プレビューを確認し、「PDFを保存」でダウンロードする。保存ボタンは入力中の変更も反映する。

利用者によるNode.js等のインストール、ターミナル操作、サーバー起動、ログインは不要。PDFの処理にインターネット接続は不要。

編集機能・資源上限はWeb版と同じ。文字の書き換え、手動の範囲書き換え、文字・画像・図形追加、新規作成、ページ操作・結合を利用できる。元の文字はPDF内に残るため、墨消しには使えない。

## 開発者向けの生成・検証

```sh
npm ci
npm run build:portable
npm run test:portable
```

既存のChromiumを利用する環境では `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:portable`。

`scripts/build-portable.mjs` が本番用ビルドから自己完結したHTMLを生成する。生成結果は約50 MB。日本語フォントの全体埋め込みと、外部リソース参照をなくすための同梱によりサイズが大きい。生成したファイルはGitの管理対象外とし、元コードと生成スクリプトから再生成する。

管理されたクラウドChromiumでは `file:` ナビゲーションがポリシーで禁止されているため、その制限は変更しない。代わりに、通信をオフラインにし、同一オリジン権限・フォーム送信権限を持たないiframeへ完成HTMLを読み込み、PDF表示、金額・日本語の変更、ダウンロード、再読込、HTTP通信0件をテストする。Windows Chromeでのファイル直接起動は別途実機確認が必要。
