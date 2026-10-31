# GitHub招待フォーム

## 構成
- index.html / style.css / app.js … 入力フォーム（ユーザー名 or メール + 合言葉）
- api/invite.js … GitHub APIを呼ぶサーバー側（トークンはここだけが持つ）
- vercel.json … セキュリティヘッダー（CSP等）
- robots.txt … 検索エンジンに載せない

## デプロイ（Vercel）
1. このフォルダをGitHubリポジトリにしてVercelにインポート（または `npx vercel`）
2. Vercel の Environment Variables に登録（**Production のみ**にチェック、可能なら Sensitive にする）

| 名前 | 必須 | 内容 |
|---|---|---|
| GITHUB_TOKEN | ○ | 下記の最小権限トークン |
| GITHUB_ORG | ○ | TECHIS-team-rising |
| FORM_PASSCODE | ○ | 12文字以上のランダムな合言葉（短いと動作しません） |
| ALLOWED_EMAIL_DOMAINS | 任意 | メール招待を許可するドメイン（例: `example.com,example.org`）。ユーザー名での招待には適用されません |
| MAX_INVITES_PER_HOUR | 任意 | 1時間あたりの招待上限（既定 10、インスタンス単位） |

3. 再デプロイしてURLを開く

## トークン（最小権限）
- Classic PAT（admin:org）は使わず、**Fine-grained PAT** か **GitHub App** を使う
- Resource owner を組織にし、Organization permissions の **Members: Read and write** のみ付与
- 有効期限を設定し、定期的にローテーションする
- 個人アカウントに紐づけない運用が望ましい（専用のbotアカウント等）

## 追加で必ず設定してほしいこと
1. **Vercel Firewall のレート制限**: `/api/invite` に対し、例えば同一IPから1分あたり5回までなどのルールを追加（コード内の制限はインスタンス単位の補助にすぎません）
2. **Deployment Protection**: Preview デプロイを保護し、トークンを Preview 環境に入れない
3. **合言葉のローテーション**: 利用者が入れ替わるたびに変更する

## ログについて
- アプリのコードは `console.*` を一切使わず、氏名・メール・ユーザー名・合言葉を保存しません（氏名欄も廃止）
- ただしVercelのプラットフォーム自体が、リクエストのメタデータ（パス・ステータス・時刻など）を記録する場合があります。これはアプリ側では止められません。Log Drains は設定しないでください
- 招待のエラーはクライアントにも詳細を返さないため、「届かない」場合の原因は GitHub の組織設定（People → Pending invitations）で確認してください

## 応答の仕様（情報漏えい対策）
「存在しないユーザー名」「既にメンバー/招待済み」「その他GitHub側の検証エラー(422)」は、成功と同じ応答を返します（ユーザーの存在確認に悪用されないため）。入力ミスでも成功表示になる点にご注意ください。
