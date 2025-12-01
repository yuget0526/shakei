# 写経.exe (PDF → Java Source Extractor)

PDF 教材から実際の `.java` ファイルを復元する Web アプリケーションです。
PDF をアップロードすると、ページごとに Java クラスを抽出し、パッケージ構成 (`package` 宣言) に基づいてディレクトリ構造を自動生成します。

## 主な機能

### 1. スマートなコード抽出

- **パッケージ自動検出**: ソースコード内の `package` 宣言を解析し、正しいフォルダ階層 (`src/local/hal/...` など) を自動で構築します。
- **プレビュー機能**: ダウンロード前に、抽出されたファイルの中身をブラウザ上で確認できます。
- **1 ページ目スキップ**: 表紙などを自動的に除外します。

### 2. 認証・招待システム

- **完全招待制**: 招待コードを持つユーザーのみがアカウント登録可能です。
- **管理者機能**: 管理者 (`admin`) は招待コードの発行や管理が可能です。
- **セキュリティ**: パスワードは bcrypt でハッシュ化され、JWT によるセッション管理を行っています。

### 3. クラウドネイティブ

- **Google Cloud Run**: フロントエンド・バックエンド共にサーバーレスで動作。
- **Cloud SQL**: ユーザー情報や招待コードは PostgreSQL で管理。
- **CI/CD**: GitHub Actions により、`main` ブランチへのプッシュで自動デプロイされます。

---

## 技術スタック

- **Frontend**: Next.js (App Router), TypeScript, Tailwind CSS
- **Backend**: FastAPI (Python), SQLModel, Pypdfium2
- **Database**: PostgreSQL (Cloud SQL), SQLite (開発用)
- **Infrastructure**: Google Cloud Run, Artifact Registry
- **DevOps**: Docker, GitHub Actions

---

## ローカル開発セットアップ

### 前提条件

- Docker Desktop がインストールされていること

### 起動方法

```bash
# 1. リポジトリをクローン
git clone https://github.com/yuget0526/shakei.git
cd shakei

# 2. コンテナをビルド＆起動
docker compose up --build
```

- **Frontend**: http://localhost:3000
- **Backend**: http://localhost:8000
- **Admin**: http://localhost:8000/docs (API ドキュメント)

### 初期アカウント

- **ユーザー名**: `admin`
- **パスワード**: `admin` (開発環境デフォルト)

---

## デプロイ (Google Cloud Run)

本番環境は Google Cloud Run (`asia-northeast1` 東京リージョン) で稼働しています。

### 自動デプロイ

GitHub Actions が設定されており、`main` ブランチにプッシュすると自動的にデプロイされます。

### 手動デプロイ手順 (参考)

詳細は [docs/cloud_run_deployment.md](docs/cloud_run_deployment.md) を参照してください。

### 独自ドメイン

- **URL**: `https://shakei.gigaptera.com`
- **DNS**: Cloudflare で管理し、Cloud Run のカスタムドメインマッピング機能を使用しています。

---

## ディレクトリ構成

```
.
├── backend/              # FastAPI アプリケーション
│   ├── app/
│   │   ├── main.py       # エントリーポイント
│   │   ├── auth.py       # 認証ロジック
│   │   ├── models.py     # DBモデル
│   │   └── pdf_extractor.py # 抽出ロジック
│   └── Dockerfile
├── frontend/             # Next.js アプリケーション
│   ├── src/app/          # App Router ページ
│   └── Dockerfile
├── .github/workflows/    # CI/CD 設定
└── docs/                 # ドキュメント (デプロイ手順、ハマりポイント集など)
```
