"use strict";
// GitHub組織への招待API（Vercel Serverless Function）
// 方針: ログは一切出力しない / クライアントから受け取るのは username・email・passcode のみ
// ロールはサーバー側で direct_member に固定 / エラー詳細はクライアントに返さない

const crypto = require("node:crypto");

const GH = "https://api.github.com";
const USERNAME_RE = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

const MAX_BODY_CHARS = 2000;
const MIN_PASSCODE_LEN = 12;

// --- レート制限（インスタンス内メモリのみ・永続化しない。補助的な防御） ---
// ※サーバーレスではインスタンスごとに状態が分かれるため、
//   Vercel Firewall のレート制限ルールと併用してください（README参照）。
const FAIL_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 5;
const MAX_INVITES_PER_HOUR = Number(process.env.MAX_INVITES_PER_HOUR) || 10;
const fails = new Map(); // ipハッシュ -> { count, resetAt }
let sentTimes = [];

function ipKey(req) {
  const raw =
    req.headers["x-vercel-forwarded-for"] ||
    req.headers["x-forwarded-for"] ||
    "unknown";
  const ip = String(raw).split(",")[0].trim();
  return crypto.createHash("sha256").update(ip).digest("hex").slice(0, 16);
}

function isLocked(key, now) {
  const e = fails.get(key);
  if (!e) return false;
  if (e.resetAt <= now) {
    fails.delete(key);
    return false;
  }
  return e.count >= MAX_FAILS;
}

function recordFail(key, now) {
  if (fails.size > 1000) {
    for (const [k, v] of fails) if (v.resetAt <= now) fails.delete(k);
  }
  const e = fails.get(key);
  if (!e || e.resetAt <= now) fails.set(key, { count: 1, resetAt: now + FAIL_WINDOW_MS });
  else e.count += 1;
}

// --- 定数時間比較（長さの違いも漏らさないようハッシュ化してから比較） ---
function safeEqual(a, b) {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

const str = (v) => (typeof v === "string" ? v.trim() : "");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  const reply = (status, body) => res.status(status).json(body);
  const failGeneric = (ghStatus) =>
    reply(502, {
      error:
        "現在処理できません。しばらくしてからもう一度お試しください。" +
        (ghStatus ? `（GitHub応答: ${ghStatus}）` : ""),
    });
  const accepted = () =>
    reply(200, {
      message:
        "招待リクエストを受け付けました。GitHubからの招待メールをご確認ください。届かない場合は入力内容をご確認のうえ、管理者へご連絡ください。",
    });

  try {
    // メソッド制限
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return reply(405, { error: "許可されていないメソッドです" });
    }

    // 同一オリジン確認（CORSヘッダーは一切付与しない）
    const origin = req.headers.origin;
    if (origin) {
      let ok = false;
      try {
        ok = new URL(origin).host === req.headers.host;
      } catch (_) {
        ok = false;
      }
      if (!ok) return reply(403, { error: "リクエストを受け付けられません" });
    }

    if (!String(req.headers["content-type"] || "").toLowerCase().includes("application/json")) {
      return reply(415, { error: "リクエスト形式が正しくありません" });
    }

    // 設定の確認（未設定・弱い合言葉の場合は処理しない＝フェイルクローズ）
    const token = process.env.GITHUB_TOKEN;
    const org = process.env.GITHUB_ORG;
    const passcode = process.env.FORM_PASSCODE;
    if (!token || !org || !passcode || passcode.length < MIN_PASSCODE_LEN) {
      return reply(500, { error: "サーバーの設定に問題があります。管理者へご連絡ください。" });
    }

    const now = Date.now();
    const key = ipKey(req);
    if (isLocked(key, now)) {
      return reply(429, { error: "試行回数が多すぎます。しばらくしてからお試しください。" });
    }

    // ボディ取得（受け取る項目は3つだけ。それ以外は無視）
    const body = req.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return reply(400, { error: "入力内容が正しくありません" });
    }
    if (JSON.stringify(body).length > MAX_BODY_CHARS) {
      return reply(413, { error: "入力が大きすぎます" });
    }
    const username = str(body.username);
    const email = str(body.email);
    const given = str(body.passcode);

    // 合言葉
    if (!given || !safeEqual(given, passcode)) {
      recordFail(key, now);
      return reply(401, { error: "合言葉が正しくありません" });
    }
    fails.delete(key);

    // 入力検証
    if (!username && !email) {
      return reply(400, { error: "GitHubユーザー名かメールアドレスのどちらか一方を入力してください" });
    }
    if (username && email) {
      return reply(400, { error: "GitHubユーザー名とメールアドレスは、どちらか一方のみ入力してください" });
    }
    if (username && !USERNAME_RE.test(username)) {
      return reply(400, { error: "GitHubユーザー名の形式が正しくありません" });
    }
    if (email) {
      if (email.length > 254 || !EMAIL_RE.test(email)) {
        return reply(400, { error: "メールアドレスの形式が正しくありません" });
      }
      const allowed = (process.env.ALLOWED_EMAIL_DOMAINS || "")
        .split(",")
        .map((d) => d.trim().toLowerCase())
        .filter(Boolean);
      if (allowed.length && !allowed.includes(email.split("@")[1].toLowerCase())) {
        return reply(400, { error: "このメールアドレスのドメインは招待できません" });
      }
    }

    // 招待数の上限（乱用対策）
    sentTimes = sentTimes.filter((t) => now - t < 60 * 60 * 1000);
    if (sentTimes.length >= MAX_INVITES_PER_HOUR) {
      return reply(429, { error: "現在、招待の受付が混み合っています。しばらくしてからお試しください。" });
    }

    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "org-invite-form",
      "Content-Type": "application/json",
    };
    const opts = (extra) => ({
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(8000),
      ...extra,
    });

    // ロールはサーバー側で固定
    const payload = { role: "direct_member" };

    if (username) {
      const u = await fetch(`${GH}/users/${encodeURIComponent(username)}`, opts());
      if (u.status === 404) {
        return reply(404, { error: "そのGitHubユーザー名は見つかりません。綴りをご確認ください。" });
      }
      if (!u.ok) return failGeneric(u.status);
      const user = await u.json();
      if (user.type !== "User" || !Number.isInteger(user.id)) {
        return reply(400, { error: "個人ユーザーのGitHubユーザー名を入力してください。" });
      }
      payload.invitee_id = user.id;
    } else {
      payload.email = email;
    }

    sentTimes.push(now);
    const r = await fetch(
      `${GH}/orgs/${encodeURIComponent(org)}/invitations`,
      opts({ method: "POST", body: JSON.stringify(payload) })
    );
    if (r.status === 201) return accepted();
    if (r.status === 422) {
      // 失敗理由を利用者（合言葉を知っている人）に分かる形で返す。サーバーには何も残さない
      let j = {};
      try {
        j = await r.json();
      } catch (_) {}
      const detail = String(
        (j.errors && j.errors[0] && j.errors[0].message) || j.message || ""
      ).slice(0, 150);
      const text = JSON.stringify(j).toLowerCase();
      if (text.includes("already") && (text.includes("part of") || text.includes("member"))) {
        return reply(409, { error: "すでにこの組織のメンバーです。" });
      }
      if (text.includes("already") && (text.includes("invit") || text.includes("pending"))) {
        return reply(409, {
          error: "すでに招待済みです。GitHubからの招待メール、または https://github.com/orgs/" +
            encodeURIComponent(org) + "/invitation をご確認ください。",
        });
      }
      if (text.includes("spam") || text.includes("too many") || text.includes("rate")) {
        return reply(429, { error: "GitHub側の招待上限に達した可能性があります。時間をおいてお試しください。" });
      }
      return reply(422, {
        error: "GitHubが招待を受け付けませんでした。管理者へご連絡ください。" +
          (detail ? `（詳細: ${detail}）` : "（422）"),
      });
    }
    return failGeneric(r.status);
  } catch (_) {
    // ログは残さない。詳細は返さない
    return failGeneric();
  }
};
