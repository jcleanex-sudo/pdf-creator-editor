# ライセンス確認

直接・推移依存の製品コードを `scripts/prepare-assets.mjs` で走査し、インストールされたバージョンのライセンス宣言・本文を `public/THIRD_PARTY_NOTICES.txt` に収録する。アプリから閲覧可能。PDF.jsの CMap・標準フォント・WASM に含まれる個別ライセンスファイルもそのまま配信する。

| 主な依存 | ライセンス | 商用利用 |
| --- | --- | --- |
| React / React DOM | MIT | 可。著作権・許諾表示を保持 |
| Vite / TypeScript | MIT / Apache-2.0 | 可。開発・ビルド用途 |
| PDF.js (`pdfjs-dist`) | Apache-2.0 | 可。ライセンス・該当する通知を保持 |
| pdf-lib / @pdf-lib/fontkit | MIT | 可。著作権・許諾表示を保持 |
| Lucide | ISC（同梱の派生アイコン通知も保持） | 可。著作権・許諾表示を保持 |
| pako | MIT AND Zlib | 可。著作権・許諾表示を保持 |
| tslib | 0BSD | 可 |
| Noto Sans JP / Noto Serif JP | SIL OFL 1.1 | 可。フォント単体販売不可、同梱・埋め込み可 |

## 日本語フォント

公式配布元：https://github.com/google/fonts/tree/main/ofl/notosansjp

Copyright 2014-2021 Adobe (http://www.adobe.com/), with Reserved Font Name 'Source'.

同梱の TrueType フォントは公式可変フォントから FontTools 4.61.1 で wght=400（Regular）と700（Bold）の静的インスタンスを生成したもの。Boldの名称情報は実際の太さに合わせて設定する。Reserved Font Name 'Source' は使用していない。OFL本文は `public/fonts/OFL.txt` に同梱。生成元のSHA-256は `scripts/prepare-font.py` で固定し、検証を省略しない。通常の `npm ci` / ビルドでフォント生成やネットワーク取得は不要。

Noto Serif JP公式配布元：https://github.com/google/fonts/tree/main/ofl/notoserifjp

Copyright 2012 Google Inc. All Rights Reserved. SIL OFL 1.1本文は `public/fonts/OFL-Serif.txt` に同梱する。商用利用・同梱・埋め込み可能で、フォント単体販売は不可。公式可変フォントからFontTools 4.61.1でwght=400/700の静的インスタンスを生成し、名称をRegular/Boldに設定する。生成は `scripts/prepare-serif-font.py`。元ファイルSHA-256は `2fd527ba12b6a44ec30d796d633360da0aeba6c5d4af1304ce12bb4dc15a7dfc`、生成したRegularは `c1cd2256b3ab4906c99bf75d14c5dbc6f15bf86ce0b249884a6e180119546895`、Boldは `25453296219ff2d44215ec5c851e00b136593704ad100f70cff5e9b90c97da2a`。通常ビルドでは取得・再生成しない。

元PDFのフォント名に基づいて標準のHelvetica／Times／Courier系列を選べる場合は、pdf-libが提供する標準フォントと文字幅情報を利用する。未知の埋め込みフォントプログラムを抽出して再配布する処理は追加しない。入力された文字が標準フォントにない場合は、上記の同梱日本語フォントへ切り替える。

この版はフォント全体を埋め込む。fontkitの日本語サブセット生成では文字の欠落が再現したため使用しない。保存時にはファイルサイズが数MB増加する。出力PDFそのものにOFLを適用する義務はない（OFL本文参照）。

## 公開前の確認

上記は採用バージョンのライセンス宣言に基づく商用利用条件の確認。公開する製品の利用規約、商標、入力PDFの著作権は別途確認する。プロジェクト独自コードの公開ライセンスは利用者がまだ指定していないため、MIT等を勝手に付与していない。
