# GitHub招待フォーム

## 構成
- index.html … 入力フォーム
- api/invite.js … GitHub APIを呼ぶサーバー側（トークンはここだけが持つ）

## デプロイ（Vercel）
1. このフォルダをGitHubリポジトリにしてVercelにインポート
   （または `npx vercel` を実行）
2. Vercelの Environment Variables に登録
   - GITHUB_TOKEN  … 組織オーナーのPAT（Classic: admin:org / Fine-grained: 組織のMembers書き込み）
   - GITHUB_ORG    … TECHIS-team-rising
   - FORM_PASSCODE … フォーム利用者に共有する合言葉
3. 再デプロイしてURLを開く
