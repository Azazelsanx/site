/* ==========================================================================
   装修画布 —— 跑在预览 iframe 里
   — 点选 / 就地改字 / 拖动排序 / 插入 / 手绘装饰实时重画
   — 只动 DOM，不碰文件；父窗口通过 window.__xb 调，回调走 window.parent.__xbHost
   ========================================================================== */
(function () {
  "use strict";
  if (window.__xb) return;

  var RN = window.RoughNotation;

  var INK = "rgba(24, 24, 24, 0.55)";
  var HILITE = "rgba(252, 231, 118, 0.85)";
  var RED = "rgba(196, 58, 48, 0.6)";

  var prose = null;
  var host = null;
  var sel = null;
  var editing = false;
  var drag = null;
  var lastRange = null;
  var overlay, boxEl, tagEl, gripEl, lineEl, bar, barRoot, ask, askRoot;
  var bootTries = 0;

  function q(sel, root) { return (root || document).querySelector(sel); }

  /* ---------------------------- 启动 ---------------------------- */

  function boot() {
    prose = q(".prose");
    if (!prose) {
      if (bootTries++ < 60) return setTimeout(boot, 60);
      return;
    }
    host = window.parent && window.parent.__xbHost;
    if (!host) {
      if (bootTries++ < 60) return setTimeout(boot, 60);
      return;
    }
    buildChrome();
    bindEvents();
    host.onReady && host.onReady();
    setTimeout(function () { if (host.onScroll) host.onScroll(); }, 30);
  }

  /* ---------------------------- 浮层与工具条 ---------------------------- */

  function buildChrome() {
    overlay = document.createElement("div");
    overlay.id = "xb-overlay";
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:2147483000;pointer-events:none;contain:layout style;";

    boxEl = document.createElement("div");
    boxEl.style.cssText =
      "position:absolute;border:1.5px solid #2f6fed;border-radius:2px;" +
      "background:rgba(47,111,237,.04);display:none;pointer-events:none;" +
      "box-shadow:0 0 0 3px rgba(47,111,237,.10);";

    tagEl = document.createElement("div");
    tagEl.style.cssText =
      "position:absolute;left:-1px;top:-21px;height:18px;padding:0 6px;" +
      'font:600 10.5px/18px ui-monospace,SFMono-Regular,Consolas,monospace;' +
      "letter-spacing:.06em;color:#fff;background:#2f6fed;border-radius:2px;" +
      "white-space:nowrap;text-transform:uppercase;";

    gripEl = document.createElement("div");
    gripEl.title = "拖动排序";
    gripEl.style.cssText =
      "position:absolute;left:-26px;top:0;width:20px;height:20px;border-radius:3px;" +
      "background:#2f6fed;color:#fff;display:none;align-items:center;justify-content:center;" +
      "cursor:grab;pointer-events:auto;font:600 12px/1 ui-monospace,monospace;" +
      "box-shadow:0 1px 3px rgba(0,0,0,.25);";
    gripEl.textContent = "⠿";

    lineEl = document.createElement("div");
    lineEl.style.cssText =
      "position:absolute;left:0;right:0;height:2px;background:#2f6fed;display:none;" +
      "pointer-events:none;box-shadow:0 0 0 2px rgba(47,111,237,.18);";

    overlay.appendChild(boxEl);
    overlay.appendChild(lineEl);
    overlay.appendChild(tagEl);
    overlay.appendChild(gripEl);
    document.body.appendChild(overlay);

    bar = document.createElement("div");
    bar.id = "xb-bar";
    bar.style.cssText = "position:fixed;z-index:2147483001;left:0;top:0;display:none;";
    barRoot = bar.attachShadow({ mode: "open" });
    barRoot.innerHTML =
      '<style>' +
      ':host{all:initial}' +
      '.bar{display:flex;gap:2px;align-items:center;padding:4px;border-radius:8px;' +
      'background:#1b1d21;box-shadow:0 6px 22px rgba(0,0,0,.32),0 0 0 1px rgba(255,255,255,.08);' +
      'font:12px/1 -apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;' +
      'color:#e8e8e8;user-select:none;white-space:nowrap}' +
      '.b{all:unset;display:inline-flex;align-items:center;justify-content:center;' +
      'min-width:26px;height:26px;padding:0 7px;border-radius:5px;cursor:pointer;' +
      'color:#e8e8e8;font-size:12px;line-height:1}' +
      '.b:hover{background:#33373d}' +
      '.b.on{background:#2f6fed;color:#fff}' +
      '.b.wide{padding:0 9px}' +
      '.sep{width:1px;height:16px;background:#3a3f46;margin:0 3px}' +
      '.dot{width:9px;height:9px;border-radius:50%;display:inline-block;margin-right:5px}' +
      '</style>' +
      '<div class="bar">' +
      '<button class="b" data-act="bold" title="加粗 Ctrl+B"><b>B</b></button>' +
      '<button class="b" data-act="italic" title="斜体 Ctrl+I"><i>I</i></button>' +
      '<button class="b" data-act="link" title="链接">🔗</button>' +
      '<span class="sep"></span>' +
      '<button class="b" data-act="mark" title="荧光笔"><span class="dot" style="background:#fce776"></span>高亮</button>' +
      '<button class="b" data-act="circle" title="手绘圈"><span class="dot" style="background:#8a8a8a"></span>圈</button>' +
      '<button class="b" data-act="box" title="红笔方框"><span class="dot" style="background:#c43a30"></span>框</button>' +
      '<button class="b" data-act="note" title="页边批注">批注</button>' +
      '<span class="sep"></span>' +
      '<button class="b" data-act="up" title="上移">↑</button>' +
      '<button class="b" data-act="down" title="下移">↓</button>' +
      '<button class="b" data-act="dup" title="复制一块">⧉</button>' +
      '<button class="b" data-act="del" title="删掉这块">✕</button>' +
      '<span class="sep"></span>' +
      '<button class="b wide" data-act="add" title="在这块后面插入">＋ 插入</button>' +
      "</div>";
    document.body.appendChild(bar);

    barRoot.addEventListener("click", function (e) {
      var path = e.composedPath();
      var btn = null;
      for (var i = 0; i < path.length; i++) {
        if (path[i].getAttribute && path[i].getAttribute("data-act")) { btn = path[i]; break; }
      }
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      act(btn.getAttribute("data-act"));
    });
    barRoot.addEventListener("pointerdown", function (e) { e.stopPropagation(); });

    ask = document.createElement("div");
    ask.style.cssText = "position:fixed;z-index:2147483002;display:none;";
    askRoot = ask.attachShadow({ mode: "open" });
    askRoot.innerHTML =
      '<style>:host{all:initial}' +
      '.p{display:flex;gap:6px;align-items:center;padding:7px 8px;border-radius:8px;' +
      'background:#1b1d21;box-shadow:0 6px 22px rgba(0,0,0,.32);' +
      'font:12px/1 -apple-system,"Segoe UI","PingFang SC",sans-serif}' +
      'input{all:unset;width:210px;height:26px;padding:0 8px;border-radius:5px;' +
      'background:#2a2e34;color:#f2f2f2;font-size:12px}' +
      'input::placeholder{color:#7d848c}' +
      'button{all:unset;height:26px;padding:0 10px;border-radius:5px;background:#2f6fed;' +
      'color:#fff;font-size:12px;cursor:pointer}' +
      '</style>' +
      '<div class="p"><input id="v" placeholder="输入后回车"><button id="ok">好</button></div>';
    document.body.appendChild(ask);
  }

  /* ---------------------------- 选中 ---------------------------- */

  function blocks() {
    if (!prose) return [];
    return Array.prototype.filter.call(prose.children, function (n) {
      return n.tagName !== "HEADER" && n.tagName !== "SCRIPT" && n.tagName !== "STYLE";
    });
  }

  function norm(node) {
    /* 选中 .noted 里的段落时，统一回外层，方便整块操作 */
    if (!node || node === prose) return null;
    var n = node;
    while (n && n.parentNode !== prose) n = n.parentNode;
    return n && n !== prose ? n : null;
  }

  function pick(target) {
    if (!target || target === overlay) return null;
    if (target.closest && target.closest("#xb-bar")) return null;
    if (!prose.contains(target)) return null;
    var n = norm(target);
    if (n && n.tagName === "HEADER") return null;
    return n;
  }

  function select(node) {
    if (sel === node) return;
    if (editing) stopEdit();
    sel = node || null;
    paintChrome();
    report();
  }

  function paintChrome() {
    if (!sel || !document.body.contains(sel)) {
      boxEl.style.display = "none";
      tagEl.style.display = "none";
      gripEl.style.display = "none";
      bar.style.display = "none";
      return;
    }
    var r = sel.getBoundingClientRect();
    boxEl.style.display = "block";
    boxEl.style.left = r.left + "px";
    boxEl.style.top = r.top + "px";
    boxEl.style.width = r.width + "px";
    boxEl.style.height = r.height + "px";

    tagEl.style.display = "block";
    tagEl.style.top = r.top > 24 ? "-21px" : r.height + 3 + "px";
    tagEl.textContent = label(sel);

    gripEl.style.display = "flex";
    gripEl.style.left = "-26px";
    gripEl.style.top = "0";

    bar.style.display = "block";
    var bw = barRoot.firstElementChild ? barRoot.firstElementChild.getBoundingClientRect().width : 320;
    var gutter = window.innerWidth - r.right;
    var left, top;
    if (gutter > bw + 16) {
      /* 右边有留白就贴右，别压正文 */
      left = r.right + 12;
      top = Math.max(8, r.top);
    } else if (r.top > 46) {
      left = Math.min(Math.max(8, r.left + 24), window.innerWidth - bw - 8);
      top = r.top - 40;
    } else {
      left = Math.max(8, r.left);
      top = r.bottom + 8;
    }
    bar.style.left = left + "px";
    bar.style.top = top + "px";

    /* 按钮点亮状态 */
    var info = inspect();
    var on = { mark: info.marks.highlight, circle: info.marks.circle, box: info.marks.box };
    Array.prototype.forEach.call(barRoot.querySelectorAll("[data-act]"), function (b) {
      var a = b.getAttribute("data-act");
      b.classList.toggle("on", !!on[a]);
    });
  }

  function label(node) {
    var t = node.tagName.toLowerCase();
    var map = {
      p: node.closest(".noted") ? "段落 · 带批注" : "段落",
      h2: "小标题", h3: "小标题", blockquote: "引用",
      ul: "列表", ol: "编号列表", pre: "代码块", figure: "图片", img: "图片",
      "div.noted": "段落 · 带批注", hr: "分隔线"
    };
    return map[t] || map[t + "." + (node.className || "").split(" ")[0]] || t;
  }

  /* ---------------------------- 读取信息给侧栏 ---------------------------- */

  function styleTarget(node) {
    if (!node) return null;
    if (node.classList && node.classList.contains("noted")) {
      return node.querySelector("p, h2, h3") || node;
    }
    return node;
  }

  function inspect() {
    var info = { tag: "", text: "", style: {}, marks: {}, note: null, levels: [] };
    if (!sel) return info;
    var t = styleTarget(sel);
    var cs = window.getComputedStyle(t);
    info.tag = sel.tagName.toLowerCase();
    info.label = label(sel);
    info.text = (sel.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120);
    info.style = {
      fontSize: Math.round(parseFloat(cs.fontSize) * 10) / 10,
      lineHeight: (function () {
        var fs = parseFloat(cs.fontSize) || 15;
        var lh = parseFloat(cs.lineHeight) || fs * 1.6;
        return Math.round((lh / fs) * 100) / 100;
      })(),
      fontWeight: cs.fontWeight,
      color: rgb(cs.color),
      textAlign: cs.textAlign === "start" ? "left" : cs.textAlign,
      marginTop: Math.round((parseFloat(cs.marginTop) || 0) || (parseFloat(cs.paddingTop) || 0)),
      marginBottom: Math.round((parseFloat(cs.marginBottom) || 0) || (parseFloat(cs.paddingBottom) || 0)),
      textIndent: Math.round(parseFloat(cs.textIndent) || 0),
      maxWidth: t.style.maxWidth || "",
      fontFamily: fontKey(cs.fontFamily),
      letterSpacing: Math.round((parseFloat(cs.letterSpacing) || 0) * 100) / 100
    };
    var marks = sel.querySelectorAll("mark, .circled, .boxed");
    info.marks = { highlight: false, circle: false, box: false };
    Array.prototype.forEach.call(marks, function (m) {
      if (m.tagName === "MARK") info.marks.highlight = true;
      if (m.classList.contains("circled")) info.marks.circle = true;
      if (m.classList.contains("boxed")) info.marks.box = true;
    });
    var note = sel.querySelector ? sel.querySelector(".side-note") : null;
    if (note) {
      info.note = {
        key: note.getAttribute("data-note-for") || "",
        text: (note.querySelector(".side-note__text") || note).textContent.trim()
      };
    }
    info.levels = sel.tagName === "H2" ? ["h2", "h3"] :
      sel.tagName === "H3" ? ["h3", "h2"] : [];
    info.canMove = blocks().indexOf(sel);
    return info;
  }

  function rgb(v) {
    var m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(v || "");
    if (!m) return v || "#000000";
    return "#" + [1, 2, 3].map(function (i) {
      return ("0" + parseInt(m[i], 10).toString(16)).slice(-2);
    }).join("");
  }

  function fontKey(f) {
    if (/Newsreader|Songti|serif/i.test(f)) return "serif";
    if (/Caveat|Kaiti|KaiTi|hand/i.test(f)) return "hand";
    if (/mono|Consolas/i.test(f)) return "mono";
    return "sans";
  }

  function report() {
    if (!host || !host.onSelect) return;
    host.onSelect(sel ? inspect() : null);
  }

  /* ---------------------------- 改样式 ---------------------------- */

  var CSS = {
    fontSize: "fontSize", lineHeight: "lineHeight", fontWeight: "fontWeight",
    color: "color", textAlign: "textAlign", marginTop: "marginTop",
    marginBottom: "marginBottom", textIndent: "textIndent",
    letterSpacing: "letterSpacing", maxWidth: "maxWidth", fontFamily: "fontFamily"
  };

  var FONTS = {
    sans: 'var(--font-primary)',
    serif: 'var(--font-secondary)',
    hand: 'var(--font-hand)',
    mono: 'var(--font-code)'
  };

  function setStyle(patch) {
    if (!sel) return;
    var t = styleTarget(sel);
    var cs = window.getComputedStyle(t);
    Object.keys(patch).forEach(function (k) {
      var prop = CSS[k] || k;
      /* 小标题的间距来自 padding-top，改 margin 会被 padding 顶上，看不到变化 */
      if (k === "marginTop" && (parseFloat(cs.paddingTop) || 0) > 0 && !(parseFloat(cs.marginTop) || 0)) {
        prop = "paddingTop";
      }
      if (k === "marginBottom" && (parseFloat(cs.paddingBottom) || 0) > 0 && !(parseFloat(cs.marginBottom) || 0)) {
        prop = "paddingBottom";
      }
      var v = patch[k];
      if (v === "" || v == null) { t.style.removeProperty(kebab(prop)); return; }
      if (k === "fontFamily") v = FONTS[v] || v;
      if (k === "fontSize" || k === "marginTop" || k === "marginBottom" ||
          k === "textIndent" || k === "maxWidth") v = v + "px";
      if (k === "letterSpacing") v = v + "px";
      t.style.setProperty(kebab(prop), v);
    });
    paintChrome();
    commit("style");
  }

  function kebab(s) { return s.replace(/[A-Z]/g, function (c) { return "-" + c.toLowerCase(); }); }

  function setBlockTag(tag) {
    if (!sel || sel.tagName === "HEADER") return;
    var t = sel.tagName === tag.toUpperCase() ? null : tag;
    if (!t) return;
    var el = document.createElement(tag);
    if (tag === "h2" || tag === "h3") {
      el.id = slug((sel.textContent || "").trim());
    }
    while (sel.firstChild) el.appendChild(sel.firstChild);
    sel.parentNode.replaceChild(el, sel);
    sel = el;
    paintChrome();
    report();
    commit("tag");
  }

  function slug(s) {
    return String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
  }

  /* ---------------------------- 装饰 ---------------------------- */

  function annoOf(el) { return el.__anno || null; }

  function addAnno(el, type) {
    if (!RN) return;
    if (el.__anno) el.__anno.remove();
    var opts = { animate: true, animationDuration: 420 };
    if (type === "circle") {
      opts = { type: "circle", color: INK, padding: [7, 9], multiline: true, strokeWidth: 1.1 };
    } else if (type === "highlight") {
      el.classList.add("mark-live");
      opts = { type: "highlight", color: HILITE, padding: 1, multiline: true };
    } else if (type === "box") {
      opts = { type: "box", color: RED, strokeWidth: 1.15, padding: [2, 4], multiline: true };
    } else if (type === "bracket") {
      opts = {
        type: "bracket", brackets: ["left"], color: "currentColor",
        strokeWidth: 1.25, padding: [6, 0, 6, 6]
      };
    }
    el.__anno = RN.annotate(el, opts);
    el.__anno.show();
  }

  function dropAnno(el) {
    if (el.__anno) { try { el.__anno.remove(); } catch (e) {} el.__anno = null; }
    var svg = el.parentNode && el.parentNode.querySelector(":scope > svg.rough-annotation");
    if (svg) svg.remove();
    el.classList.remove("mark-live");
  }

  function toggleMark(kind) {
    if (!sel) return;
    var root = styleTarget(sel);
    var tag = kind === "highlight" ? "MARK" : null;
    var cls = kind === "circle" ? "circled" : kind === "box" ? "boxed" : null;

    /* 先把选区存下来，工具栏点击会夺走 focus */
    var range = savedRange(root);

    var found = tag
      ? root.querySelector(tag)
      : Array.prototype.filter.call(root.querySelectorAll("." + cls), function (n) {
          return !n.classList.contains("note-anchor") || kind !== "circle";
        })[0];

    if (found) {
      dropAnno(found);
      unwrap(found);
      refreshNotes();
      paintChrome();
      report();
      commit("mark-off");
      return;
    }

    if (!range) {
      /* 没选区：整块套上 */
      if (tag) {
        var m = document.createElement("mark");
        while (root.firstChild) m.appendChild(root.firstChild);
        root.appendChild(m);
        addAnno(m, "highlight");
      } else {
        /* 整块包：把块内容塞进 span，块本身留空壳不合法，改用首个子节点包裹 */
        var target = wrapAll(root);
        addAnno(target, kind);
      }
      refreshNotes();
      paintChrome();
      report();
      commit("mark-on");
      return;
    }

    var node;
    if (tag) {
      node = document.createElement("mark");
    } else {
      node = document.createElement("span");
      node.className = cls;
    }
    try {
      node.appendChild(range.extractContents());
      range.insertNode(node);
    } catch (e) { return; }
    addAnno(node, kind === "highlight" ? "highlight" : kind);
    var s = window.getSelection();
    if (s) { s.removeAllRanges(); }
    refreshNotes();
    paintChrome();
    report();
    commit("mark-on");
  }

  function wrapAll(root) {
    var holder = document.createElement("span");
    holder.className = root.tagName === "P" ? "circled" : "circled";
    while (root.firstChild) holder.appendChild(root.firstChild);
    root.appendChild(holder);
    return holder;
  }

  function savedRange(root) {
    var s = window.getSelection();
    if (s && s.rangeCount && !s.isCollapsed) {
      var r = s.getRangeAt(0);
      if (root.contains(r.commonAncestorContainer)) return r.cloneRange();
    }
    return null;
  }

  function unwrap(el) {
    var p = el.parentNode;
    if (!p) return;
    while (el.firstChild) p.insertBefore(el.firstChild, el);
    p.removeChild(el);
    p.normalize();
  }

  /* ---------------------------- 页面主题 ---------------------------- */

  var THEME_ID = "xb-theme";

  function themeEl() {
    var s = document.getElementById(THEME_ID);
    if (!s) {
      s = document.createElement("style");
      s.id = THEME_ID;
      prose.insertBefore(s, prose.firstChild);
    }
    return s;
  }

  function applyTheme(t) {
    var decls = [];
    if (t.bg) decls.push("--body-bg:" + t.bg);
    if (t.ink) decls.push("--body-color:" + t.ink);
    if (t.muted) decls.push("--muted:" + t.muted);
    if (t.accent) decls.push("--badge:" + t.accent);
    if (t.hilite) decls.push("--hilite:" + t.hilite);
    if (t.measure) decls.push("--measure:" + t.measure + "px");
    if (t.font) decls.push("--font-primary:" + FONTS[t.font]);
    var css = "";
    if (decls.length) css += ":root{" + decls.join(";") + "}\n";
    if (t.size) css += ".prose{font-size:" + t.size + "px}\n";
    if (t.line) css += ".prose p{line-height:" + t.line + "}\n";
    themeEl().textContent = css;
    paintChrome();
    commit("theme");
  }

  /* ---------------------------- 批注 ---------------------------- */

  function refreshNotes() {
    Array.prototype.forEach.call(prose.querySelectorAll(".side-note"), function (n) {
      var b = n.querySelector(".side-note__bracket");
      if (b && !b.__anno) addAnno(b, "bracket");
      n.classList.add("is-shown");
      n.classList.add("is-written");
    });
  }

  function addNote(text) {
    if (!sel) return;
    var root = styleTarget(sel);
    var range = savedRange(root);
    var key = "n" + Date.now().toString(36).slice(-5);

    var anchor;
    if (range) {
      anchor = document.createElement("span");
      anchor.className = "note-anchor";
      anchor.setAttribute("data-note", key);
      try {
        anchor.appendChild(range.extractContents());
        range.insertNode(anchor);
      } catch (e) { return; }
    } else {
      anchor = document.createElement("span");
      anchor.className = "note-anchor";
      anchor.setAttribute("data-note", key);
      while (root.firstChild) anchor.appendChild(root.firstChild);
      root.appendChild(anchor);
    }

    var note = document.createElement("aside");
    note.className = "side-note";
    note.id = "note-" + key;
    note.setAttribute("data-note-for", key);
    note.setAttribute("role", "note");
    note.setAttribute("tabindex", "0");
    note.innerHTML = '<span class="side-note__bracket" aria-hidden="true"></span>' +
      '<span class="side-note__text">' + escapeHtml(text) + "</span>";

    /* 包进 .noted 容器，页边批注靠它的定位 */
    var block = sel;
    if (!block.classList.contains("noted")) {
      var wrap = document.createElement("div");
      wrap.className = "noted";
      block.parentNode.insertBefore(wrap, block);
      wrap.appendChild(block);
      block = wrap;
    }
    block.appendChild(note);
    block.classList.add("is-shown");
    var b = note.querySelector(".side-note__bracket");
    addAnno(b, "bracket");
    note.classList.add("is-shown");
    note.classList.add("is-written");
    sel = block;
    paintChrome();
    report();
    commit("note");
  }

  function setNoteText(text) {
    if (!sel) return;
    var t = sel.querySelector(".side-note__text");
    if (!t) return;
    t.textContent = text;
    report();
    commit("note-edit");
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  /* ---------------------------- 就地改字 ---------------------------- */

  function startEdit(node) {
    if (!node) return;
    editing = true;
    node.setAttribute("contenteditable", "true");
    node.setAttribute("data-xb-editing", "1");
    node.spellcheck = false;
    node.focus();
    var r = document.createRange();
    r.selectNodeContents(node);
    var s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
    bar.style.display = "none";
  }

  function stopEdit() {
    if (!editing || !sel) { editing = false; return; }
    editing = false;
    var node = sel;
    node.removeAttribute("contenteditable");
    node.removeAttribute("data-xb-editing");
    normalize(node);
    paintChrome();
    report();
    commit("text");
  }

  function normalize(root) {
    /* contenteditable 会吐 <div>、<br>，统一成 <br> */
    Array.prototype.forEach.call(root.querySelectorAll("div"), function (d) {
      var br = document.createElement("br");
      d.parentNode.insertBefore(br, d);
      while (d.firstChild) d.parentNode.insertBefore(d.firstChild, d);
      d.remove();
    });
    Array.prototype.forEach.call(root.querySelectorAll("br"), function (br) {
      var nx = br.nextSibling;
      if (nx && nx.nodeType === 3 && /^\s*$/.test(nx.nodeValue)) nx.remove();
    });
    Array.prototype.forEach.call(root.querySelectorAll("span[style=''], *[data-xb-editing]"), function (n) {
      n.removeAttribute("data-xb-editing");
    });
  }

  /* ---------------------------- 块操作 ---------------------------- */

  function act(name) {
    if (!sel) return;
    if (name === "bold" || name === "italic" || name === "link") return inlineFmt(name);
    if (name === "mark") return toggleMark("highlight");
    if (name === "circle") return toggleMark("circle");
    if (name === "box") return toggleMark("box");
    if (name === "note") return askText("旁批写什么", function (v) { addNote(v || "记一句"); });
    if (name === "up") return move(-1);
    if (name === "down") return move(1);
    if (name === "dup") return duplicate();
    if (name === "del") return removeSel();
    if (name === "add") return askInsert();
  }

  function inlineFmt(kind) {
    var root = styleTarget(sel);
    var range = savedRange(root);
    if (kind === "link") {
      if (!range) return;
      askText("链接地址", function (v) {
        if (!v) return;
        var a = document.createElement("a");
        a.className = "link";
        a.href = /^https?:|^\//.test(v) ? v : "https://" + v;
        try { a.appendChild(range.extractContents()); range.insertNode(a); } catch (e) { return; }
        commit("link");
      });
      return;
    }
    if (!range) {
      var tag = kind === "bold" ? "strong" : "em";
      var ex = root.querySelector(tag);
      if (ex) { unwrap(ex); commit("fmt-off"); return; }
      var n = document.createElement(tag);
      while (root.firstChild) n.appendChild(root.firstChild);
      root.appendChild(n);
      commit("fmt");
      return;
    }
    var tag = kind === "bold" ? "strong" : "em";
    var el = document.createElement(tag);
    try { el.appendChild(range.extractContents()); range.insertNode(el); } catch (e) { return; }
    commit("fmt");
  }

  function move(dir) {
    var list = blocks();
    var i = list.indexOf(sel);
    if (i < 0) return;
    var j = i + dir;
    if (j < 0 || j >= list.length) return;
    var ref = dir < 0 ? list[j] : list[j].nextSibling;
    sel.parentNode.insertBefore(sel, ref);
    paintChrome();
    report();
    commit("move");
  }

  function duplicate() {
    var copy = sel.cloneNode(true);
    Array.prototype.forEach.call(copy.querySelectorAll("[id]"), function (n) { n.removeAttribute("id"); });
    sel.parentNode.insertBefore(copy, sel.nextSibling);
    select(copy);
    commit("dup");
  }

  function removeSel() {
    var next = sel.nextSibling;
    sel.remove();
    sel = next && next.nodeType === 1 && next.tagName !== "HEADER" ? next : null;
    paintChrome();
    report();
    commit("del");
  }

  function askText(placeholder, cb) {
    var input = askRoot.getElementById("v");
    input.value = "";
    input.placeholder = placeholder;
    var r = sel.getBoundingClientRect();
    ask.style.display = "block";
    ask.style.left = Math.max(8, r.left) + "px";
    ask.style.top = Math.max(8, r.top - 44) + "px";
    input.focus();
    function done() {
      var v = input.value.trim();
      ask.style.display = "none";
      input.onkeydown = null;
      askRoot.getElementById("ok").onclick = null;
      if (v) cb(v);
    }
    input.onkeydown = function (e) {
      if (e.key === "Enter") { e.preventDefault(); done(); }
      if (e.key === "Escape") { ask.style.display = "none"; }
    };
    askRoot.getElementById("ok").onclick = done;
  }

  var INSERT = {
    p: "<p>新的一段。双击就能改字。</p>",
    h2: "<h2>新的小标题</h2>",
    ul: "<ul><li>第一条</li><li>第二条</li></ul>",
    quote: "<blockquote><p>引用一句话。</p></blockquote>",
    code: "<pre><code>// 代码</code></pre>",
    hr: "<hr>",
    img: '<figure><img src="" alt="">' +
      '<figcaption>图注</figcaption></figure>'
  };

  function askInsert() {
    if (!sel) return;
    var menu = document.createElement("div");
    menu.style.cssText = "position:fixed;z-index:2147483002;display:flex;gap:2px;padding:4px;" +
      "background:#1b1d21;border-radius:8px;box-shadow:0 6px 22px rgba(0,0,0,.32)";
    var host2 = menu.attachShadow({ mode: "open" });
    host2.innerHTML = "<style>:host{all:initial}" +
      ".b{all:unset;padding:6px 9px;border-radius:5px;color:#e8e8e8;cursor:pointer;" +
      "font:12px/1 -apple-system,'PingFang SC',sans-serif}" +
      ".b:hover{background:#33373d}</style>" +
      '<div style="display:flex;gap:2px">' +
      ["p|段落", "h2|小标题", "ul|列表", "quote|引用", "code|代码", "img|图片", "hr|分隔线"]
        .map(function (s) {
          var k = s.split("|")[0];
          return '<button class="b" data-k="' + k + '">' + s.split("|")[1] + "</button>";
        }).join("") + "</div>";
    var r = sel.getBoundingClientRect();
    menu.style.left = Math.max(8, r.left) + "px";
    menu.style.top = (r.bottom + 8) + "px";
    document.body.appendChild(menu);
    host2.addEventListener("click", function (e) {
      var k = e.composedPath()[0].getAttribute && e.composedPath()[0].getAttribute("data-k");
      if (!k) return;
      menu.remove();
      insert(k);
    });
    setTimeout(function () {
      document.addEventListener("pointerdown", function off(ev) {
        if (ev.composedPath().indexOf(menu) < 0) { menu.remove(); document.removeEventListener("pointerdown", off); }
      });
    }, 0);
  }

  function insert(kind) {
    var box = document.createElement("div");
    box.innerHTML = INSERT[kind];
    var node = box.firstElementChild;
    sel.parentNode.insertBefore(node, sel.nextSibling);
    if (kind === "img") {
      var img = node.querySelector("img");
      askText("图片地址（/assets/… 或 https://…）", function (v) {
        img.src = v;
        commit("img");
        setTimeout(paintChrome, 120);
      });
      setTimeout(function () {
        var r = node.getBoundingClientRect();
        ask.style.left = Math.max(8, r.left) + "px";
        ask.style.top = Math.max(8, r.top - 44) + "px";
      }, 10);
    }
    select(node);
    commit("insert");
  }

  /* ---------------------------- 拖动排序 ---------------------------- */

  function bindDrag() {
    gripEl.addEventListener("pointerdown", function (e) {
      if (!sel) return;
      e.preventDefault();
      drag = { node: sel, startY: e.clientY, target: null };
      gripEl.style.cursor = "grabbing";
      gripEl.style.pointerEvents = "none";
      document.addEventListener("pointermove", onDragMove);
      document.addEventListener("pointerup", onDragUp);
    });
  }

  function onDragMove(e) {
    if (!drag) return;
    var list = blocks();
    var y = e.clientY;
    var insertBefore = null;
    for (var i = 0; i < list.length; i++) {
      var r = list[i].getBoundingClientRect();
      if (y < r.top + r.height / 2) { insertBefore = list[i]; break; }
    }
    drag.target = insertBefore;
    var top = insertBefore
      ? insertBefore.getBoundingClientRect().top - 2
      : (list.length ? list[list.length - 1].getBoundingClientRect().bottom : 0);
    lineEl.style.display = "block";
    lineEl.style.top = top + "px";
    lineEl.style.left = "0";
    lineEl.style.right = "0";
    window.scrollBy(0, y > window.innerHeight - 60 ? 8 : y < 60 ? -8 : 0);
  }

  function onDragUp() {
    document.removeEventListener("pointermove", onDragMove);
    document.removeEventListener("pointerup", onDragUp);
    lineEl.style.display = "none";
    gripEl.style.cursor = "grab";
    gripEl.style.pointerEvents = "auto";
    if (drag && drag.node) {
      if (drag.target) prose.insertBefore(drag.node, drag.target);
      else prose.appendChild(drag.node);
      paintChrome();
      report();
      commit("drag");
    }
    drag = null;
  }

  /* ---------------------------- 事件 ---------------------------- */

  function bindEvents() {
    document.addEventListener("pointermove", function (e) {
      if (drag || editing) return;
      var n = pick(e.target);
      if (n && !sel) {
        var r = n.getBoundingClientRect();
        boxEl.style.display = "block";
        boxEl.style.left = r.left + "px";
        boxEl.style.top = r.top + "px";
        boxEl.style.width = r.width + "px";
        boxEl.style.height = r.height + "px";
        boxEl.style.borderColor = "rgba(47,111,237,.55)";
        boxEl.style.borderStyle = "dashed";
        boxEl.style.background = "rgba(47,111,237,.02)";
        tagEl.style.display = "none";
      } else if (!sel && !n) {
        boxEl.style.display = "none";
      }
    });

    document.addEventListener("pointerdown", function (e) {
      if (e.target.closest && e.target.closest("#xb-bar")) return;
      var n = pick(e.target);
      if (n) {
        if (sel !== n) select(n);
        boxEl.style.borderStyle = "solid";
        boxEl.style.borderColor = "#2f6fed";
        boxEl.style.background = "rgba(47,111,237,.04)";
      } else if (!editing) {
        select(null);
      }
    });

    document.addEventListener("dblclick", function (e) {
      var n = pick(e.target);
      if (!n) return;
      e.preventDefault();
      select(n);
      startEdit(styleTarget(n) === n ? n : n.querySelector("p") || n);
    });

    document.addEventListener("click", function (e) {
      var a = e.target.closest && e.target.closest("a");
      if (a) e.preventDefault();
    }, true);

    document.addEventListener("scroll", function () { paintChrome(); }, true);
    window.addEventListener("resize", function () { paintChrome(); });

    document.addEventListener("keydown", function (e) {
      var meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (host && host.onUndo) host.onUndo(e.shiftKey);
        return;
      }
      if (e.key === "Escape") {
        if (editing) stopEdit();
        else select(null);
      }
      if (e.key === "Enter" && editing && sel && sel.tagName !== "P") {
        /* 标题里回车 = 结束编辑，别再拆块 */
        e.preventDefault();
        stopEdit();
      }
    });

    bindDrag();
    refreshNotes();

    /* 所有装饰先落笔，别让画布一半是空的 */
    setTimeout(function () {
      Array.prototype.forEach.call(
        prose.querySelectorAll(".circled, mark, .boxed, .flag"),
        function (el) {
          var cls = el.tagName === "MARK" ? "highlight" :
            el.classList.contains("circled") ? "circle" :
            el.classList.contains("boxed") ? "box" : null;
          if (cls && !el.__anno) addAnno(el, cls);
        }
      );
      Array.prototype.forEach.call(prose.querySelectorAll(".side-note"), function (n) {
        n.classList.add("is-shown", "is-written");
        var b = n.querySelector(".side-note__bracket");
        if (b && !b.__anno) addAnno(b, "bracket");
      });
    }, 120);

    document.addEventListener("input", function () {
      if (!editing) return;
    });
  }

  /* ---------------------------- 序列化 ---------------------------- */

  function clean(root) {
    Array.prototype.forEach.call(root.querySelectorAll("*"), function (n) {
      n.removeAttribute("contenteditable");
      n.removeAttribute("data-xb-editing");
      n.removeAttribute("spellcheck");
      if (n.tagName === "SVG" && n.classList.contains("rough-annotation")) { n.remove(); return; }
      if (n.classList.contains("xb-sel")) n.classList.remove("xb-sel");
      if (n.tagName === "MARK") n.classList.remove("mark-live");
      if (n.getAttribute && n.getAttribute("class") === "") n.removeAttribute("class");
      if (n.getAttribute("style") === "") n.removeAttribute("style");
      if (n.hasAttribute("style")) {
        var s = n.getAttribute("style")
          .replace(/(^|;)\s*position\s*:\s*relative\s*(?=;|$)/gi, "")
          .replace(/^;+/, "");
        if (!s.trim()) n.removeAttribute("style"); else n.setAttribute("style", s);
      }
    });
    /* parent.querySelectorAll 不含自身，单独处理一遍 */
    if (root.hasAttribute && root.hasAttribute("contenteditable")) {
      root.removeAttribute("contenteditable");
    }
  }

  function getBody() {
    if (editing) stopEdit();
    var clone = prose.cloneNode(true);
    Array.prototype.forEach.call(clone.querySelectorAll("svg.rough-annotation"), function (s) { s.remove(); });
    clean(clone);
    var out = [];
    Array.prototype.forEach.call(clone.children, function (n) {
      if (n.tagName === "HEADER") return;
      if (n.tagName === "STYLE" && n.id === THEME_ID) { if (n.textContent.trim()) out.push(n.outerHTML); return; }
      out.push(n.outerHTML);
    });
    return out.join("\n\n");
  }

  function setBody(html) {
    var keep = document.getElementById(THEME_ID);
    var themeHtml = keep ? keep.outerHTML : "";
    Array.prototype.forEach.call(blocks(), function (n) { n.remove(); });
    var tmp = document.createElement("div");
    tmp.innerHTML = html || "";
    Array.prototype.forEach.call(Array.prototype.slice.call(tmp.children), function (n) {
      prose.appendChild(n);
    });
    sel = null;
    refreshNotes();
    paintChrome();
  }

  /* ---------------------------- 提交（给父窗口做撤销） ---------------------------- */

  var commitTimer = null;

  function commit(reason) {
    if (!host || !host.onCommit) return;
    clearTimeout(commitTimer);
    commitTimer = setTimeout(function () {
      host.onCommit(getBody(), reason || "");
    }, 260);
  }

  /* ---------------------------- 对外接口 ---------------------------- */

  window.__xb = {
    ready: true,
    getBody: getBody,
    setBody: setBody,
    select: function (n) { select(n); },
    selectIndex: function (i) { select(blocks()[i] || null); },
    setStyle: setStyle,
    setTheme: applyTheme,
    setBlockTag: setBlockTag,
    setNoteText: setNoteText,
    addNote: addNote,
    toggle: function (kind) { toggleMark(kind); },
    insert: function (k) { if (sel) insert(k); },
    move: move,
    remove: removeSel,
    duplicate: duplicate,
    edit: function () { if (sel) startEdit(styleTarget(sel)); },
    info: function () { return sel ? inspect() : null; },
    scrollToSel: function () {
      if (sel) sel.scrollIntoView({ block: "center", behavior: "smooth" });
    },
    focus: function () { window.focus(); },
    blockCount: function () { return blocks().length; }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
