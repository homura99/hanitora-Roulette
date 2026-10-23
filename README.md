# Cloudflare Pages ルーレット

項目ごとに音声を割り当てて、ブラウザー内で抽選・再生する静的Webアプリです。バックエンドやビルド工程は不要で、Cloudflare Pagesにそのまま配置できます。

## ファイル構成

- `index.html`：ページ構造
- `css/styles.css`：画面スタイル
- `js/app.js`：項目管理、抽選、音声再生

## Cloudflare Pagesへのデプロイ

1. GitHubにこのリポジトリをプッシュします。
2. Cloudflareのダッシュボードで **Workers & Pages → Create application → Pages → Connect to Git** を選び、リポジトリを接続します。
3. ビルド設定を次のようにします。
   - Framework preset：`None`
   - Build command：空欄
   - Build output directory：`.`（リポジトリのルート）
4. デプロイ後に発行された`pages.dev`のURLを開き、項目の追加と抽選を確認します。

HTMLからCSSとJavaScriptは相対パスで読み込まれます。デプロイ時には`index.html`、`css/`、`js/`を同じ構成のまま配置してください。アプリの実行にCloudflare Pages Functions、Worker、環境変数の設定は不要です。

## 使い方と制約

1. 項目名を追加し、必要であれば音声ファイルを割り当てます。音声は個別に追加するか、最大5ファイルを一括で選択・ドロップできます。
2. 項目を2件以上登録して「ルーレットを回す」を押すと、抽選後に当選項目へ割り当てた音声を再生します。
3. 音声形式はMP3、WAV、OGG、M4A、AAC、WebM、FLACです。再生可否はブラウザーや端末の対応状況によります。
4. 項目は最大20件です。

抽選、項目、音声ファイルはブラウザー内で扱います。音声をサーバーやGoogle Driveへ送信せず、抽選結果も記録しません。項目と割り当てた音声はページを再読み込みすると消え、他のブラウザーや利用者とは共有されません。

## ローカル確認

リポジトリのルートでローカルHTTPサーバーを起動して`index.html`を開きます。例えばPythonがインストールされている場合：

```text
python -m http.server 8000
```

ブラウザーで`http://localhost:8000`を開いて動作を確認してください。
