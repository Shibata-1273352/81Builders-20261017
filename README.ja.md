<p align="center"><img src="docs/images/tsumugi-concept.jpg" alt="TSUMUGI — 文脈を、紡ぐ。祭りの写真を観察し、主張と出典につなぎ、「観察」「文脈」「未解決」として理解する" width="900"></p>

# TSUMUGI — 文脈を、紡ぐ。

[English](README.md) · **日本語**

TSUMUGI（紡ぐ）は、日本が好きな人のための文化のフィールドガイドです。**写真が示していること**と**キャプションが主張していること**を分け、何が確かめられ、何が背景にすぎず、何がまだ決まっていないかを伝えます。

画像を最大4枚とキャプションを入力すると、次の3つの段階で進みます。

1. **見る（See）**：モデルが写っているものを説明し、領域を示します（VLM の枠を SAM3 でマスクに絞ります）。
2. **つなぐ（Connect）**：キャプションの主張を観察と結びつけ、登録した出典と照らし合わせます。
3. **わかる（Understand）**：主張ごとに「確認」「矛盾」「未解決」を、引用した本文とともに示します。証拠を追加・無効化すると説明が変わり、すべての結果を Neo4j の根拠グラフでたどれます。文化の解説は、証拠ではなく背景であることを明示して、結果の隣に並べます。

すべての項目を英語と日本語で表示します（EN・日本語・Both を切り替えられます）。

## ローカルでの起動

Node.js 22 以上、Python 3.9 以上、クレジットのある ai& の API キー、接続できる Neo4j データベースが必要です。

```sh
npm install
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
cp .env.example .env  # 新規インストールの場合のみ。既存の .env は残してください
```

`.env` に ai& と Neo4j の変数を設定します。バックエンドがこのファイルを自動で読み込みます。認証情報を `NEXT_PUBLIC_*` 変数に入れないでください。1つのコマンドで両方のサーバーを起動・停止できます。

```sh
npm run up       # バックエンド + 本番用フロントエンド（開発用オーバーレイなし）。両方が応答するまで待つ
npm run up:dev   # バックエンド + next dev（ホットリロード）
npm run status   # 動作中のものを表示
npm run logs     # .runtime/logs/backend.log と frontend.log を追う
npm run down     # 両方を停止（手動で起動した、このプロジェクトのサーバーも含む）
```

### 任意：ローカルの SAM3 セグメンテーション

SAM3（`facebook/sam3`、Hugging Face で利用申請が必要）は、VLM の候補の枠をピクセル単位のマスクにします。PyTorch を使う Python 3.10 以上が必要なため、バックエンドの `.venv` とは別のローカルプロセスとして動かします。

```sh
uv venv ~/models/sam3/.venv --python 3.12
uv pip install --python ~/models/sam3/.venv/bin/python torch torchvision transformers huggingface_hub pillow
~/models/sam3/.venv/bin/hf download facebook/sam3 --exclude sam3.pt --local-dir ~/models/sam3/facebook-sam3
```

そのうえで、`.env` に `SAM3_PYTHON=~/models/sam3/.venv/bin/python` と `SAM3_MODEL_DIR=~/models/sam3/facebook-sam3`（絶対パス）を設定します。`npm run up` がポート 8010（`SAM3_PORT`）でサイドカーを起動し、モデルの読み込みを待ち、`SAM3_URL` をバックエンドへ渡します。`npm run status` と `npm run down` にも含まれます。これらの変数がない場合や、サイドカーの起動に失敗した場合は、従来どおり VLM の枠のまま動きます。

http://127.0.0.1:3000 を開きます。`BACKEND_PORT` と `FRONTEND_PORT` で、既定のポート 8000 と 3000 を変えられます。`npm run down` が止めるのは、このディレクトリから動いているプロセスだけで、同じポートの別のアプリには触れません。サーバーを別々に起動するときは、2つのターミナルで `npm run backend` と `npm run dev`（または `npm run demo`）を使い、バックエンドが 8000 番でない場合は `TSUMUGI_BACKEND_URL` を設定します。どちらのサーバーもループバックにのみ bind します。バックエンドは1プロセスで使ってください。複数ワーカーのジョブキューや公開用の認証はありません。

## 90秒のデモ

1. **Try an example**（写真2枚とキャプション）を選び、**Explore the context** を押します。観察と主張が、モデル呼び出しの完了ごとに現れます。
2. **Image 1** と **Image 2** を切り替えます。主張を選ぶと、その候補の画像領域がすべての画像で強調され、サムネイルに件数が出ます。
3. **Add evidence → Use the Kyoto tourism excerpt → Add & re-evaluate** を選びます。
4. **What changed** を見ます。7月の祭りの主張に裏付けが付き、2枚の写真の場所と 2026 年という日付は未解決のままです。説明には **Independent check · qwen** が付きます。
5. **Graph** を開き、ノードを選んで隣接するものを見ます。出典の **Disable** にカーソルを合わせると、影響を受けるものが強調されます。無効にすると、その出典による裏付けが外れます。

キャプションは合成したものです。画像1は Ippei Suzuki 氏による CC BY 2.0、画像2は E. G. Stillman 氏による 1905 年のアルバム写真（パブリックドメイン、Harvard 所蔵、Wikimedia Commons 経由）です。クレジットと出典のリンクは画面に表示されます。これらの帰属情報（1905 年の日付を含む）は証拠として送信しません。台紙の手書き文字「GION FESTIVAL IN KIOTO」は、見えている内容としてのみ扱います。出典のデータは、京都市の観光 FAQ の短い抜粋です。

その他の文書：[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)（アーキテクチャ）、[docs/DEMO.md](docs/DEMO.md)（時間配分・話すことの要点・代替手段を含む発表台本）、[docs/TSUMUGI_Design_v1.md](docs/TSUMUGI_Design_v1.md)（実装前の設計案。履歴として残しています）。

## アーキテクチャと挙動

<p align="center"><img src="docs/images/tsumugi-architecture.png" alt="TSUMUGI のシステム構成：ブラウザの UI がローカルの FastAPI バックエンドにつながり、バックエンドが ai& のマルチモデル API、ローカルの SAM3 サイドカー、ローカルの保存先（SQLite とファイル）、Neo4j の根拠グラフを使う" width="900"></p>

詳しい構成は [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) にあります。要点は次のとおりです。

- **モデルは提案し、判定はコードが決める。** 判定は `backend/pipeline.py` の `assess` が、登録された出典の本文だけを使って決めます。モデルが選んだ引用の ID は保存済みの本文に解決できなければならず、場所・時点の不一致、矛盾する証拠、写真そのものに関する主張は、未解決のままです。
- **並行パイプライン**（ai& への同時呼び出しは最大8件、ジョブの期限は75秒）：画像ごとの観察と主張の抽出が同時に始まり、主張が出た時点で出典の照合が始まります。主張ごとに「執筆 → 独立検証（`AIAND_CHECK_MODEL`）」を走らせます。確かめられる主張のないキャプションでも、画像は説明します。
- **画像**は、EXIF の向きを一度だけ反映して正立に保存します。ページ・VLM の枠・SAM3 のマスクが同じピクセルを指すようにするためです。モデルへ送るのは、メタデータを除いて縮めたコピーだけです。SAM3 では、各観察の短いラベルをテキストプロンプトにし、VLM の枠の内側に大半がある例を1つのマスクにまとめます。結果が空なら、より簡単な言葉で聞き直します（それでも空なら `SEG_MISSED`）。マスクを待つのは最大25秒で、ジョブの開始から60秒を超えては待ちません。`Region` には SAM3 の `prompt`、`segmenter`、`mask_score`、`instance_count`、`mask_area` を記録します。
- **文化の解説**：書き手のモデルと独立した確認役（`AIAND_CULTURE_MODEL`、`AIAND_REVIEW_MODELS`）が `CulturalNote` を作り、「合意」「異論あり」「未確認」を付けます。モデルの知識による背景であり、証拠ではなく、判定には一切つながりません。
- **保存**：無視対象の `.runtime/` にある SQLite が、入力・スナップショット・SSE のイベント・冪等性の記録を持ちます。Neo4j は版ごとに（`v2:` のキー、型付きのラベルと関係で）、2つのバッチ文で保存します。失敗したグラフの書き込みは起動時に再送します。失敗した版は直前の検証済みの表示を残し、中断されたジョブは失敗として再試行できます。
- **フロントエンド**：画面は SSE でジョブを追い、前の解析のイベントは無視します。**New analysis** は、結果だけでなく写真とキャプションも消します。
- **未実装**：公開デプロイ、写真の来歴検証、URL の取得（出典は登録したテキストです）。1つのプロセスで同時に動くジョブは1つです。

## 確認

```sh
npm test                  # 決定的な制約・API・グラフのテスト。有料の呼び出しなし
npm run build             # 本番ビルドと TypeScript の確認
.venv/bin/python scripts/check_models.py  # 実モデルによる画像・JSON のプローブと独立検証。クレジットが必要
.venv/bin/python scripts/smoke.py         # 実モデルで 画像2枚 → 追加 → 無効化 → グラフ・影響範囲 → SSE の再生。段階ごとの時間付き
```

実モデルを使うスクリプトは、公開サンプルと合成キャプションを ai& へ送り、版管理されたグラフの記録を、設定した Neo4j に保存します。結果とログはローカルに残ります。`smoke.py [label]` は時間を `.runtime/smoke-timings-<label>.json` に保存します。プローブは、成功した画像モデルの ID を `.env` に保存します。
