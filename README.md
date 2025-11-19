# PDF → Java Source Extractor

PDF から実際の `.java` ファイルを復元する Web アプリです。PDF を 1 つアップロードすると、FastAPI 製バックエンドがページごとに Java クラスを抽出し、Next.js フロントエンドが ZIP として一括ダウンロードできるようにします。

## 技術スタック

- **Backend**: FastAPI + pypdfium2（pdfplumber フォールバック）でテキスト抽出、zipfile でアーカイブ化
- **Frontend**: Next.js（App Router, TypeScript）+ Tailwind CSS。ドラッグ&ドロップ対応のアップローダー UI
- **Tests/Lint**: Pytest（抽出ヘルパー）、ESLint（UI）

## ディレクトリ構成

```
backend/
  app/
    main.py           # FastAPI エントリーポイント
    pdf_extractor.py  # PDF → Java 変換ロジック
  requirements.txt
  tests/
    test_pdf_extractor.py
frontend/
  src/app/page.tsx    # アップロード画面
  src/app/globals.css # Tailwind グローバルスタイル
  .env.local.example  # バックエンド URL テンプレート
README.md
```

## 前提条件

- Python 3.10 以上（開発時は 3.13）
- Node.js 18 以上 + npm

## Backend セットアップ

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

サーバーは `http://localhost:8000` で待ち受け、以下のエンドポイントを提供します:

- `GET /health` → 動作確認用
- `POST /extract` → `multipart/form-data` の `pdf` フィールドを受け取り、`java_sources.zip` を返却

## Frontend セットアップ

```bash
cd frontend
cp .env.local.example .env.local   # 必要ならバックエンド URL を変更
npm install
npm run dev
```

既定では `NEXT_PUBLIC_API_BASE_URL` が `http://localhost:8000` を指します。バックエンドを別ホストで動かす場合は `.env.local` を調整してください。

## テスト / Lint

```bash
# Backend
cd backend
pytest

# Frontend
cd frontend
npm run lint
```

## Docker で動かす

両サービスの本番想定コンテナを同梱しています。

```bash
docker compose build

```

- Backend → http://localhost:8000
- Frontend → http://localhost:3000 （内部ホスト `http://backend:8000` 経由でバックエンドに接続）

別の API エンドポイントでフロントエンドをビルドしたい場合は、`--build-arg NEXT_PUBLIC_API_BASE_URL=<url>` を付けるか `docker-compose.yml` を編集してください。

## 抽出ロジックの概要

1. `pypdfium2` で各ページのテキストを抽出（例外時は `pdfplumber` にフォールバック）。
2. `pdf_extractor.extract_sources_from_pages` がヘッダーから `Animal.java` といったファイル名を検出し、重複時はユニーク名に付け替え。
3. `package` / `import` / クラス定義のいずれかが登場した地点をコードブロックの開始と見なし、それ以降をそのまま保持。
4. 生成したソースを `zipfile` でまとめ、ストリーミングレスポンスとして返却。

## 今後のアイデア

- `/extract` からメタデータを返し、ダウンロード前に生成予定ファイル名をプレビューする。
- 過去のアップロードを保存したり、クラウドストレージ連携で履歴を残す。
- PDF のレイアウト（フォントサイズや座標）を使ったヒューリスティクスで構造がバラつく教材にも強くする。
