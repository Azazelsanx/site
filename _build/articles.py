#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成 articles/*.html
用法：python _build/articles.py
每篇文章 = 一个 dict，改完重跑即可。
"""
import os, re, pathlib
from string import Template

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "articles"

TPL = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — Azazel</title>
<meta name="description" content="${desc}">
<meta name="color-scheme" content="light">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect width='24' height='24' rx='5' fill='%23fdfdfc'/%3E%3Cpath d='M13.4 3 5.6 13.2h5L10.1 21l7.9-10.6h-5.2L13.4 3Z' fill='%23111'/%3E%3C/svg%3E">
<link rel="stylesheet" href="/styles.css">
</head>
<body>

<main class="shell">

  <a class="back" href="/">&larr; Azazel</a>

  <article class="prose">

    <header>
      <h1>${title}</h1>
      <time datetime="${iso}">${date}</time>
    </header>

${body}

  </article>

  <footer class="site-footer">
    <div class="site-footer__inner">
      <div class="site-footer__row">
        <p><a href="/">&larr; 回到首页</a></p>
        <a class="mark" href="https://github.com/Azazelsanx" target="_blank" rel="noopener noreferrer" aria-label="GitHub">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M13.4 2 5.2 13.4h5.1L9.6 22 18.8 10.5h-5.3L13.4 2Z"/>
          </svg>
        </a>
      </div>
    </div>
  </footer>

</main>

<script>
  // 跳到 #某处 时闪一块黄，五秒内褪掉。
  (function () {
    function highlight() {
      var id = decodeURIComponent(location.hash.slice(1));
      Array.prototype.forEach.call(
        document.querySelectorAll(".target"),
        function (n) { n.classList.remove("target"); }
      );
      if (!id) return;
      var target = document.getElementById(id);
      if (!target) return;
      void target.offsetWidth;
      target.classList.add("target");
      setTimeout(function () { target.classList.remove("target"); }, 5000);
    }
    highlight();
    window.addEventListener("hashchange", highlight);
  })();
</script>

<script src="/assets/vendor/rough-notation.js"></script>
<script src="/assets/js/marginalia.js"></script>

</body>
</html>
"""

ARTICLES = [
    {
        "slug": "promptbox",
        "title": "PromptBox",
        "date": "2026 年 10 月 18 日",
        "iso": "2026-10-18",
        "desc": "一个用来组织、版本化、复用提示词的桌面应用。",
        "body": """    <p>PromptBox 是给提示词用的桌面应用。不是「一个文本框加一个复制按钮」的那种记事本，而是把提示词当成有结构、有变量、有历史的文档来编辑。</p>

    <p>做它的理由很具体：我一直在手动做同一件事 —— 写一段长提示词，存一份副本，改三个词，再存一份副本，然后忘了到底是哪一份跑出了那个好结果。</p>

    <h2>问题的形状</h2>

    <p>一段提示词里有三种行为完全不同的东西，而文本编辑器把它们当成一回事：</p>

    <ul>
      <li><strong>固定文本</strong> —— 指令、语气、约束。写一次，之后很少动。</li>
      <li><strong>变量</strong> —— 每次都要换的槽位：一个产品名、一段代码、一组选项。</li>
      <li><strong>变体</strong> —— 分支。短的、长的、给那个希望语气更暖的客户的那一版。</li>
    </ul>

    <p>这三样一旦分开，后面很多事情就顺了：可以 diff 两个版本，看见变的只有某个变量；可以让一段积木在十个提示词里复用；可以拿一张表把同一个提示词渲染一百遍。<mark>分开之后，提示词才第一次成为一个可以被调用的东西，而不是一段被反复粘贴的文本。</mark></p>

    <h2>变量的两种形态</h2>

    <p>第一版只有一个扁平的变量列表：名字、类型、默认值。这覆盖了八九成的情况，剩下的那一两成把它撑破了。</p>

    <p>撑破它的是商品描述。一件衣服有颜色、尺码、面料，而每一种组合都是一个你可能会想单独生成的对象。扁平列表表达不了「这些值是一起走的」。</p>

    <p>于是现在有两种变量：</p>

    <ol>
      <li><strong>简单列表</strong> —— 彼此独立的值。选一个，得到一个。</li>
      <li><strong>SKU 组合</strong> —— 会相乘的维度。颜色 × 尺码 × 面料 铺出整张网格，可以按行逐条渲染。</li>
    </ol>

    <p>下游的东西 —— 预览、导出、运行记录 —— 都从同一个解析后的结构里读，所以两种形态不需要两套代码。</p>

    <blockquote>
      <p>我反复回到的一条规则是：变量不是「挖了洞的文本」，而是一条声明出来的依赖。依赖就该有类型。</p>
    </blockquote>

    <h2>它是怎么搭的</h2>

    <p>Electron、Vite、Vue 3、Naive UI、IndexedDB。默认本地优先：提示词存在你机器上的数据库里，断网也能用。没有账号，没有同步服务器，你写的东西没有到期日。</p>

    <p>花时间最长的偏偏是最看不见的部分 —— <span class="circled">一个不会丢任何一个按键的草稿自动保存</span>，一个能扛过重启的撤销栈，还有一个在两百条之后依然读得下去的版本列表。</p>

    <div class="noted">
      <p>图标是另一个小麻烦：提示词编辑器要用很多图标，而这套图标得像是同一只手画的。选择器直接搜 IconPark 全库，而不是<span class="note-anchor" data-note="icons" aria-describedby="note-icons">精挑二十个</span> —— 因为「客户投诉」对应的那个图标，从来不在精挑的二十个里面。</p>
      <aside class="side-note" id="note-icons" data-note-for="icons" role="note" tabindex="0">
        <span class="side-note__bracket" aria-hidden="true"></span>
        <span class="side-note__text">精挑的那二十个，永远差一个</span>
      </aside>
    </div>

    <h2>现在的位置</h2>

    <p>它是我每天都在用的工具，这也是我唯一相信的评测标准。接下来想解决的是「写完」和「知道它好不好」之间那段空档 —— 现在这个判断完全长在我脑子里。</p>
""",
    },
    {
        "slug": "variable-systems",
        "title": "不是模板，是变量系统",
        "date": "2026 年 9 月 2 日",
        "iso": "2026-09-02",
        "desc": "关于「填空」和「声明依赖」之间的区别。",
        "body": """    <p>模板和变量系统从外面看是一回事。两者都拿一段文本，都有空，都产出结果。区别要等到第十次修改才显出来。</p>

    <h2>模板是带洞的字符串</h2>

    <p>模板模型是这么说的：文本在这儿，空就在出现 <code>{</code> 的地方。一切都是字符串，一切都可以替换，唯一的结构就是字符碰巧排出来的顺序。</p>

    <p>这在需要「知道空是什么」之前一直好用。这个空是什么类型？必填吗？有默认值吗？可以为空吗？它和隔壁文件里的那个空是同一个吗？</p>

    <p><span class="circled">字符串一个都答不上来</span>，于是答案落到了你脑子里、注释里，或者一个叫 <code>{{PRODUCT_NAME_UPPER}}</code> 的命名约定里 —— 而总有一天有人会破掉它。</p>

    <h2>变量是一条声明</h2>

    <p>变量系统把空挪到别处 —— 挪到文本外面，一份你能读、能检查的列表里 —— 文本按名字引用它们。上面那些问题就都有答案了，而且答案是可以被查看的。</p>

    <p>两个后果比听起来重要：</p>

    <ul>
      <li><strong>校验成为可能。</strong>一个必填变量没有值，是渲染之前就能抓到的错误，而不是一个原样发给客户的 <code>{name}</code>。</li>
      <li><strong>复用变安全了。</strong>改一个变量名，所有用过它的提示词都知道 —— 因为名字是引用，不是巧合。</li>
    </ul>

    <h2>相乘的那种情况</h2>

    <p>扁平列表处理得了互相独立的值，一旦这些值成组出现就崩了 —— 一个商品变体是颜色 × 尺码 × 材质，每一种组合都可能是你想单独产出的对象。</p>

    <p>最省事的做法是一种组合一个变量，于是三十个变体变成三十个变量，和三十次打错字的机会。更好的做法是声明维度，让系统去取笛卡尔积。<mark>数量是算出来的，不是数出来的。</mark></p>

    <h2>换来的是什么</h2>

    <p>一旦变量被声明出来，提示词就不再是一份你编辑的文档，而是一个你调用的函数。整个转变就这么点事。你可以拿它对着表格的某一行渲染，跑两百次，缓存输出，再比较 —— 这些在「一段被粘进对话框的文本」上一样都做不到。</p>

    <blockquote>
      <p>把输入声明出来，输出自然会跟上。不声明，每一个新用法都要一段新的文本。</p>
    </blockquote>
""",
    },
    {
        "slug": "video2obsidian",
        "title": "Video2Obsidian",
        "date": "2026 年 4 月 21 日",
        "iso": "2026-04-21",
        "desc": "把视频变成 Obsidian 里带时间戳的笔记，全程本地。",
        "body": """    <p>我看大量长视频 —— 讲座、访谈、会议录像 —— 但几乎不做笔记。原因很蠢：给视频做笔记，意味着在播放器和文本编辑器之间来回拖进度条。</p>

    <p>Video2Obsidian 补的就是这道缝。给它一个文件，你在库里得到一篇笔记：转写稿按可读的段落切开，<span class="circled">每一段都能点回它被说出来的那一秒</span>。</p>

    <h2>为什么非得本地</h2>

    <p>每一家云端转写服务都把这件事做得很好，也每一家都想让音频上传到他们的服务器。可面对一段两小时的、不属于我的对话录音，讨论到此为止。</p>

    <p>所以整条流水线都在机器上跑：<code>ffmpeg</code> 抽音轨并归一化，<strong>Qwen3-ASR-0.6B</strong> 用显卡转写，一个本地小服务把 markdown 写进库。<mark>没有一帧数据离开这台机器。</mark></p>

    <h2>难受的几个地方</h2>

    <p><strong>断句。</strong>原始转写稿是一堵墙。它需要在句子边界断段，时间戳要打在段落开头，而不是每一行开头。</p>

    <p><strong>能真的跳过去的时间戳。</strong>Markdown 没有「跳到 00:14:32」这个概念。Media Extended 插件有，靠一种指向媒体文件加时间偏移的链接语法。所以每个段落都带一个插件认得的时间锚点，播放器嵌在笔记顶部。</p>

    <p><strong>消费级显卡上的 GPU。</strong>用 CPU 转写大约是一倍速，也就是两小时的视频要两小时。丢给独立显卡只要零头，但需要装对运行时，还需要一条「驱动更新把它搞挂了」时的退路。</p>

    <h2>产物长什么样</h2>

    <p>一篇笔记大致是这样：</p>

    <pre><code>![[recording.mp4]]

## 00:00:12
开场那个问题，转写并按句断好。

## 00:04:38
……以此类推，一段一个时间戳。</code></pre>

    <p>这个格式的意义在于：笔记在你读它之前就已经有用了 —— 可以搜它、可以从别的笔记链到某一段、或者点一个时间戳直接落在视频里的那个位置。</p>

    <p>它跑在一个本地端口上，只干一件事。这个产品就这么大。</p>
""",
    },
    {
        "slug": "local-first",
        "title": "本地优先这几件事",
        "date": "2025 年 11 月 20 日",
        "iso": "2025-11-20",
        "desc": "为什么我做的工具总是把数据留在你机器上。",
        "body": """    <p>我给自己做的每个工具最后都成了本地优先，而我花了很久才把它说清楚，说清楚的部分里没有「不想付服务器钱」。</p>

    <h2>延迟是一个功能</h2>

    <p>一个八毫秒给出答案的应用，和一个三百毫秒给出答案的应用，差别不在性能指标上。差别在于你会不会在思考的中途继续用它。<mark>一个会在你思路中间顿一下的工具，会被安静地弃用，然后你告诉自己本来也不需要它。</mark></p>

    <p>本地读取是即时的。没有转圈需要被设计绕着走，没有骨架屏，没有乐观更新要回滚。</p>

    <h2>所有权是一个功能</h2>

    <p>当数据是你磁盘上的文件，它就比应用活得久。你可以备份、可以 grep、可以用你本来就在用的方式同步、可以在十年后用文本编辑器打开。当数据是别人数据库里的行，它的寿命就是一个<span class="circled">你没有投票权的商业决策</span>。</p>

    <div class="noted">
      <p>我见过足够多的服务关停，所以不再把<span class="note-anchor" data-note="export" aria-describedby="note-export">「我们会提供导出」</span>当作承诺。<mark>导出总是比原来那个东西差。</mark></p>
      <aside class="side-note" id="note-export" data-note-for="export" role="note" tabindex="0">
        <span class="side-note__bracket" aria-hidden="true"></span>
        <span class="side-note__text">营业到最后一刻的通知，见过太多</span>
      </aside>
    </div>

    <h2>离线是一个功能</h2>

    <p>不是出于浪漫的理由，是出于最普通的理由：飞机上、高铁上、酒店 wifi 很烂的时候、路由器需要重启的时候。一个在网络断掉时就罢工的笔记工具，正好在你终于有时间用它的时候罢工。</p>

    <h2>代价，说实话</h2>

    <p>本地优先不是免费的。你要放弃：开箱即用的同步、不用想的多设备、分享一个链接、以及靠卖存储收订阅费的可能。两台设备编辑同一份东西的那一刻，冲突解决就成了你的问题，而 CRDT 是一笔实打实的工程税。</p>

    <p>对一台机器上的单用户工具来说，上面这些全是零。这就是我一直在做的取舍 —— 也是我每个项目都从「数据住在哪」开始，而不是从「表结构长什么样」开始的原因。</p>

    <blockquote>
      <p>先把存储这件事设计好。界面是跟着它走的，不是反过来。</p>
    </blockquote>
""",
    },
    {
        "slug": "pos",
        "title": "给店主做的收银机",
        "date": "2024 年 7 月 8 日",
        "iso": "2024-07-08",
        "desc": "给小店做收银软件，教会了我什么。",
        "body": """    <p>大多数软件的使用者是自己选的。而收银系统的使用者是在某个周二被人塞到手里、被告知「你用这个」的人 —— 而且<span class="circled">身后还排着队</span>。</p>

    <p>这个约束会把界面的每个决定都改一遍。</p>

    <h2>队伍就是设计任务书</h2>

    <p>每一次多余的点击都有目击者。一个在设计评审里看着无害的确认弹窗，就是三秒钟里一个陌生人在看你手忙脚乱。所以规则变成：<mark>常规交易应该是一段连续的动作，只有例外才值得占用注意力。</mark></p>

    <h2>数字不是装饰</h2>

    <div class="noted">
      <p>价格、数量、找零 —— 这些是扫一眼就要读出来的，从一个略微不正的角度，在日光灯下。<span class="note-anchor" data-note="tabular" aria-describedby="note-tabular">等宽数字、够大的字号、一行只放一个数</span>。任何让两个金额在快速扫视时看起来相似的设计都是 bug，不是风格选择。</p>
      <aside class="side-note" id="note-tabular" data-note-for="tabular" role="note" tabindex="0">
        <span class="side-note__bracket" aria-hidden="true"></span>
        <span class="side-note__text">这三条我抄进了之后的每个项目</span>
      </aside>
    </div>

    <h2><span class="boxed">错误就是界面</span></h2>

    <p>真正重要的状态，是没人去设计的那些：扫不出来的条码、系统里没有的商品、结账时短了的钱箱。店主不需要一条错误提示，他需要一个下一步动作。每一条失败路径都写成一个「人能照着做」的句子。</p>

    <h2>它还长出了什么</h2>

    <p>和收银台并行，这些店还需要一种方式，去做供应商反复索要的推广短片；还需要一个地方，存放那些被反复问到的问题的答案。于是又多了两个小工具，都遵守同一条规则：柜台后面那个人是站着的、赶时间的、不会去读提示文字。</p>

    <p>给这样的用户做东西之后，我此后设计的每一个界面都显得解释得太多了。</p>
""",
    },
]


def add_heading_ids(body):
    """给 <h2> 自动加 id，这样每个小节都能被 #锚点 链接命中并高亮。"""
    def repl(m):
        text = m.group(1)
        plain = re.sub(r"<[^>]+>", "", text)
        slug = re.sub(r"[^\w]+", "-", plain.lower()).strip("-")
        return '<h2 id="%s">%s</h2>' % (slug, text)
    return re.sub(r"<h2>(.*?)</h2>", repl, body, flags=re.S)


for a in ARTICLES:
    a = dict(a)
    a["body"] = add_heading_ids(a["body"])
    html = Template(TPL).substitute(**a)
    path = OUT / (a["slug"] + ".html")
    path.write_text(html, encoding="utf-8")
    print("wrote", path.relative_to(ROOT))
