/* ==========================================================================
   手绘标记层
   — 描边全部交给 Rough Notation（rough.js 引擎）：圈、荧光笔、方框、方括号
   — 库自己插 SVG、自己算 stroke-dasharray，本文件只负责“什么时候画”
   — 多行文字靠 multiline: true 让库按行盒各画一遍
   ========================================================================== */
(function () {
  "use strict";

  var RN = window.RoughNotation;
  if (!RN) return;

  var reduce =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* 墨色：压到半透明，笔迹压在字上也不脏 */
  var INK = "rgba(24, 24, 24, 0.55)";
  var HILITE = "rgba(252, 231, 118, 0.85)";
  var PINK = "rgba(215, 46, 145, 0.62)";
  var RED = "rgba(196, 58, 48, 0.6)";

  function make(el, opts) {
    var cfg = {
      animate: !reduce,
      animationDuration: 820,
      strokeWidth: 1.1,
      padding: 5
    };
    for (var k in opts) cfg[k] = opts[k];
    var anno = RN.annotate(el, cfg);
    el.__anno = anno;
    return anno;
  }

  /* ---------- 1. 正文里的标记 ---------- */

  var marks = []; /* { el, anno } */

  function mark(el, opts) {
    marks.push({ el: el, anno: make(el, opts) });
  }

  /* 手绘圈：关键词 */
  [].slice.call(document.querySelectorAll(".circled")).forEach(function (el) {
    mark(el, {
      type: "circle",
      color: INK,
      padding: [7, 9],
      multiline: true,
      animationDuration: 880
    });
  });

  /* 荧光笔：<mark> 先有 CSS 渐变兜底，JS 接手后交给库涂 */
  [].slice.call(document.querySelectorAll("mark")).forEach(function (el) {
    el.classList.add("mark-live");
    mark(el, {
      type: "highlight",
      color: HILITE,
      padding: 1,
      multiline: true,
      animationDuration: 620
    });
  });

  /* 红笔方框 */
  [].slice.call(document.querySelectorAll(".boxed")).forEach(function (el) {
    mark(el, {
      type: "box",
      color: RED,
      strokeWidth: 1.15,
      padding: [2, 4],
      multiline: true,
      animationDuration: 700
    });
  });

  /* 首页那条新文章的粉圈 */
  [].slice.call(document.querySelectorAll(".flag")).forEach(function (el) {
    mark(el, {
      type: "circle",
      color: PINK,
      strokeWidth: 1.2,
      padding: [4, 7],
      animationDuration: 620
    });
  });

  /* 同一段里有多处标记时，一笔接一笔地播 */
  marks.forEach(function (item, i) {
    var host = item.el.parentElement;
    var order = 0;
    for (var j = 0; j < i; j++) {
      if (marks[j].el.parentElement === host) order++;
    }
    item.order = order;
  });

  function paint(item) {
    if (item.shown) return;
    item.shown = true;
    setTimeout(function () {
      item.anno.show();
    }, (item.order || 0) * 150);
  }

  function inView(el) {
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.bottom > 0 && r.top < window.innerHeight;
  }

  /* 字体换完、布局稳定后再扫一遍：已经在视口里的直接画，
     免得观察器在加载瞬间漏掉折叠线附近的那几个 */
  function sweep() {
    marks.forEach(function (item) {
      if (!item.shown && inView(item.el)) paint(item);
    });
  }

  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          io.unobserve(entry.target);
          if (entry.target.__mark) paint(entry.target.__mark);
        });
      },
      { threshold: 0.6, rootMargin: "0px 0px -6% 0px" }
    );
    marks.forEach(function (item) {
      item.el.__mark = item;
      io.observe(item.el);
    });
  } else {
    marks.forEach(paint);
  }

  window.addEventListener("load", sweep);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(sweep);
  setTimeout(sweep, 900);

  /* ---------- 2. 页边批注 ---------- */

  [].slice.call(document.querySelectorAll(".side-note")).forEach(function (note) {
    var id = note.getAttribute("data-note-for");
    var anchor = id
      ? document.querySelector('.note-anchor[data-note="' + id + '"]')
      : null;
    var bracketEl = note.querySelector(".side-note__bracket");
    var bracket = bracketEl
      ? make(bracketEl, {
          type: "bracket",
          brackets: ["left"],
          color: "currentColor",
          strokeWidth: 1.25,
          padding: [6, 0, 6, 6],
          animationDuration: 420
        })
      : null;

    var pinned = false;
    var glow = null;

    function lit(on) {
      note.classList.toggle("is-lit", on);
      if (!anchor) return;
      if (on) {
        if (!glow) {
          glow = make(anchor, {
            type: "highlight",
            color: HILITE,
            padding: 1,
            multiline: true,
            animationDuration: 380
          });
        }
        if (!glow.isShowing()) glow.show();
      } else if (glow && !pinned) {
        glow.hide();
      }
    }

    function enter() {
      lit(true);
    }
    function leave() {
      if (!pinned) lit(false);
    }

    note.addEventListener("pointerenter", enter);
    note.addEventListener("pointerleave", leave);
    note.addEventListener("focus", enter);
    note.addEventListener("blur", leave);
    note.addEventListener("click", function () {
      pinned = !pinned;
      lit(pinned);
    });

    if (anchor) {
      anchor.addEventListener("pointerenter", enter);
      anchor.addEventListener("pointerleave", leave);
      anchor.addEventListener("focus", enter);
      anchor.addEventListener("blur", leave);
      anchor.addEventListener("click", function (e) {
        e.preventDefault();
        pinned = !pinned;
        lit(pinned);
      });
    }

    /* 方括号先落笔，字跟着写出来 */
    note.__write = function () {
      note.classList.add("is-shown");
      if (reduce) {
        note.classList.add("is-written");
        if (bracket) bracket.show();
        return;
      }
      setTimeout(function () {
        if (bracket) bracket.show();
      }, 100);
      setTimeout(function () {
        note.classList.add("is-written");
      }, 380);
    };
  });

  var notes = [].slice.call(document.querySelectorAll(".side-note"));

  if ("IntersectionObserver" in window) {
    var noteIO = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          noteIO.unobserve(entry.target);
          entry.target.classList.remove("is-armed");
          if (entry.target.__write) entry.target.__write();
        });
      },
      { threshold: 0.85, rootMargin: "0px 0px -8% 0px" }
    );
    notes.forEach(function (n) {
      n.classList.add("is-armed");
      noteIO.observe(n);
    });
  } else {
    notes.forEach(function (n) {
      if (n.__write) n.__write();
    });
  }

  /* 保险：观察器没回话时，已经滚到眼前就直接放出来 */
  setTimeout(function () {
    notes.forEach(function (n) {
      if (n.classList.contains("is-shown")) return;
      var r = n.getBoundingClientRect();
      if (r.top < window.innerHeight && r.bottom > 0) {
        n.classList.remove("is-armed");
        if (n.__write) n.__write();
      }
    });
  }, 1500);

  /* 保险：万一某个环境里 CSS 动画没被推进（路径停在未描出状态），
     到点直接补齐线，绝不留一块空白 */
  setTimeout(function () {
    var paths = document.querySelectorAll(".rough-annotation path");
    for (var i = 0; i < paths.length; i++) {
      var off = parseFloat(window.getComputedStyle(paths[i]).strokeDashoffset) || 0;
      if (off > 0.5) {
        paths[i].style.strokeDashoffset = "0";
        paths[i].style.animation = "none";
      }
    }
  }, 2600);
})();
