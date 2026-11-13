/* ==========================================================================
   编辑台 · 外壳
   — 登录门 / 文章列表 / 元信息 / 装修与源码两种模式 / 发布
   ========================================================================== */
(function () {
  "use strict";

  var LS_TOKEN = "site.admin.token";
  var LS_DRAFT = "site.admin.body.";

  var state = {
    token: "",
    posts: [],
    current: null,
    mode: "design",
    md: "",
    mdDirty: false,
    body: "",
    busy: false
  };

  var el = {};
  var timer = null;

  function $(s) { return document.querySelector(s); }

  function status(text, kind) {
    if (!el.status) return;
    el.status.textContent = text;
    el.status.dataset.kind = kind || "";
    clearTimeout(timer);
    if (kind === "ok") timer = setTimeout(function () { status("就绪"); }, 3200);
  }

  function esc(s) { return Core.esc(s); }

  /* ---------------------------- 登录 ---------------------------- */

  function login(token) {
    Core.setToken(token);
    return Core.gh("/repos/Azazelsanx/site").then(function (repo) {
      if (repo.permissions && repo.permissions.push === false) {
        throw new Error("这枚 token 只有读权限，需要 Contents: Read and write");
      }
      state.token = token;
      localStorage.setItem(LS_TOKEN, token);
      return true;
    });
  }

  function bindGate() {
    var form = $("#gate-form");
    var err = $("#gate-error");
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var v = $("#token").value.trim();
      if (!v) return;
      var btn = $("#gate-submit");
      btn.disabled = true;
      btn.textContent = "验证中…";
      err.hidden = true;
      login(v).then(function () {
        enter();
      }).catch(function (ex) {
        err.hidden = false;
        err.textContent = ex.message;
        btn.disabled = false;
        btn.textContent = "进入";
      });
    });
  }

  function enter() {
    $("#gate").hidden = true;
    $("#app").hidden = false;
    document.body.classList.add("is-in");
    loadPosts().then(function () {
      if (state.posts.length) openPost(state.posts[0].slug);
      else newPost();
    }).catch(function (ex) {
      status("读取清单失败：" + ex.message, "err");
    });
  }

  /* ---------------------------- 列表 ---------------------------- */

  function loadPosts() {
    return Core.getFile("_content/index.json").then(function (f) {
      var data = JSON.parse(f.text);
      state.posts = Core.sortPosts(data.posts || []);
      paintRail();
      return state.posts;
    });
  }

  function paintRail() {
    if (!el.rail) return;
    el.rail.innerHTML = state.posts.map(function (p) {
      var on = state.current && state.current.slug === p.slug ? " is-on" : "";
      return '<li><button class="rail__item' + on + '" data-slug="' + esc(p.slug) + '">' +
        '<b>' + esc(p.title || p.slug) + "</b>" +
        "<span>" + esc((p.iso || "").slice(0, 7).replace("-", ".")) + "</span>" +
        "</button></li>";
    }).join("");
    el.count.textContent = state.posts.length + " 篇";
  }

  /* ---------------------------- 打开 ---------------------------- */

  function openPost(slug) {
    var meta = state.posts.filter(function (p) { return p.slug === slug; })[0] ||
      { slug: slug, title: slug, iso: "", desc: "", flag: "" };
    state.current = { slug: slug, isNew: false };
    state.mdDirty = false;
    paintRail();
    status("读取正文…");
    el.live.hidden = false;
    el.live.href = "/articles/" + slug;

    readBody(slug).then(function (res) {
      state.md = res.md || "";
      state.body = res.body || "";

      var draft = readDraft(slug);
      if (draft) {
        state.body = draft.body || state.body;
        state.md = draft.md || state.md;
        status("已恢复本机草稿", "ok");
      }

      setMeta({
        title: meta.title, iso: meta.iso || Core.todayISO(),
        slug: slug, desc: meta.desc, flag: meta.flag, locked: true
      });
      mountCanvas();
      if (!draft) status("已载入", "ok");
    }).catch(function (ex) {
      status("正文读取失败：" + ex.message, "err");
    });
  }

  function readBody(slug) {
    return Core.getFileOrNull("_content/" + slug + ".html").then(function (hf) {
      if (hf && hf.text.trim()) return { body: hf.text, md: "" };
      return Core.getFileOrNull("_content/" + slug + ".md").then(function (mf) {
        if (mf) return { md: mf.text, body: Core.mdToHtml(mf.text) };
        return Core.getFile("articles/" + slug + ".html").then(function (af) {
          var doc = new DOMParser().parseFromString(af.text, "text/html");
          var prose = doc.querySelector(".prose");
          if (!prose) return { md: "", body: "" };
          var header = prose.querySelector("header");
          if (header) header.remove();
          var md = Core.htmlToMd(prose.innerHTML);
          return { md: md, body: Core.mdToHtml(md) };
        });
      });
    });
  }

  function newPost() {
    state.current = { slug: null, isNew: true };
    state.md = "";
    state.body = "";
    state.mdDirty = false;
    paintRail();
    el.live.hidden = true;
    setMeta({ title: "", iso: Core.todayISO(), slug: "", desc: "", flag: "", locked: false });
    mountCanvas();
    status("新文章：先填标题和 slug，再装修正文");
    el.title.focus();
  }

  /* ---------------------------- 元信息 ---------------------------- */

  function setMeta(p) {
    el.title.value = p.title || "";
    el.date.value = p.iso || Core.todayISO();
    el.slug.value = p.slug || "";
    el.desc.value = p.desc || "";
    el.flag.value = p.flag || "";
    el.slug.readOnly = !!p.locked;
    el.docTitle.textContent = p.title || (p.slug ? p.slug : "新文章");
  }

  function meta() {
    return {
      title: el.title.value.trim(),
      iso: el.date.value,
      slug: el.slug.value.trim(),
      desc: el.desc.value.trim(),
      flag: el.flag.value.trim()
    };
  }

  function bindMeta() {
    el.title.addEventListener("input", function () {
      el.docTitle.textContent = el.title.value || "无标题";
      if (Builder && Builder.setHeader) Builder.setHeader(el.title.value, Core.cnDate(el.date.value));
      scheduleDraft();
    });
    el.date.addEventListener("change", function () {
      if (Builder && Builder.setHeader) Builder.setHeader(el.title.value, Core.cnDate(el.date.value));
    });
    el.desc.addEventListener("input", scheduleDraft);
    el.flag.addEventListener("input", scheduleDraft);
    el.slug.addEventListener("input", function () {
      el.slug.value = el.slug.value.toLowerCase().replace(/[^a-z0-9-]/g, "-");
    });
  }

  /* ---------------------------- 画布 ---------------------------- */

  function mountCanvas() {
    var m = meta();
    Builder.resetHistory(state.body || "");
    Builder.mount({
      title: m.title, date: Core.cnDate(m.iso), iso: m.iso, body: state.body
    });
    Builder.onCommit(function (body) {
      state.body = body;
      scheduleDraft();
    });
    showMode("design");
  }

  function showMode(mode) {
    state.mode = mode;
    document.body.dataset.mode = mode;
    Array.prototype.forEach.call(document.querySelectorAll("[data-mode]"), function (b) {
      if (b.tagName !== "BODY") b.classList.toggle("on", b.dataset.mode === mode);
    });
    if (mode === "code") {
      /* 源码始终由画布当前内容反解，避免拿到旧的 md */
      el.code.value = Core.htmlToMd(Builder.body());
      state.md = el.code.value;
      state.mdDirty = false;
      status("源码模式：改完切回装修会重排正文");
    }
  }

  /* ---------------------------- 草稿 ---------------------------- */

  function draftKey() {
    return LS_DRAFT + ((state.current && state.current.slug) || el.slug.value.trim() || "__new__");
  }

  function readDraft(slug) {
    try {
      var raw = localStorage.getItem(LS_DRAFT + slug);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  var draftLazy = null;

  function scheduleDraft() {
    clearTimeout(draftLazy);
    el.saved.textContent = "改动未存…";
    draftLazy = setTimeout(function () {
      try {
        localStorage.setItem(draftKey(), JSON.stringify({
          body: state.body, md: state.md, meta: meta(), ts: Date.now()
        }));
        el.saved.textContent = "本机已存 · " + new Date().toLocaleTimeString("zh-CN");
      } catch (e) {
        el.saved.textContent = "本机存不下";
      }
    }, 900);
  }

  /* ---------------------------- 发布 ---------------------------- */

  function currentBody() {
    /* 只有真在源码里改过才重新编译，否则一律用画布的 DOM，装修样式不丢 */
    if (state.mode === "code" && state.mdDirty) return Core.mdToHtml(el.code.value);
    return Builder.body();
  }

  function publish() {
    if (state.busy) return;
    var m = meta();
    if (!m.title) return status("标题还没填", "err");
    if (!m.iso) return status("日期还没选", "err");
    if (!m.slug) return status("slug 还没填（网址里那一段）", "err");
    if (!/^[a-z0-9][a-z0-9-]*$/.test(m.slug)) return status("slug 只能小写字母、数字、短横线", "err");

    var body = currentBody();
    if (!body.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, "").trim()) {
      return status("正文还是空的", "err");
    }
    if (state.current && state.current.isNew &&
        state.posts.some(function (p) { return p.slug === m.slug; })) {
      return status("这个 slug 已经有一篇了，换一个", "err");
    }

    state.busy = true;
    el.publish.disabled = true;
    status("打包中…");

    var page = Core.renderPage({
      title: m.title, desc: m.desc, date: Core.cnDate(m.iso), iso: m.iso, body: body
    });

    var nextPosts = state.posts.filter(function (p) { return p.slug !== m.slug; });
    nextPosts.push({ slug: m.slug, title: m.title, iso: m.iso, desc: m.desc, flag: m.flag });
    nextPosts = Core.sortPosts(nextPosts);

    var changes = [
      { path: "_content/" + m.slug + ".html", content: body + "\n" },
      { path: "articles/" + m.slug + ".html", content: page },
      { path: "_content/index.json", content: JSON.stringify({ posts: nextPosts }, null, 2) + "\n" }
    ];

    if (state.mdDirty || !state.md) {
      var md = "";
      try { md = state.mode === "code" ? el.code.value : Core.htmlToMd(body); } catch (e) { md = ""; }
      if (md && md.trim()) changes.push({ path: "_content/" + m.slug + ".md", content: md + "\n" });
    }

    Core.getFile("index.html").then(function (f) {
      var html = f.text;
      if (!Core.POSTS_RE.test(html)) throw new Error("index.html 里没有 posts 标记");
      changes.push({ path: "index.html", content: html.replace(Core.POSTS_RE, Core.renderPostList(nextPosts)) });
      status("提交到 GitHub…");
      return Core.commitFiles(changes, "发布：" + m.title);
    }).then(function () {
      state.posts = nextPosts;
      state.current = { slug: m.slug, isNew: false };
      state.mdDirty = false;
      paintRail();
      el.live.hidden = false;
      el.live.href = "/articles/" + m.slug;
      el.slug.readOnly = true;
      localStorage.removeItem(draftKey());
      status("已发布 · 一分钟左右上线", "ok");
      el.saved.textContent = "已发布";
    }).catch(function (ex) {
      status("发布失败：" + ex.message, "err");
    }).then(function () {
      state.busy = false;
      el.publish.disabled = false;
    });
  }

  function removePost() {
    if (!state.current || !state.current.slug) return status("新文章还没发过，删掉就没了", "err");
    var slug = state.current.slug;
    var title = el.title.value || slug;
    if (!confirm("删掉《" + title + "》？\n会从仓库里移除正文与页面，首页列表同步更新。")) return;

    var nextPosts = state.posts.filter(function (p) { return p.slug !== slug; });
    status("删除中…");
    Core.getFile("index.html").then(function (f) {
      var html = f.text.replace(Core.POSTS_RE, Core.renderPostList(nextPosts));
      return Core.commitFiles([
        { path: "articles/" + slug + ".html", content: null },
        { path: "_content/" + slug + ".html", content: null },
        { path: "_content/" + slug + ".md", content: null },
        { path: "_content/index.json", content: JSON.stringify({ posts: nextPosts }, null, 2) + "\n" },
        { path: "index.html", content: html }
      ], "删除：" + title);
    }).then(function () {
      state.posts = nextPosts;
      state.current = null;
      localStorage.removeItem(LS_DRAFT + slug);
      paintRail();
      status("已删除", "ok");
      if (nextPosts.length) openPost(nextPosts[0].slug); else newPost();
    }).catch(function (ex) {
      status("删除失败：" + ex.message, "err");
    });
  }

  /* ---------------------------- 绑定 ---------------------------- */

  function bind() {
    el = {
      gate: $("#gate"), rail: $("#rail-list"), count: $("#rail-count"),
      title: $("#f-title"), date: $("#f-date"), slug: $("#f-slug"),
      desc: $("#f-desc"), flag: $("#f-flag"), docTitle: $("#doc-title"),
      code: $("#f-md"), status: $("#status"), saved: $("#saved"),
      live: $("#open-live"), publish: $("#publish"), line: $("#status-line")
    };

    bindGate();
    bindMeta();

    el.rail.addEventListener("click", function (e) {
      var b = e.target.closest("[data-slug]");
      if (!b) return;
      if (b.dataset.slug === (state.current && state.current.slug)) return;
      openPost(b.dataset.slug);
    });

    $("#new-post").addEventListener("click", newPost);
    el.publish.addEventListener("click", publish);
    $("#delete").addEventListener("click", removePost);

    Array.prototype.forEach.call(document.querySelectorAll(".mode-btn"), function (b) {
      b.addEventListener("click", function () {
        if (state.mode === b.dataset.mode) return;
        if (b.dataset.mode === "design" && state.mdDirty) {
          state.body = Core.mdToHtml(el.code.value);
          state.mdDirty = false;
          mountCanvas();
        }
        showMode(b.dataset.mode);
      });
    });

    el.code.addEventListener("input", function () {
      state.mdDirty = true;
      status("源码改了 · 切回装修生效");
    });

    document.querySelector("#undo").addEventListener("click", function () { Builder.undo(); });
    document.querySelector("#redo").addEventListener("click", function () { Builder.redo(); });

    Array.prototype.forEach.call(document.querySelectorAll("[data-dev]"), function (b) {
      b.addEventListener("click", function () { Builder.setDevice(b.dataset.dev); });
    });

    $("#logout").addEventListener("click", function () {
      localStorage.removeItem(LS_TOKEN);
      location.reload();
    });

    document.addEventListener("keydown", function (e) {
      var meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      if (e.key.toLowerCase() === "s") {
        e.preventDefault();
        scheduleDraft();
        status("已存本机草稿", "ok");
      }
      if (e.key.toLowerCase() === "z" && state.mode === "design") {
        e.preventDefault();
        e.shiftKey ? Builder.redo() : Builder.undo();
      }
      if (e.key.toLowerCase() === "enter" && e.altKey) {
        e.preventDefault();
        publish();
      }
    });
  }

  window.App = { status: status, publish: publish, open: openPost };

  document.addEventListener("DOMContentLoaded", function () {
    bind();
    var saved = localStorage.getItem(LS_TOKEN);
    if (saved) {
      Core.setToken(saved);
      enter();
    } else {
      $("#gate").hidden = false;
    }
  });
})();
