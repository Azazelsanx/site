/* ==========================================================================
   编辑台 · 核心能力（读仓库 / 轻标记 <-> HTML / 页面模板 / 原子提交）
   — 与 UI 无关，app.js 与 builder.js 共用
   ========================================================================== */
window.Core = (function () {
  "use strict";

  var OWNER = "Azazelsanx";
  var REPO = "site";
  var BRANCH = "main";
  var API = "https://api.github.com";
  var token = "";

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

  /* ---------------- GitHub ---------------- */

  function gh(path, opts) {
    opts = opts || {};
    var init = {
      method: opts.method || "GET",
      headers: {
        Authorization: "Bearer " + token,
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

  return {
    setToken: function (t) { token = t; },
    gh: gh,
    getFile: getFile,
    getFileOrNull: getFileOrNull,
    commitFiles: commitFiles,
    esc: esc,
    slugify: slugify,
    todayISO: todayISO,
    cnDate: cnDate,
    mdToHtml: mdToHtml,
    htmlToMd: htmlToMd,
    renderPage: renderPage,
    renderPostList: renderPostList,
    sortPosts: sortPosts,
    metaFromHtml: metaFromHtml,
    POSTS_RE: POSTS_RE
  };
})();
