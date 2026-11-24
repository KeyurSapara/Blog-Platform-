// CloudBlog single-page frontend (plain JavaScript, no build step).
// Talks to the backend at /api (same CloudFront domain) and to Amazon Cognito for login.

const cfg = window.BLOG_CONFIG;
const $app = document.getElementById("app");
const $nav = document.getElementById("nav");

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDate = (d) => new Date(d).toLocaleString();

// ---------- Auth (Amazon Cognito, USER_PASSWORD_AUTH flow) ----------
const auth = {
  get token() {
    return localStorage.getItem("idToken");
  },
  get user() {
    const t = this.token;
    if (!t) return null;
    try {
      const p = JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      if (p.exp * 1000 < Date.now()) {
        this.logout();
        return null;
      }
      return { id: p.sub, email: p.email };
    } catch {
      return null;
    }
  },
  logout() {
    localStorage.removeItem("idToken");
  },
};

async function cognito(action, body) {
  const res = await fetch(`https://cognito-idp.${cfg.region}.amazonaws.com/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": `AWSCognitoIdentityProviderService.${action}`,
    },
    body: JSON.stringify({ ClientId: cfg.clientId, ...body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.__type || "Authentication error");
  return data;
}

// ---------- API helper ----------
async function api(path, { method = "GET", body, form } = {}) {
  const headers = {};
  if (auth.token) headers.Authorization = `Bearer ${auth.token}`;
  let payload;
  if (form) {
    payload = form;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(cfg.apiBase + path, { method, headers, body: payload });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.data = data;
    throw err;
  }
  return data;
}

// ---------- Views ----------
function renderNav() {
  const u = auth.user;
  $nav.innerHTML = u
    ? `<a href="#/">Home</a><a href="#/new">Write</a><a href="#/profile">${esc(u.email)}</a>
       <button class="link" id="logout">Logout</button>`
    : `<a href="#/">Home</a><a href="#/login">Login</a><a href="#/signup">Sign up</a>`;
  const btn = document.getElementById("logout");
  if (btn) btn.onclick = () => { auth.logout(); location.hash = "#/"; };
}

function showError(el, err) {
  const cats = err.data?.categories?.length ? ` (${err.data.categories.join(", ")})` : "";
  el.innerHTML = `<p class="error">${esc(err.message)}${esc(cats)}</p>`;
}

async function viewHome() {
  const posts = await api("/posts");
  if (!posts.length) {
    $app.innerHTML = `<div class="card"><p>No posts yet. <a href="#/new">Write the first one!</a></p></div>`;
    return;
  }
  $app.innerHTML = posts
    .map(
      (p) => `
      <article class="card">
        ${p.image_url ? `<img src="${esc(p.image_url)}" alt="">` : ""}
        <h2><a href="#/post/${p.id}">${esc(p.title)}</a></h2>
        <div class="meta">by ${esc(p.author_name)} · ${fmtDate(p.created_at)}</div>
        <p>${esc(p.excerpt)}${p.excerpt.length >= 300 ? "…" : ""}</p>
      </article>`
    )
    .join("");
}

const SNS_CONFIRM_HINT =
  "Check your inbox for an email from <b>AWS Notifications</b> and click <b>Confirm subscription</b> to start getting new-post alerts.";

// "Subscribe to author" box: SNS emails the reader whenever this author publishes.
async function renderSubscribe(el, post) {
  const u = auth.user;
  const [{ subscribers }, mine] = await Promise.all([
    api(`/subscriptions/authors/${encodeURIComponent(post.author_id)}`),
    u && u.id !== post.author_id ? api("/subscriptions") : null,
  ]);
  const count = `${subscribers} subscriber${subscribers === 1 ? "" : "s"}`;
  if (!mine) {
    el.innerHTML = `<span class="muted">${count}${u ? "" : ` · <a href="#/login">Log in</a> to subscribe`}</span>`;
    return;
  }
  const subscribed = mine.subscriptions.some((s) => s.author_id === post.author_id);
  el.innerHTML = `
    <button id="subscribe" class="${subscribed ? "secondary" : ""}">
      ${subscribed ? "✓ Subscribed" : `Subscribe to ${esc(post.author_name)}`}
    </button>
    <span class="muted">${count}</span>
    <div id="subscribe-msg"></div>`;
  document.getElementById("subscribe").onclick = async (e) => {
    e.target.disabled = true;
    try {
      if (subscribed) {
        await api(`/subscriptions/${encodeURIComponent(post.author_id)}`, { method: "DELETE" });
        await renderSubscribe(el, post);
      } else {
        const r = await api("/subscriptions", { method: "POST", body: { authorId: post.author_id } });
        await renderSubscribe(el, post);
        if (r.notificationsEnabled && !r.emailConfirmed) {
          document.getElementById("subscribe-msg").innerHTML = `<p class="success">Subscribed! ${SNS_CONFIRM_HINT}</p>`;
        }
      }
    } catch (err) {
      showError(document.getElementById("subscribe-msg"), err);
      e.target.disabled = false;
    }
  };
}

async function viewPost(id) {
  const [post, comments] = await Promise.all([api(`/posts/${id}`), api(`/comments?postId=${id}`)]);
  const u = auth.user;
  $app.innerHTML = `
    <article class="card">
      ${post.image_url ? `<img class="post-image" src="${esc(post.image_url)}" alt="">` : ""}
      <h1>${esc(post.title)}</h1>
      <div class="meta">by ${esc(post.author_name)} · ${fmtDate(post.created_at)}</div>
      <div id="subscribe-box" class="subscribe-box"></div>
      <div class="content">${esc(post.content)}</div>
      ${u && u.id === post.author_id ? `<p><button class="danger" id="delete">Delete post</button></p>` : ""}
    </article>
    <section class="card">
      <h3>Comments (${comments.length})</h3>
      <div>${
        comments
          .map(
            (c) => `<div class="comment"><div class="meta">${esc(c.author_name)} · ${fmtDate(c.created_at)}</div>
                    <div class="content">${esc(c.body)}</div></div>`
          )
          .join("") || `<p class="muted">No comments yet.</p>`
      }</div>
      ${
        u
          ? `<form id="comment-form">
               <label for="body">Add a comment <span class="muted">(checked by Azure AI Content Safety)</span></label>
               <textarea id="body" required maxlength="2000" style="min-height:90px"></textarea>
               <div id="comment-msg"></div>
               <button type="submit">Post comment</button>
             </form>`
          : `<p class="muted"><a href="#/login">Log in</a> to comment.</p>`
      }
    </section>`;

  renderSubscribe(document.getElementById("subscribe-box"), post).catch((err) =>
    showError(document.getElementById("subscribe-box"), err)
  );

  const del = document.getElementById("delete");
  if (del) {
    del.onclick = async () => {
      if (!confirm("Delete this post?")) return;
      await api(`/posts/${id}`, { method: "DELETE" });
      location.hash = "#/";
    };
  }
  const form = document.getElementById("comment-form");
  if (form) {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const btn = form.querySelector("button");
      btn.disabled = true;
      try {
        await api("/comments", { method: "POST", body: { postId: Number(id), body: form.body.value } });
        route();
      } catch (err) {
        showError(document.getElementById("comment-msg"), err);
        btn.disabled = false;
      }
    };
  }
}

function viewNew() {
  if (!auth.user) return (location.hash = "#/login");
  $app.innerHTML = `
    <div class="card">
      <h1>Write a post</h1>
      <form id="post-form">
        <label for="title">Title</label>
        <input id="title" required maxlength="200">
        <label for="image">Cover image (optional, stored in Azure Blob Storage, max 5 MB)</label>
        <input id="image" type="file" accept="image/jpeg,image/png,image/gif,image/webp">
        <label for="content">Content</label>
        <textarea id="content" required></textarea>
        <div id="msg"></div>
        <button type="submit">Publish</button>
      </form>
    </div>`;
  const form = document.getElementById("post-form");
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = form.querySelector("button");
    btn.disabled = true;
    try {
      let imageUrl;
      const file = form.image.files[0];
      if (file) {
        const fd = new FormData();
        fd.append("image", file);
        imageUrl = (await api("/media", { method: "POST", form: fd })).url;
      }
      const { id } = await api("/posts", {
        method: "POST",
        body: { title: form.title.value, content: form.content.value, imageUrl },
      });
      location.hash = `#/post/${id}`;
    } catch (err) {
      showError(document.getElementById("msg"), err);
      btn.disabled = false;
    }
  };
}

function authForm({ title, fields, submitLabel, footer, onSubmit }) {
  $app.innerHTML = `
    <div class="card" style="max-width:420px;margin:auto">
      <h1>${title}</h1>
      <form id="auth-form">
        ${fields
          .map((f) => `<label for="${f.id}">${f.label}</label>
                       <input id="${f.id}" type="${f.type || "text"}" value="${esc(f.value || "")}" required>`)
          .join("")}
        <div id="msg"></div>
        <button type="submit">${submitLabel}</button>
      </form>
      ${footer ? `<p class="muted">${footer}</p>` : ""}
    </div>`;
  const form = document.getElementById("auth-form");
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = form.querySelector("button");
    btn.disabled = true;
    try {
      await onSubmit(form);
    } catch (err) {
      showError(document.getElementById("msg"), err);
      btn.disabled = false;
    }
  };
}

function viewLogin() {
  authForm({
    title: "Log in",
    fields: [
      { id: "email", label: "Email", type: "email" },
      { id: "password", label: "Password", type: "password" },
    ],
    submitLabel: "Log in",
    footer: `No account? <a href="#/signup">Sign up</a> · Need to verify? <a href="#/confirm">Enter code</a>`,
    onSubmit: async (form) => {
      const r = await cognito("InitiateAuth", {
        AuthFlow: "USER_PASSWORD_AUTH",
        AuthParameters: { USERNAME: form.email.value, PASSWORD: form.password.value },
      });
      localStorage.setItem("idToken", r.AuthenticationResult.IdToken);
      await api("/users/me"); // creates the profile row on first login
      location.hash = "#/";
    },
  });
}

function viewSignup() {
  authForm({
    title: "Sign up",
    fields: [
      { id: "email", label: "Email", type: "email" },
      { id: "password", label: "Password (min 8 chars, upper, lower, number)", type: "password" },
    ],
    submitLabel: "Create account",
    footer: `Already have an account? <a href="#/login">Log in</a>`,
    onSubmit: async (form) => {
      await cognito("SignUp", {
        Username: form.email.value,
        Password: form.password.value,
        UserAttributes: [{ Name: "email", Value: form.email.value }],
      });
      sessionStorage.setItem("pendingEmail", form.email.value);
      location.hash = "#/confirm";
    },
  });
}

function viewConfirm() {
  authForm({
    title: "Verify email",
    fields: [
      { id: "email", label: "Email", type: "email", value: sessionStorage.getItem("pendingEmail") },
      { id: "code", label: "Verification code (sent to your email)" },
    ],
    submitLabel: "Verify",
    onSubmit: async (form) => {
      await cognito("ConfirmSignUp", { Username: form.email.value, ConfirmationCode: form.code.value.trim() });
      location.hash = "#/login";
    },
  });
}

async function viewProfile() {
  if (!auth.user) return (location.hash = "#/login");
  const [me, subs] = await Promise.all([api("/users/me"), api("/subscriptions")]);
  $app.innerHTML = `
    <div class="card">
      <h1>My profile</h1>
      <p class="muted">${esc(me.email)} · member since ${fmtDate(me.created_at)}</p>
      <form id="profile-form">
        <label for="displayName">Display name</label>
        <input id="displayName" maxlength="100" value="${esc(me.display_name || "")}">
        <label for="bio">Bio</label>
        <textarea id="bio" maxlength="1000" style="min-height:90px">${esc(me.bio || "")}</textarea>
        <div id="msg"></div>
        <button type="submit">Save</button>
      </form>
    </div>
    <div class="card">
      <h2>My subscriptions</h2>
      ${
        subs.subscriptions.length && subs.notificationsEnabled
          ? subs.emailConfirmed
            ? `<p class="success">Email alerts are active for ${esc(me.email)} (Amazon SNS).</p>`
            : `<p class="error">Email alerts are not confirmed yet. ${SNS_CONFIRM_HINT}</p>`
          : ""
      }
      ${
        subs.subscriptions
          .map(
            (s) => `<div class="comment subscription">
                      <span><b>${esc(s.author_name || "Unknown author")}</b>
                        <span class="muted">· since ${fmtDate(s.created_at)}</span></span>
                      <button class="link" data-author="${esc(s.author_id)}">Unsubscribe</button>
                    </div>`
          )
          .join("") || `<p class="muted">You are not subscribed to any authors yet. Open a post and click Subscribe.</p>`
      }
    </div>`;
  $app.querySelectorAll("button[data-author]").forEach((btn) => {
    btn.onclick = async () => {
      btn.disabled = true;
      await api(`/subscriptions/${encodeURIComponent(btn.dataset.author)}`, { method: "DELETE" });
      route();
    };
  });
  const form = document.getElementById("profile-form");
  form.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api("/users/me", { method: "PUT", body: { displayName: form.displayName.value, bio: form.bio.value } });
      document.getElementById("msg").innerHTML = `<p class="success">Saved.</p>`;
    } catch (err) {
      showError(document.getElementById("msg"), err);
    }
  };
}

// ---------- Router ----------
async function route() {
  renderNav();
  const hash = location.hash.replace(/^#/, "") || "/";
  const postMatch = hash.match(/^\/post\/(\d+)$/);
  try {
    if (postMatch) await viewPost(postMatch[1]);
    else if (hash === "/new") viewNew();
    else if (hash === "/login") viewLogin();
    else if (hash === "/signup") viewSignup();
    else if (hash === "/confirm") viewConfirm();
    else if (hash === "/profile") await viewProfile();
    else await viewHome();
  } catch (err) {
    $app.innerHTML = `<p class="error">${esc(err.message)}</p>`;
  }
}

window.addEventListener("hashchange", route);
route();
