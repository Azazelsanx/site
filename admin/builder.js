/* ==========================================================================
   编辑台 · 装修模式
   — 把文章塞进 iframe（真 CSS / 真手绘库），在画布里点选、拖动、改字
   — 右侧属性面板改完立刻生效；每次改动进撤销栈
   ========================================================================== */
(function () {
  "use strict";

  var CW = null;             /* canvas 里的 window */
  var frame, wrap, inspEl, inspEmpty, inspElem, inspTheme;
  var undoStack = [], redoStack = [];
  var lastBody = "";
  var onCommit = null;
  var theme = {
    bg: "", ink: "", measure: "", size: "", line: "", accent: "", font: ""
  };
  var ready = false;

  function $(s) { return document.querySelector(s); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  /* ---------------------------- 挂载 ---------------------------- */

  function mount(cfg) {
    frame = $("#cv");
    wrap = $("#canvas-wrap");
    inspElem = $("#insp-elem");
    inspEmpty = $("#insp-empty");
    if (!frame) return;

    window.__xbHost = {
      onReady: function () {
        CW = frame.contentWindow;
        ready = true;
        lastBody = CW.__xb.getBody();
        if (undoStack.length === 0) undoStack.push(lastBody);
        paintTheme();
        setStatus("画布就绪 · 点任意段落开始改", "ok");
      },
      onSelect: function (info) {
        renderInspector(info);
      },
      onCommit: function (body, reason) {
        pushUndo(body);
        lastBody = body;
        if (onCommit) onCommit(body, reason);
      },
      onUndo: function (isRedo) { isRedo ? redo() : undo(); },
      onScroll: function () {}
    };

    frame.srcdoc = doc(cfg);
  }

  function doc(cfg) {
    var body = cfg.body && cfg.body.trim()
      ? cfg.body
      : "<p>从这段开始写。双击就能改字。</p>";
    return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<base href="/">' +
      '<link rel="stylesheet" href="/styles.css">' +
      '<style>html{scroll-padding-top:60px}' +
      '.prose *[contenteditable="true"]{outline:none;box-shadow:0 0 0 3px rgba(47,111,237,.12)}' +
      '::selection{background:rgba(47,111,237,.22)}</style>' +
      '</head><body><main class="shell"><article class="prose">' +
      '<header><h1>' + esc(cfg.title || "无标题") + "</h1>" +
      "<time datetime=\"" + esc(cfg.iso || "") + "\">" + esc(cfg.date || "") + "</time></header>" +
      body +
      "</article></main>" +
      '<script src="/assets/vendor/rough-notation.js"><\/script>' +
      '<script src="/assets/js/marginalia.js"><\/script>' +
      '<script src="/admin/canvas.js"><\/script>' +
      "</body></html>";
  }

  /* 标题/日期改了不用重载画布，直接改 iframe 头 */
  function setHeader(title, date) {
    if (!CW || !CW.document) return;
    var h1 = CW.document.querySelector(".prose header h1");
    var t = CW.document.querySelector(".prose header time");
    if (h1) h1.textContent = title || "无标题";
    if (t) t.textContent = date || "";
  }

  function body() {
    if (CW && CW.__xb) lastBody = CW.__xb.getBody();
    return lastBody;
  }

  /* ---------------------------- 撤销 ---------------------------- */

  function pushUndo(body) {
    if (undoStack.length && undoStack[undoStack.length - 1] === body) return;
    undoStack.push(body);
    if (undoStack.length > 80) undoStack.shift();
    redoStack.length = 0;
    paintUndo();
  }

  function undo() {
    if (undoStack.length < 2) return;
    redoStack.push(undoStack.pop());
    var body = undoStack[undoStack.length - 1];
    CW.__xb.setBody(body);
    lastBody = body;
    if (onCommit) onCommit(body, "undo");
    paintUndo();
  }

  function redo() {
    if (!redoStack.length) return;
    var body = redoStack.pop();
    undoStack.push(body);
    CW.__xb.setBody(body);
    lastBody = body;
    if (onCommit) onCommit(body, "redo");
    paintUndo();
  }

  function paintUndo() {
    var u = $("#undo"), r = $("#redo");
    if (u) u.disabled = undoStack.length < 2;
    if (r) r.disabled = !redoStack.length;
  }

  /* ---------------------------- 属性面板 ---------------------------- */

  function row(label, prop, opts) {
    var o = opts || {};
    var min = o.min != null ? o.min : 0, max = o.max != null ? o.max : 100;
    var step = o.step != null ? o.step : 1;
    return '<div class="ctl">' +
      '<span class="ctl__k">' + label + "</span>" +
      '<input class="ctl__range" type="range" min="' + min + '" max="' + max +
      '" step="' + step + '" value="' + o.value + '" data-prop="' + prop + '">' +
      '<output class="ctl__v" data-out="' + prop + '">' + o.value + (o.unit || "") + "</output>" +
      "</div>";
  }

  function seg(label, prop, items, active) {
    return '<div class="ctl">' +
      '<span class="ctl__k">' + label + "</span>" +
      '<div class="seg" data-prop="' + prop + '">' +
      items.map(function (it) {
        return '<button class="seg__b' + (it[0] === active ? " on" : "") +
          '" data-val="' + it[0] + '" title="' + (it[2] || it[1]) + '">' + it[1] + "</button>";
      }).join("") +
      "</div></div>";
  }

  function renderInspector(info) {
    if (!inspElem) return;
    if (!info) {
      inspElem.hidden = true;
      inspEmpty.hidden = false;
      return;
    }
    inspElem.hidden = false;
    inspEmpty.hidden = true;

    var s = info.style;
    var isn = info.note;
    var html = "";

    html += '<div class="insp-tag">' + esc(info.label) + "</div>";

    html += '<div class="insp-sec"><h4>块</h4>' +
      '<div class="seg seg--block" data-prop="tag">' +
      ["p|段落", "h2|小标题", "h3|次标题", "blockquote|引用"].map(function (it) {
        var t = it.split("|");
        var on = (info.tag === t[0]) ||
          (t[0] === "h2" && info.tag === "h2") ? " on" : "";
        return '<button class="seg__b' + (info.tag === t[0] ? " on" : "") +
          '" data-val="' + t[0] + '">' + t[1] + "</button>";
      }).join("") + "</div></div>";

    html += '<div class="insp-sec"><h4>文字</h4>' +
      row("字号", "fontSize", { min: 11, max: 38, step: 0.5, value: s.fontSize, unit: "px" }) +
      row("行高", "lineHeight", { min: 1.1, max: 2.4, step: 0.05, value: s.lineHeight }) +
      row("字距", "letterSpacing", { min: -0.5, max: 2, step: 0.05, value: s.letterSpacing, unit: "px" }) +
      seg("字重", "fontWeight", [["300", "细"], ["400", "常规"], ["600", "半粗"], ["700", "粗"]], s.fontWeight) +
      seg("对齐", "textAlign", [["left", "左"], ["center", "中"], ["right", "右"], ["justify", "两端"]], s.textAlign) +
      seg("字体", "fontFamily", [["sans", "无衬线"], ["serif", "宋"], ["hand", "手写"], ["mono", "等宽"]], s.fontFamily) +
      '<div class="ctl"><span class="ctl__k">颜色</span>' +
      '<input class="ctl__color" type="color" value="' + s.color + '" data-prop="color">' +
      '<button class="mini" data-act="clear-color">默认</button></div>' +
      "</div>";

    html += '<div class="insp-sec"><h4>间距</h4>' +
      row("段前", "marginTop", { min: 0, max: 96, step: 2, value: s.marginTop, unit: "px" }) +
      row("段后", "marginBottom", { min: 0, max: 96, step: 2, value: s.marginBottom, unit: "px" }) +
      row("缩进", "textIndent", { min: 0, max: 4, step: 0.5, value: +(s.textIndent / s.fontSize).toFixed(2), unit: "em" }) +
      "</div>";

    html += '<div class="insp-sec"><h4>手绘装饰</h4><div class="marks">' +
      '<button class="mark-btn' + (info.marks.highlight ? " on" : "") + '" data-act="mark">' +
      '<i style="background:rgba(252,231,118,.95)"></i>荧光笔</button>' +
      '<button class="mark-btn' + (info.marks.circle ? " on" : "") + '" data-act="circle">' +
      '<i style="background:transparent;box-shadow:inset 0 0 0 1.5px #555;border-radius:50%"></i>手绘圈</button>' +
      '<button class="mark-btn' + (info.marks.box ? " on" : "") + '" data-act="box">' +
      '<i style="background:transparent;box-shadow:inset 0 0 0 1.5px #c43a30"></i>红方框</button>' +
      '<button class="mark-btn" data-act="add-note">＋ 页边批注</button>' +
      "</div>" +
      (isn ? '<label class="field field--tight"><span>旁批内容</span>' +
        '<textarea class="input input--area" id="note-text" rows="2">' + esc(isn.text) + "</textarea></label>" +
        '<button class="btn btn--block btn--sm" id="note-apply">应用旁批</button>' : "") +
      "</div>";

    html += '<div class="insp-sec"><h4>顺序</h4><div class="btnrow">' +
      '<button class="btn btn--sm" data-act="up">↑ 上移</button>' +
      '<button class="btn btn--sm" data-act="down">↓ 下移</button>' +
      '<button class="btn btn--sm" data-act="dup">复制</button>' +
      '<button class="btn btn--sm btn--danger" data-act="del">删除</button>' +
      "</div>" +
      '<div class="btnrow" style="margin-top:.4rem">' +
      ["p|＋ 段落", "h2|＋ 小标题", "ul|＋ 列表", "quote|＋ 引用", "code|＋ 代码", "img|＋ 图片"]
        .map(function (it) {
          var t = it.split("|");
          return '<button class="btn btn--sm" data-ins="' + t[0] + '">' + t[1] + "</button>";
        }).join("") +
      "</div></div>";

    inspElem.innerHTML = html;
  }

  /* 面板事件（委托） */
  function bindInspector() {
    if (!inspElem) return;

    inspElem.addEventListener("input", function (e) {
      var t = e.target;
      if (t.dataset.prop === "color") {
        CW.__xb.setStyle({ color: t.value });
        return;
      }
      if (t.dataset.prop) {
        var v = parseFloat(t.value);
        var out = inspElem.querySelector('[data-out="' + t.dataset.prop + '"]');
        if (out) {
          var unit = /Indent/.test(t.dataset.prop) ? "em" : /Size|Top|Bottom|Spacing|Width/.test(t.dataset.prop) ? "px" : "";
          out.textContent = t.value + unit;
        }
        if (t.dataset.prop === "textIndent") {
          var info = CW.__xb.info();
          v = v * (info ? info.style.fontSize : 15);
        }
        var patch = {};
        patch[t.dataset.prop] = v;
        CW.__xb.setStyle(patch);
      }
    });

    inspElem.addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b) return;

      if (b.dataset.val != null) {
        var prop = b.parentNode.dataset.prop;
        if (prop === "tag") {
          CW.__xb.setBlockTag(b.dataset.val);
        } else {
          var p = {};
          p[prop] = b.dataset.val;
          CW.__xb.setStyle(p);
          Array.prototype.forEach.call(b.parentNode.children, function (x) {
            x.classList.toggle("on", x === b);
          });
        }
        return;
      }

      if (b.dataset.ins) { CW.__xb.insert(b.dataset.ins); return; }

      switch (b.dataset.act) {
        case "mark": CW.__xb.toggle("highlight"); break;
        case "circle": CW.__xb.toggle("circle"); break;
        case "box": CW.__xb.toggle("box"); break;
        case "up": CW.__xb.move(-1); break;
        case "down": CW.__xb.move(1); break;
        case "dup": CW.__xb.duplicate(); break;
        case "del": CW.__xb.remove(); break;
        case "clear-color": CW.__xb.setStyle({ color: "" }); break;
        case "add-note": {
          var txt = window.prompt("旁批写什么？（留空则不写）", "");
          if (txt) CW.__xb.addNote(txt);
          break;
        }
      }
    });

    document.addEventListener("click", function (e) {
      if (e.target.id === "note-apply") {
        var box = $("#note-text");
        if (box && CW) CW.__xb.setNoteText(box.value.trim());
        setStatus("旁批已改", "ok");
      }
    });
  }

  /* ---------------------------- 主题 ---------------------------- */

  function bindTheme() {
    inspTheme = $("#insp-theme");
    if (!inspTheme) return;
    inspTheme.addEventListener("input", function (e) {
      var k = e.target.dataset.theme;
      if (!k) return;
      theme[k] = e.target.value;
      apply();
    });
    inspTheme.addEventListener("click", function (e) {
      if (!e.target.dataset.reset) return;
      theme = { bg: "", ink: "", measure: "", size: "", line: "", accent: "", font: "" };
      paintTheme();
      apply();
    });
  }

  function apply() {
    if (!CW || !CW.__xb) return;
    CW.__xb.setTheme({
      bg: theme.bg || "", ink: theme.ink || "",
      measure: theme.measure || "", size: theme.size || "",
      line: theme.line || "", accent: theme.accent || "",
      font: theme.font || ""
    });
  }

  /* 从现有内联 style 里还原主题控件的值 */
  function paintTheme() {
    if (!inspTheme) return;
    Array.prototype.forEach.call(inspTheme.querySelectorAll("[data-theme]"), function (input) {
      if (theme[input.dataset.theme]) input.value = theme[input.dataset.theme];
    });
    Array.prototype.forEach.call(inspTheme.querySelectorAll("[data-theme-out]"), function (o) {
      var k = o.dataset.themeOut;
      o.textContent = theme[k] || o.dataset.def || "";
    });
  }

  /* ---------------------------- 设备 ---------------------------- */

  function setDevice(w) {
    if (!wrap) return;
    wrap.dataset.device = w;
    Array.prototype.forEach.call(document.querySelectorAll("[data-dev]"), function (b) {
      b.classList.toggle("on", b.dataset.dev === String(w));
    });
    if (CW) setTimeout(function () { CW.dispatchEvent(new Event("resize")); }, 260);
  }

  /* ---------------------------- 导出 ---------------------------- */

  window.Builder = {
    mount: mount,
    body: body,
    setHeader: setHeader,
    undo: undo,
    redo: redo,
    setDevice: setDevice,
    resetHistory: function (b) {
      undoStack = [b];
      redoStack = [];
      lastBody = b;
      paintUndo();
    },
    onCommit: function (fn) { onCommit = fn; },
    isReady: function () { return ready; },
    command: function (name, arg) {
      if (!CW || !CW.__xb) return;
      if (typeof CW.__xb[name] === "function") CW.__xb[name](arg);
    }
  };

  document.addEventListener("DOMContentLoaded", function () {
    bindInspector();
    bindTheme();
    paintUndo();
  });
})();

function setStatus(t, k) {
  if (window.App && window.App.status) window.App.status(t, k);
}
