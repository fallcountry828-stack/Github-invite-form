// Vercel Serverless Function: POST /api/invite
// 環境変数: GITHUB_TOKEN, GITHUB_ORG, FORM_PASSCODE

const GH = "https://api.github.com";

async function gh(path, options = {}) {
  return fetch(GH + path, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "invite-form",
      ...(options.headers || {}),
    },
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POSTのみ対応しています" });
  }

  const { username, fullName, email, passcode } = req.body || {};

  // 合言葉チェック（誰でも招待できてしまうのを防ぐ）
  if (!process.env.FORM_PASSCODE || passcode !== process.env.FORM_PASSCODE) {
    return res.status(401).json({ error: "合言葉が違います" });
  }

  const org = process.env.GITHUB_ORG;
  const cleanUser = (username || "").trim().replace(/^@/, "");
  const cleanEmail = (email || "").trim();

  if (!cleanUser && !cleanEmail) {
    return res.status(400).json({ error: "ユーザー名かメールアドレスを入力してください" });
  }
  if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return res.status(400).json({ error: "メールアドレスの形式が正しくありません" });
  }
  if (cleanUser && !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(cleanUser)) {
    return res.status(400).json({ error: "GitHubユーザー名の形式が正しくありません" });
  }

  // ユーザー名があれば、IDを引いてそのアカウントを直接招待する。
  // 見つからなければメールアドレスで招待する。
  const body = { role: "direct_member" };
  if (cleanUser) {
    const u = await gh(`/users/${cleanUser}`);
    if (u.ok) {
      body.invitee_id = (await u.json()).id;
    } else if (!cleanEmail) {
      return res.status(404).json({ error: `ユーザー ${cleanUser} が見つかりません` });
    }
  }
  if (!body.invitee_id) body.email = cleanEmail;

  const r = await gh(`/orgs/${org}/invitations`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));

  if (!r.ok) {
    const detail = data.errors?.[0]?.message || data.message || "招待に失敗しました";
    return res.status(r.status).json({ error: detail });
  }

  // 誰を招待したかのログ（Vercelのログで確認できる）
  console.log("invited", { fullName, username: cleanUser, email: cleanEmail });

  return res.status(200).json({
    ok: true,
    message: `${fullName || cleanUser || cleanEmail} さんに招待を送りました`,
  });
}
