/* ==========================================================================
   编辑台 · 无服务器，直接写 GitHub 仓库
   —— 认证：fine-grained PAT（只存本机 localStorage）
   —— 发布：Git Data API 打一个原子提交（blob → tree → commit → ref）
   —— 正文：轻标记（==高亮==、((圈))、[[方框]]、{{句|旁批}}），编译成站点 HTML
   ========================================================================== */
(function () {
  "use strict";

  var OWNER = "Azazelsanx";
  var REPO = "site";
  var BRANCH = "main";
  var API = "https://api.github.com";

  var LS_TOKEN = "site.admin.token";
  var LS_DRAFT = "site.admin.draft.";

  var state = {
    token: "",
    posts: [],      /* [{slug,title,iso,desc,flag}] 从新到旧 */
    current: null,  /* {slug, isNew} */
    dirty: false
  };

  /* ---------------- dom ---------------- */

  function $(sel) { return document.querySelector(sel); }

  var el = {
    gate: $("#gate"),
    gateForm: $("#gate-form"),
    gateInput: $("#token"),
    gateBtn: $("#gate-submit"),
    gateError: $("#gate-error"),
    app: $("#app"),
    railList: $("#rail-list"),
    railCount: $("#rail-count"),
    paneTitle: $("#pane-title"),
    newPost: $("#new-post"),
    logout: $("#logout"),
    openLive: $("#open-live"),
    fTitle: $("#f-title"),
    fDate: $("#f-date"),
    fSlug: $("#f-slug"),
    fDesc: $("#f-desc"),
    fFlag: $("#f-flag"),
    fMd: $("#f-md"),
    toolbar: $("#toolbar"),
    status: $("#status"),
    count: $("#count"),
    saveDraft: $("#save-draft"),
    deleteBtn: $("#delete"),
    publish: $("#publish"),
    pv: $("#pv"),
    live: $("#live"),
    refresh: $("#refresh")
  };

  /* ---------------- 小工具 ---------------- */

  var encoder = new TextEncoder();
  var decoder = new TextDecoder();

  function b64encode(str) {
    var bytes = encoder.encode(str);
    var bin = "";
    var CHUNK = 0x8000;
    for (var i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(bin);
  }

  function b64decode(b64) {
    var bin = atob(String(b64).replace(/\s+/g, ""));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return decoder.decode(bytes);
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function todayISO() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  function cnDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
    if (!m) return iso || "";
    return m[1] + " 年 " + (+m[2]) + " 月 " + (+m[3]) + " 日";
  }

  function debounce(fn, ms) {
    var t;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }

  var statusTimer;
  function setStatus(text, kind) {
    el.status.textContent = text;
    el.status.className = kind ? "status--" + kind : "";
    clearTimeout(statusTimer);
    if (kind === "ok") {
      statusTimer = setTimeout(function () { setStatus("就绪"); }, 4000);
    }
  }

  /* ---------------- GitHub ---------------- */

  function gh(path, opts) {
    opts = opts || {};
    var init = {
      method: opts.method || "GET",
      headers: {
        Authorization: "Bearer " + state.token,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28"
      },
      cache: "no-store"
    };
    if (opts.body) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(opts.body);
    }
    return fetch(API + path, init).then(function (res) {
      if (res.status === 404) {
        var e404 = new Error("NOT_FOUND");
        e404.status = 404;
        throw e404;
      }
      if (!res.ok) {
        return res.text().then(function (txt) {
          var msg = "";
          try { msg = JSON.parse(txt).message || ""; } catch (e) { msg = txt.slice(0, 160); }
          var err = new Error(res.status + " " + msg);
          err.status = res.status;
          throw err;
        });
      }
      if (res.status === 204) return null;
      return res.json();
    });
  }

  function repoPath(p) {
    return "/repos/" + OWNER + "/" + REPO + "/contents/" + p;
  }

  function getFile(path) {
    return gh(repoPath(encodeURI(path)) + "?ref=" + BRANCH).then(function (data) {
      return { text: b64decode(data.content), sha: data.sha };
    });
  }

  function getFileOrNull(path) {
    return getFile(path).catch(function (err) {
      if (err.status === 404) return null;
      throw err;
    });
  }

  /* 一个提交里原子地写/删多个文件 */
  function commitFiles(changes, message) {
    var head, baseTree;
    return gh("/repos/" + OWNER + "/" + REPO + "/git/ref/heads/" + BRANCH)
      .then(function (ref) {
        head = ref.object.sha;
        return gh("/repos/" + OWNER + "/" + REPO + "/git/commits/" + head);
      })
      .then(function (commit) {
        baseTree = commit.tree.sha;
        return changes.reduce(function (chain, change) {
          return chain.then(function (entries) {
            if (change.content === null) {
              entries.push({ path: change.path, mode: "100644", type: "blob", sha: null });
              return entries;
            }
            return gh("/repos/" + OWNER + "/" + REPO + "/git/blobs", {
              method: "POST",
              body: { content: b64encode(change.content), encoding: "utf-8" }
            }).then(function (blob) {
              entries.push({ path: change.path, mode: "100644", type: "blob", sha: blob.sha });
              return entries;
            });
          });
        }, Promise.resolve([]));
      })
      .then(function (tree) {
        return gh("/repos/" + OWNER + "/" + REPO + "/git/trees", {
          method: "POST",
          body: { base_tree: baseTree, tree: tree }
        });
      })
      .then(function (newTree) {
        return gh("/repos/" + OWNER + "/" + REPO + "/git/commits", {
          method: "POST",
          body: { message: message, tree: newTree.sha, parents: [head] }
        });
      })
      .then(function (newCommit) {
        return gh("/repos/" + OWNER + "/" + REPO + "/git/refs/heads/" + BRANCH, {
          method: "PATCH",
          body: { sha: newCommit.sha, force: false }
        });
      });
  }

  /* ---------------- 轻标记 → 站点 HTML ---------------- */

  var CJK = /[\u2e80-\u9fff\u3000-\u303f\uff00-\uffef]/;

  function slugify(text) {
    return String(text)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}_]+/gu, "-")
      .replace(/^-+|-+$/g, "");
  }

  function joinLines(lines) {
    var out = lines.length ? lines[0] : "";
    for (var i = 1; i < lines.length; i++) {
      var a = out.slice(-1);
      var b = lines[i].charAt(0);
      out += (CJK.test(a) || CJK.test(b) ? "" : " ") + lines[i];
    }
    return out;
  }

  var TOKEN = "\u0000";

  /* 把一段轻标记解析成 HTML；notes 收集本条里的页边批注 */
  function inline(text, notes) {
    var stash = [];

    /* 1. 行内代码先摘出来，别让里面的符号被当成标记 */
    var s = String(text).replace(/`([^`]+)`/g, function (m, code) {
      stash.push({ type: "code", value: code });
      return TOKEN + "S" + (stash.length - 1) + TOKEN;
    });

    /* 2. {{句子|旁批}} 也先摘出来（里面是原文，不能先转义） */
    s = s.replace(/\{\{([^{}|]+)\|([^{}]+)\}\}/g, function (m, anchor, note) {
      stash.push({ type: "note", anchor: anchor, note: note });
      return TOKEN + "S" + (stash.length - 1) + TOKEN;
    });

    /* 3. 转义，之后只剩我们自己认识的符号 */
    s = esc(s);

    /* 4. 行内标记 */
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
    s = s.replace(/==([^=]+)==/g, "<mark>$1</mark>");
    s = s.replace(/\(\(([^()]+)\)\)/g, '<span class="circled">$1</span>');
    s = s.replace(/\[\[([^\[\]]+)\]\]/g, '<span class="boxed">$1</span>');
    s = s.replace(/\[([^\[\]]+)\]\(([^)\s]+)\)/g, function (m, label, href) {
      return '<a class="link" href="' + href.replace(/"/g, "%22") + '">' + label + "</a>";
    });

    /* 5. 把摘出来的东西放回去 */
    s = s.replace(new RegExp(TOKEN + "S(\\d+)" + TOKEN, "g"), function (m, idx) {
      var item = stash[+idx];
      if (!item) return "";
      if (item.type === "code") return "<code>" + esc(item.value) + "</code>";
      var key = "n" + (notes.length + 1);
      notes.push({ key: key, anchor: item.anchor, note: item.note });
      return '<span class="note-anchor" data-note="' + key +
        '" aria-describedby="note-' + key + '">' + inline(item.anchor, notes) + "</span>";
    });

    return s;
  }

  function mdToHtml(md) {
    var lines = String(md).replace(/\r\n?/g, "\n").split("\n");
    var out = [];
    var i = 0;

    function isBlank(line) { return /^\s*$/.test(line); }

    while (i < lines.length) {
      var line = lines[i];

      if (isBlank(line)) { i++; continue; }

      /* 代码块 */
      if (/^\s*```/.test(line)) {
        var buf = [];
        i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]);
        i++;
        out.push("    <pre><code>" + esc(buf.join("\n")) + "</code></pre>");
        continue;
      }

      /* 小标题：一级 → h2，其余 → h3 */
      var h = /^(#{1,3})\s+(.*)$/.exec(line);
      if (h) {
        var level = h[1].length === 1 ? 2 : 3;
        var headText = h[2].trim();
        out.push("    <" + "h" + level + ' id="' + esc(slugify(headText.replace(/[*=(){}\[\]`]/g, ""))) +
          '">' + inline(headText, []) + "</h" + level + ">");
        i++;
        continue;
      }

      /* 列表 */
      if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
        var ordered = /^\s*\d+\./.test(line);
        var items = [];
        while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
          items.push(inline(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ""), []));
          i++;
        }
        var tag = ordered ? "ol" : "ul";
        out.push("    <" + tag + ">\n" + items.map(function (t) {
          return "      <li>" + t + "</li>";
        }).join("\n") + "\n    </" + tag + ">");
        continue;
      }

      /* 引用 */
      if (/^>\s?/.test(line)) {
        var quote = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) {
          quote.push(lines[i++].replace(/^>\s?/, ""));
        }
        out.push("    <blockquote>\n      <p>" + inline(joinLines(quote), []) +
          "</p>\n    </blockquote>");
        continue;
      }

      /* 段落 */
      var para = [];
      while (i < lines.length && !isBlank(lines[i]) &&
        !/^(#{1,3})\s|^\s*```|^\s*([-*]|\d+\.)\s|^>\s?/.test(lines[i])) {
        para.push(lines[i].trim());
        i++;
      }
      var notes = [];
      var html = inline(joinLines(para), notes);
      if (notes.length) {
        out.push('    <div class="noted">\n      <p>' + html + "</p>\n" +
          notes.map(function (n) {
            return '      <aside class="side-note" id="note-' + n.key +
              '" data-note-for="' + n.key + '" role="note" tabindex="0">\n' +
              '        <span class="side-note__bracket" aria-hidden="true"></span>\n' +
              '        <span class="side-note__text">' + inline(n.note, []) + "</span>\n" +
              "      </aside>";
          }).join("\n") + "\n    </div>");
      } else {
        out.push("    <p>" + html + "</p>");
      }
    }

    return out.join("\n\n");
  }

  /* ---------------- 站点 HTML → 轻标记（为老文章反解） ---------------- */

  function tidy(s) {
    return s
      .replace(/[ \t]+/g, " ")
      .replace(/([\u2e80-\u9fff\u3000-\u303f\uff00-\uffef]) /g, "$1")
      .replace(/ ([\u2e80-\u9fff\u3000-\u303f\uff00-\uffef])/g, "$1")
      .trim();
  }

  function textAppend(out, raw) {
    var t = String(raw).replace(/\s+/g, " ");
    if (!t.trim()) return out + (out && !/ $/.test(out) ? " " : "");
    return out + t;
  }

  function inlineToMd(node, notes) {
    var out = "";
    Array.prototype.forEach.call(node.childNodes, function (n) {
      if (n.nodeType === 3) {
        out = textAppend(out, n.nodeValue);
        return;
      }
      if (n.nodeType !== 1) return;
      var tag = n.tagName.toLowerCase();
      var cls = n.className || "";
      var inner = function () { return inlineToMd(n, notes); };

      if (tag === "strong" || tag === "b") out += "**" + inner() + "**";
      else if (tag === "em" || tag === "i") out += "*" + inner() + "*";
      else if (tag === "code") out += "`" + n.textContent + "`";
      else if (tag === "mark") out += "==" + inner() + "==";
      else if (tag === "a") out += "[" + inner() + "](" + (n.getAttribute("href") || "") + ")";
      else if (tag === "br") out += "\n";
      else if (tag === "span" && /\bcircled\b/.test(cls)) out += "((" + inner() + "))";
      else if (tag === "span" && /\bboxed\b/.test(cls)) out += "[[" + inner() + "]]";
      else if (tag === "span" && /\bnote-anchor\b/.test(cls)) {
        var key = n.getAttribute("data-note");
        out += "{{" + inner() + "|" + (notes[key] || "") + "}}";
      } else out += inner();
    });
    return tidy(out);
  }

  function blockToMd(node) {
    var tag = node.tagName.toLowerCase();
    var cls = node.className || "";

    if (tag === "p") return inlineToMd(node, {});
    if (tag === "h1") return null;
    if (tag === "h2") return "# " + inlineToMd(node, {});
    if (tag === "h3") return "## " + inlineToMd(node, {});
    if (tag === "ul" || tag === "ol") {
      var k = 0;
      return Array.prototype.map.call(node.children, function (li) {
        k++;
        return (tag === "ol" ? k + ". " : "- ") + inlineToMd(li, {});
      }).join("\n");
    }
    if (tag === "blockquote") {
      return Array.prototype.map.call(node.querySelectorAll("p"), function (p) {
        return "> " + inlineToMd(p, {});
      }).join("\n");
    }
    if (tag === "pre") {
      var code = node.querySelector("code") || node;
      return "```\n" + code.textContent.replace(/\n+$/, "") + "\n```";
    }
    if (tag === "hr") return null;
    if (tag === "div" && /\bnoted\b/.test(cls)) {
      var map = {};
      Array.prototype.forEach.call(node.querySelectorAll(".side-note"), function (aside) {
        var key = aside.getAttribute("data-note-for");
        var txt = aside.querySelector(".side-note__text");
        if (key) map[key] = txt ? tidy(txt.textContent) : "";
      });
      var p = node.querySelector("p");
      return p ? inlineToMd(p, map) : "";
    }
    return tidy(node.textContent || "") || null;
  }

  function htmlToMd(fragmentHtml) {
    var doc = new DOMParser().parseFromString(
      '<div id="__root">' + fragmentHtml + "</div>", "text/html");
    var root = doc.getElementById("__root");
    var out = [];
    Array.prototype.forEach.call(root.children, function (node) {
      var md = blockToMd(node);
      if (md) out.push(md);
    });
    return out.join("\n\n");
  }

  /* ---------------- 页面模板（与 _build/articles.py 一致） ---------------- */

  function renderPage(p) {
    return '<!DOCTYPE html>\n' +
'<html lang="zh-CN">\n' +
'<head>\n' +
'<meta charset="utf-8">\n' +
'<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
'<title>' + esc(p.title) + ' — Azazel</title>\n' +
'<meta name="description" content="' + esc(p.desc) + '">\n' +
'<meta name="color-scheme" content="light">\n' +
'<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\'%3E%3Crect width=\'24\' height=\'24\' rx=\'5\' fill=\'%23fdfdfc\'/%3E%3Cpath d=\'M13.4 3 5.6 13.2h5L10.1 21l7.9-10.6h-5.2L13.4 3Z\' fill=\'%23111\'/%3E%3C/svg%3E">\n' +
'<link rel="stylesheet" href="/styles.css">\n' +
'</head>\n' +
'<body>\n' +
'\n' +
'<main class="shell">\n' +
'\n' +
'  <a class="back" href="/">&larr; Azazel</a>\n' +
'\n' +
'  <article class="prose">\n' +
'\n' +
'    <header>\n' +
'      <h1>' + esc(p.title) + '</h1>\n' +
'      <time datetime="' + esc(p.iso) + '">' + esc(p.date) + '</time>\n' +
'    </header>\n' +
'\n' +
p.body + '\n' +
'\n' +
'  </article>\n' +
'\n' +
'  <footer class="site-footer">\n' +
'    <div class="site-footer__inner">\n' +
'      <div class="site-footer__row">\n' +
'        <p><a href="/">&larr; 回到首页</a></p>\n' +
'        <a class="mark" href="https://github.com/Azazelsanx" target="_blank" rel="noopener noreferrer" aria-label="GitHub">\n' +
'          <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">\n' +
'            <path d="M13.4 2 5.2 13.4h5.1L9.6 22 18.8 10.5h-5.3L13.4 2Z"/>\n' +
'          </svg>\n' +
'        </a>\n' +
'      </div>\n' +
'    </div>\n' +
'  </footer>\n' +
'\n' +
'</main>\n' +
'\n' +
'<script>\n' +
'  // 跳到 #某处 时闪一块黄，五秒内褪掉。\n' +
'  (function () {\n' +
'    function highlight() {\n' +
'      var id = decodeURIComponent(location.hash.slice(1));\n' +
'      Array.prototype.forEach.call(\n' +
'        document.querySelectorAll(".target"),\n' +
'        function (n) { n.classList.remove("target"); }\n' +
'      );\n' +
'      if (!id) return;\n' +
'      var target = document.getElementById(id);\n' +
'      if (!target) return;\n' +
'      void target.offsetWidth;\n' +
'      target.classList.add("target");\n' +
'      setTimeout(function () { target.classList.remove("target"); }, 5000);\n' +
'    }\n' +
'    highlight();\n' +
'    window.addEventListener("hashchange", highlight);\n' +
'  })();\n' +
'</script>\n' +
'\n' +
'<script src="/assets/vendor/rough-notation.js"></script>\n' +
'<script src="/assets/js/marginalia.js"></script>\n' +
'\n' +
'</body>\n' +
'</html>\n';
  }

  /* ---------------- 首页列表 ---------------- */

  var POSTS_RE = /<!-- posts:start[\s\S]*?<!-- posts:end -->/;

  function renderPostList(posts) {
    var groups = [], byYear = {};
    posts.forEach(function (p) {
      var y = (p.iso || "").slice(0, 4) || "—";
      if (!byYear[y]) { byYear[y] = []; groups.push(y); }
      byYear[y].push(p);
    });

    var out = "<!-- posts:start · 这一段由 /admin 后台重写，手改请保持结构 -->\n";
    groups.forEach(function (y) {
      out += "      <li>\n        <ul>\n";
      byYear[y].forEach(function (p) {
        var parts = (p.iso || "---- -- --").split("-");
        var flag = p.flag ? '<span class="flag">' + esc(p.flag) + "</span>" : "";
        out += "          <li>\n" +
          '            <a class="post" href="/articles/' + esc(p.slug) + '">\n' +
          "              <h2>" + esc(p.title) + flag + "</h2>\n" +
          '              <time datetime="' + esc(p.iso) + '"><span>' + parts[2] + "/" + parts[1] +
          "</span><span>/</span><span>" + parts[0] + "</span></time>\n" +
          "            </a>\n" +
          "          </li>\n";
      });
      out += "        </ul>\n      </li>\n";
    });
    out += "      <!-- posts:end -->";
    return out;
  }

  function sortPosts(posts) {
    return posts.slice().sort(function (a, b) {
      return String(b.iso || "").localeCompare(String(a.iso || ""));
    });
  }

  /* ---------------- 列表与加载 ---------------- */

  function paintRail() {
    el.railCount.textContent = state.posts.length ? state.posts.length + " 篇" : "";
    el.railList.innerHTML = "";
    state.posts.forEach(function (p) {
      var li = document.createElement("li");
      var btn = document.createElement("button");
      btn.className = "rail__item" + (state.current && state.current.slug === p.slug ? " is-active" : "");
      btn.innerHTML = "<strong>" + esc(p.title || p.slug) + "</strong><time>" +
        esc(p.iso || "") + "</time>";
      btn.addEventListener("click", function () { openPost(p.slug); });
      li.appendChild(btn);
      el.railList.appendChild(li);
    });
  }

  function loadPosts() {
    setStatus("读取仓库…");
    return getFileOrNull("_content/index.json")
      .then(function (file) {
        var manifest = { posts: [] };
        if (file) {
          try { manifest = JSON.parse(file.text); } catch (e) { manifest = { posts: [] }; }
        }
        if (!manifest.posts) manifest.posts = [];

        return gh(repoPath("articles") + "?ref=" + BRANCH).then(function (items) {
          var files = items.filter(function (it) {
            return it.type === "file" && /\.html$/.test(it.name);
          }).map(function (it) { return it.name.replace(/\.html$/, ""); });

          var known = {};
          manifest.posts.forEach(function (p) { known[p.slug] = true; });

          /* 仓库里有、清单里没有的 → 补读一次元信息 */
          var missing = files.filter(function (slug) { return !known[slug]; });
          return Promise.all(missing.map(function (slug) {
            return getFile("articles/" + slug + ".html").then(function (f) {
              return metaFromHtml(slug, f.text);
            }).catch(function () { return null; });
          })).then(function (extra) {
            var list = manifest.posts.filter(function (p) {
              return files.indexOf(p.slug) !== -1;
            });
            extra.forEach(function (p) { if (p) list.push(p); });
            state.posts = sortPosts(list);
            paintRail();
            setStatus("已连接 " + OWNER + "/" + REPO, "ok");
          });
        });
      })
      .catch(function (err) {
        setStatus("读取失败：" + err.message, "err");
        throw err;
      });
  }

  function metaFromHtml(slug, html) {
    var doc = new DOMParser().parseFromString(html, "text/html");
    var h1 = doc.querySelector("h1");
    var time = doc.querySelector("time[datetime]");
    var desc = doc.querySelector('meta[name="description"]');
    return {
      slug: slug,
      title: h1 ? h1.textContent.trim() : slug,
      iso: time ? time.getAttribute("datetime") : "",
      desc: desc ? desc.getAttribute("content") : "",
      flag: ""
    };
  }

  /* ---------------- 打开 / 新建 ---------------- */

  function setFields(p) {
    el.fTitle.value = p.title || "";
    el.fDate.value = p.iso || todayISO();
    el.fSlug.value = p.slug || "";
    el.fDesc.value = p.desc || "";
    el.fFlag.value = p.flag || "";
    el.fMd.value = p.md || "";
    el.fSlug.readOnly = !!p.lockedSlug;
    el.paneTitle.textContent = p.title || (p.isNew ? "新文章" : p.slug);
    updateCount();
    render();
  }

  function restoreDraft(slug) {
    try {
      var raw = localStorage.getItem(LS_DRAFT + slug);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function openPost(slug) {
    var meta = state.posts.filter(function (p) { return p.slug === slug; })[0] || {
      slug: slug, title: slug, iso: "", desc: "", flag: ""
    };
    state.current = { slug: slug, isNew: false };
    paintRail();
    el.openLive.hidden = false;
    el.openLive.href = "/articles/" + slug;
    setStatus("读取正文…");
    el.paneTitle.textContent = meta.title || slug;

    getFileOrNull("_content/" + slug + ".md").then(function (mdFile) {
      if (mdFile) return mdFile.text;
      return getFile("articles/" + slug + ".html").then(function (htmlFile) {
        var doc = new DOMParser().parseFromString(htmlFile.text, "text/html");
        var prose = doc.querySelector(".prose");
        if (prose) {
          var header = prose.querySelector("header");
          if (header) header.remove();
          return htmlToMd(prose.innerHTML);
        }
        return "";
      });
    }).then(function (md) {
      var draft = restoreDraft(slug);
      var payload = {
        title: meta.title, iso: meta.iso, desc: meta.desc, flag: meta.flag,
        slug: slug, md: md, lockedSlug: true
      };
      if (draft && draft.md != null) {
        payload.md = draft.md;
        payload.title = draft.title || payload.title;
        payload.iso = draft.iso || payload.iso;
        payload.desc = draft.desc || payload.desc;
        payload.flag = draft.flag || payload.flag;
      }
      setFields(payload);
      state.dirty = false;
      setStatus(draft ? "已恢复本机草稿" : "已载入", draft ? "ok" : null);
    }).catch(function (err) {
      setStatus("正文读取失败：" + err.message, "err");
    });
  }

  function newPost() {
    state.current = { slug: null, isNew: true };
    paintRail();
    el.openLive.hidden = true;
    setFields({ title: "", iso: todayISO(), desc: "", flag: "", slug: "", md: "", lockedSlug: false });
    state.dirty = false;
    setStatus("新文章：先写标题和 slug");
    el.fTitle.focus();
  }

  /* ---------------- 预览 ---------------- */

  function previewDoc() {
    var body = mdToHtml(el.fMd.value);
    return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<base href="/">' +
      '<link rel="stylesheet" href="/styles.css"></head><body>' +
      '<main class="shell"><article class="prose"><header><h1>' +
      esc(el.fTitle.value || "无标题") + "</h1><time>" +
      esc(cnDate(el.fDate.value)) + "</time></header>" + body +
      "</article></main>" +
      '<script src="/assets/vendor/rough-notation.js"><\/script>' +
      '<script src="/assets/js/marginalia.js"><\/script>' +
      "</body></html>";
  }

  function render() {
    el.pv.srcdoc = previewDoc();
  }

  var renderLazy = debounce(function () {
    if (el.live.checked) render();
  }, 420);

  function updateCount() {
    var raw = el.fMd.value.replace(/\s/g, "");
    el.count.textContent = raw.length + " 字";
  }

  /* ---------------- 草稿 ---------------- */

  function currentKey() {
    var slug = el.fSlug.value.trim() || (state.current && state.current.slug);
    return slug || "__new__";
  }

  function saveDraft(silent) {
    var key = currentKey();
    var payload = {
      title: el.fTitle.value,
      iso: el.fDate.value,
      desc: el.fDesc.value,
      flag: el.fFlag.value,
      md: el.fMd.value,
      ts: Date.now()
    };
    try {
      localStorage.setItem(LS_DRAFT + key, JSON.stringify(payload));
      state.dirty = false;
      if (!silent) setStatus("草稿存在本机 · " + new Date().toLocaleTimeString("zh-CN"), "ok");
    } catch (e) {
      setStatus("本机存不下草稿：" + e.message, "err");
    }
  }

  var saveDraftLazy = debounce(function () { saveDraft(true); }, 900);

  /* ---------------- 发布 ---------------- */

  function collect() {
    var title = el.fTitle.value.trim();
    var iso = el.fDate.value;
    var slug = el.fSlug.value.trim();
    var desc = el.fDesc.value.trim();
    var flag = el.fFlag.value.trim();
    var md = el.fMd.value;

    if (!title) throw new Error("标题还没填");
    if (!iso) throw new Error("日期还没选");
    if (!slug) throw new Error("slug 还没填（就是网址里那一段，只能用小写字母、数字、短横线）");
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error("slug 只能用小写字母、数字和短横线，且不能以短横线开头");
    if (!md.trim()) throw new Error("正文是空的");

    return { title: title, iso: iso, slug: slug, desc: desc, flag: flag, md: md };
  }

  function publish() {
    var post;
    try { post = collect(); } catch (err) { setStatus(err.message, "err"); return; }

    if (state.current && state.current.isNew &&
        state.posts.some(function (p) { return p.slug === post.slug; })) {
      setStatus("这个 slug 已经有一篇文章了，换一个（或先去改那篇）", "err");
      return;
    }

    el.publish.disabled = true;
    setStatus("打包中…");

    var body = mdToHtml(post.md);
    var page = renderPage({
      title: post.title,
      desc: post.desc,
      date: cnDate(post.iso),
      iso: post.iso,
      body: body
    });

    var nextPosts = state.posts.filter(function (p) { return p.slug !== post.slug; });
    nextPosts.push({
      slug: post.slug, title: post.title, iso: post.iso, desc: post.desc, flag: post.flag
    });
    nextPosts = sortPosts(nextPosts);

    getFile("index.html").then(function (indexFile) {
      var indexHtml = indexFile.text;
      if (!POSTS_RE.test(indexHtml)) {
        throw new Error("index.html 里找不到 posts:start / posts:end 标记");
      }
      indexHtml = indexHtml.replace(POSTS_RE, renderPostList(nextPosts));

      setStatus("提交到 GitHub…");
      return commitFiles([
        { path: "_content/" + post.slug + ".md", content: post.md + "\n" },
        { path: "articles/" + post.slug + ".html", content: page },
        {
          path: "_content/index.json",
          content: JSON.stringify({ posts: nextPosts }, null, 2) + "\n"
        },
        { path: "index.html", content: indexHtml }
      ], "发布：" + post.title);
    }).then(function () {
      state.posts = nextPosts;
      state.current = { slug: post.slug, isNew: false };
      el.fSlug.readOnly = true;
      try { localStorage.removeItem(LS_DRAFT + post.slug); } catch (e) {}
      paintRail();
      el.openLive.hidden = false;
      el.openLive.href = "/articles/" + post.slug;
      el.paneTitle.textContent = post.title;
      state.dirty = false;
      setStatus("已推送 · Cloudflare 正在构建，约一分钟后上线", "ok");
    }).catch(function (err) {
      setStatus("发布失败：" + err.message, "err");
    }).then(function () {
      el.publish.disabled = false;
    });
  }

  function removePost() {
    var slug = (state.current && state.current.slug) || el.fSlug.value.trim();
    if (!slug) { setStatus("没有选中的文章", "err"); return; }
    var meta = state.posts.filter(function (p) { return p.slug === slug; })[0];
    var name = meta ? meta.title : slug;
    if (!window.confirm("删除「" + name + "」？\n会从仓库删掉文章页与正文源，并从首页列表移除。\n（提交记录还在，可以恢复）")) return;

    el.publish.disabled = true;
    setStatus("删除中…");

    var nextPosts = state.posts.filter(function (p) { return p.slug !== slug; });

    getFile("index.html").then(function (indexFile) {
      var indexHtml = indexFile.text.replace(POSTS_RE, renderPostList(nextPosts));
      return commitFiles([
        { path: "articles/" + slug + ".html", content: null },
        { path: "_content/" + slug + ".md", content: null },
        {
          path: "_content/index.json",
          content: JSON.stringify({ posts: nextPosts }, null, 2) + "\n"
        },
        { path: "index.html", content: indexHtml }
      ], "删除：" + name);
    }).then(function () {
      state.posts = nextPosts;
      try { localStorage.removeItem(LS_DRAFT + slug); } catch (e) {}
      newPost();
      paintRail();
      setStatus("已删除 " + name, "ok");
    }).catch(function (err) {
      setStatus("删除失败：" + err.message, "err");
    }).then(function () {
      el.publish.disabled = false;
    });
  }

  /* ---------------- 工具栏 ---------------- */

  function wrap(before, after) {
    var ta = el.fMd;
    var start = ta.selectionStart;
    var end = ta.selectionEnd;
    var value = ta.value;
    var selected = value.slice(start, end);
    var head = before;
    var tail = after;
    if (!selected) {
      /* 没选中：留个空位，光标放中间 */
      ta.value = value.slice(0, start) + before + after + value.slice(end);
      ta.selectionStart = ta.selectionEnd = start + before.length;
    } else {
      ta.value = value.slice(0, start) + head + selected + tail + value.slice(end);
      ta.selectionStart = start + head.length;
      ta.selectionEnd = start + head.length + selected.length;
    }
    ta.focus();
    onEdit();
  }

  function wrapNote() {
    var ta = el.fMd;
    var start = ta.selectionStart;
    var end = ta.selectionEnd;
    var selected = ta.value.slice(start, end) || "这句话";
    var before = "{{" + selected + "|";
    var after = "}}";
    ta.value = ta.value.slice(0, start) + before + "旁批文字" + after + ta.value.slice(end);
    ta.selectionStart = start + before.length;
    ta.selectionEnd = start + before.length + 4;
    ta.focus();
    onEdit();
  }

  function block(kind) {
    var ta = el.fMd;
    var start = ta.selectionStart;
    var end = ta.selectionEnd;
    var value = ta.value;

    /* 扩到整行 */
    var lineStart = value.lastIndexOf("\n", start - 1) + 1;
    var lineEnd = value.indexOf("\n", end);
    if (lineEnd === -1) lineEnd = value.length;
    var blockText = value.slice(lineStart, lineEnd);

    if (kind === "link") {
      var label = value.slice(start, end) || "链接文字";
      var insert = "[" + label + "](https://)";
      ta.value = value.slice(0, start) + insert + value.slice(end);
      ta.selectionStart = start + insert.length - 1;
      ta.selectionEnd = start + insert.length - 1;
    } else {
      var prefix = { h2: "# ", ul: "- ", ol: "1. ", quote: "> " }[kind] || "";
      var rendered;
      if (kind === "code") {
        rendered = "```\n" + (blockText || "") + "\n```";
      } else {
        rendered = blockText.split("\n").map(function (line) {
          return prefix + line;
        }).join("\n");
      }
      ta.value = value.slice(0, lineStart) + rendered + value.slice(lineEnd);
      ta.selectionStart = ta.selectionEnd = lineStart + rendered.length;
    }
    ta.focus();
    onEdit();
  }

  /* ---------------- 事件 ---------------- */

  function onEdit() {
    state.dirty = true;
    updateCount();
    var title = el.fTitle.value.trim();
    if (title) el.paneTitle.textContent = title;
    renderLazy();
    saveDraftLazy();
  }

  var slugTouched = false;
  el.fSlug.addEventListener("input", function () { slugTouched = !!el.fSlug.value; });

  el.fTitle.addEventListener("input", function () {
    if (state.current && state.current.isNew && !slugTouched) {
      var ascii = el.fTitle.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      el.fSlug.value = ascii;
    }
    onEdit();
  });

  [el.fDate, el.fDesc, el.fFlag].forEach(function (node) {
    node.addEventListener("input", onEdit);
  });

  el.fMd.addEventListener("input", onEdit);

  el.fMd.addEventListener("keydown", function (e) {
    var meta = e.metaKey || e.ctrlKey;
    if (!meta) return;
    var k = e.key.toLowerCase();
    if (k === "b") { e.preventDefault(); wrap("**", "**"); }
    else if (k === "i") { e.preventDefault(); wrap("*", "*"); }
    else if (k === "s") { e.preventDefault(); saveDraft(); }
  });

  el.toolbar.addEventListener("click", function (e) {
    var btn = e.target.closest("button");
    if (!btn) return;
    if (btn.dataset.wrap) {
      var parts = btn.dataset.wrap.split("|");
      wrap(parts[0], parts[1]);
    } else if (btn.dataset.note) {
      wrapNote();
    } else if (btn.dataset.block) {
      block(btn.dataset.block);
    }
  });

  el.live.addEventListener("change", function () {
    if (el.live.checked) render();
  });

  el.refresh.addEventListener("click", render);
  el.saveDraft.addEventListener("click", function () { saveDraft(); });
  el.publish.addEventListener("click", publish);
  el.newPost.addEventListener("click", newPost);

  document.addEventListener("keydown", function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key === "s") {
      e.preventDefault();
      saveDraft();
    }
  });

  window.addEventListener("beforeunload", function (e) {
    if (!state.dirty) return;
    e.preventDefault();
    e.returnValue = "";
  });

  el.deleteBtn.addEventListener("click", removePost);

  /* ---------------- 登录 ---------------- */

  function enter(token) {
    state.token = token;
    el.gateError.hidden = true;
    el.gateBtn.disabled = true;
    el.gateBtn.textContent = "验证…";

    gh("/repos/" + OWNER + "/" + REPO).then(function (repo) {
      if (repo.permissions && repo.permissions.push === false) {
        throw new Error("这枚 token 对这个仓库只有读权限，需要 Contents: Read and write");
      }
      localStorage.setItem(LS_TOKEN, token);
      el.gate.hidden = true;
      el.app.hidden = false;
      return loadPosts().then(function () {
        if (state.posts.length) openPost(state.posts[0].slug);
        else newPost();
      });
    }).catch(function (err) {
      localStorage.removeItem(LS_TOKEN);
      el.gate.hidden = false;
      el.app.hidden = true;
      el.gateError.hidden = false;
      el.gateError.textContent = err.status === 401
        ? "token 无效或已过期（401）。重新生成一枚再来。"
        : "连不上：" + err.message;
    }).then(function () {
      el.gateBtn.disabled = false;
      el.gateBtn.textContent = "进入";
    });
  }

  el.gateForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var token = el.gateInput.value.trim();
    if (!token) {
      el.gateError.hidden = false;
      el.gateError.textContent = "先把 token 粘进来。";
      return;
    }
    enter(token);
  });

  el.logout.addEventListener("click", function () {
    localStorage.removeItem(LS_TOKEN);
    state.token = "";
    el.app.hidden = true;
    el.gate.hidden = false;
    el.gateInput.value = "";
  });

  /* ---------------- 启动 ---------------- */

  window.__admin = { mdToHtml: mdToHtml, htmlToMd: htmlToMd, renderPage: renderPage, renderPostList: renderPostList };

  var saved = localStorage.getItem(LS_TOKEN);
  if (saved) {
    enter(saved);
  } else {
    el.gateInput.focus();
  }
})();
