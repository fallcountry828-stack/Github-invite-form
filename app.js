(() => {
  const f = document.getElementById("f");
  const btn = document.getElementById("btn");
  const msg = document.getElementById("msg");

  const show = (cls, text) => {
    msg.className = cls;
    msg.textContent = text;
  };

  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = f.username.value.trim();
    const email = f.email.value.trim();
    const passcode = f.passcode.value;

    if (!username && !email) {
      show("err", "GitHubユーザー名かメールアドレスのどちらか一方を入力してください");
      return;
    }
    if (username && email) {
      show("err", "GitHubユーザー名とメールアドレスは、どちらか一方のみ入力してください");
      return;
    }
    if (!passcode) {
      show("err", "合言葉を入力してください");
      return;
    }

    btn.disabled = true;
    show("", "");
    try {
      const res = await fetch("/api/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        referrerPolicy: "no-referrer",
        body: JSON.stringify({ username, email, passcode }),
      });
      let data = {};
      try {
        data = await res.json();
      } catch (_) {}
      if (!res.ok) throw new Error(data.error || "送信に失敗しました");
      show("ok", data.message || "招待リクエストを受け付けました。");
      f.reset();
    } catch (err) {
      show("err", err.message || "送信に失敗しました");
    } finally {
      btn.disabled = false;
    }
  });
})();
