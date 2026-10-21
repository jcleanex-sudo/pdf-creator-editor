# GitHub Pagesへの配置

公開対象はテスト済みの `dist/` のみ。入力PDF、ローカルの作業ファイル、環境変数、ソース用Gitメタデータは公開対象に含めない。リポジトリの公開・非公開設定や有料プランの契約は変更しない。

```sh
npm ci
npm run test
npm run build
npm run test:e2e
npm run publish:pages
```

`publish:pages` は独立した一時Gitインデックスを用い、ソースのチェックアウトやインデックスを変更せず、ビルド結果を `gh-pages` ブランチへ通常pushする。force pushは使用しない。既存の `gh-pages` が別の目的で管理されている場合は上書きせず停止する。

初回はGitHubの対象リポジトリの Settings → Pages で、Sourceを「Deploy from a branch」、Branchを「gh-pages」、フォルダーを「/(root)」にして保存する必要がある。Pages利用の可否はリポジトリの可視性と既存プランによる。公開のためにリポジトリを公開へ切り替えたり、有料プランへ変更したりしない。

Pages有効化後は配信URLを確認し、HTTP成功だけでなく、ブラウザからPDF読み込み・変更・保存を検証するまで利用可能とは報告しない。

このクラウド環境からGitHubの公開設定APIや配信サイトを検証するには、`api.github.com` と `jcleanex-sudo.github.io` への通信許可が必要。設定案の保存だけでは実行中の通信制限は変わらない。
