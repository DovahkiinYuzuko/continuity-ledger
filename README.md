# 積んでたら台帳 / Continuity Ledger

![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=flat-square&logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=flat-square&logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=black)

「指定した金額を指定した間隔で貯め続けていたら、今頃いくらになっていたか」を淡々と表示するだけのカレンダーアプリ / A retrospective calendar app that calculates how much money you would have accumulated today had you consistently saved a fixed amount at a regular interval.

[日本語](#日本語) | [English](#english)

---

## 日本語

### これは何をするアプリか

「もしあの日から、指定した金額を指定した間隔で貯金し続けていたら」という仮定のもと、今日時点での到達額をカレンダー上に表示するだけのアプリです。

目標に対する進捗や達成度を煽る要素は一切ありません。実際に貯金したかどうかとは無関係に、「継続していたと仮定した場合の事実」をただ淡々と積み上げて見せることだけを目的としています。複数の仮定（シナリオ）を並べて登録できるので、「もし1月から始めていたら」と「もし今月から始めていたら」を並べて眺める、といった使い方ができます。

臨時収入などの単発の入金を割り込みとして記録したり、後から金額や間隔を編集したりもできます。年間を通じた記帳の推移は、月ごとのカレンダーに加えて12ヶ月分のミニカレンダーでも一望できます。

### できること

シナリオごとに開始日・金額・間隔（n日ごと、毎月d日、毎月末日）を設定して記帳し、複数のシナリオを同時に比較できます。任意の日への割り込み入金の記録、CSVやJSONでの書き出し、JSONからの読み込みによるバックアップの復元、URLを使ったシナリオ単体の共有にも対応しています。色タグはプリセットに加えて自由な色を追加でき、通知機能を使えば画面を開いている間だけ入金日のリマインドを受け取ることもできます。
さらに、既存シナリオのワンクリック複製、目標金額到達予定日の淡々とした逆算試算、HTML5 Canvasによる積み上がり推移チャートの可視化、日本語/英語（i18n）の自動切り替えに対応しています。

### 技術的な特徴

金額の計算はすべて固定小数点のBigIntで行っており、JavaScriptの`Number`型に起因する桁あふれや丸め誤差は発生しません。データは端末のlocalStorageにのみ保存され、外部サーバーへの送信は行いません。フレームワークを使用しない素のHTML・CSS・JavaScript（ES Modules分割構成）で構成されており、静的ホスティング（GitHub Pages / Vercelなど）へ直接配置して動作します。

### LICENSE
Third-Party → [NOTICE.md](./NOTICE.md)

---

## English

### What this app does

This app shows, on a calendar, how much money you would have today under the assumption that you had kept saving a fixed amount at a fixed interval since a given date.

It contains no elements that push you toward a goal or celebrate progress. Regardless of whether you actually saved anything, it simply states, as a fact, what the running total would be under that assumption. You can register several such assumptions (scenarios) side by side, which makes it easy to compare, for example, "if I had started in January" against "if I start this month."

You can also record one-off deposits, such as windfalls, as interruptions to a scenario, and edit the amount or interval later. Beyond the monthly calendar, a 12-month mini-calendar view lets you see the whole year's pattern of deposit days at a glance.

### What you can do with it

For each scenario, you can set a start date, an amount, and an interval (every n days, a fixed day of each month, or the last day of each month), and compare multiple scenarios side by side. The app also supports recording ad-hoc deposits on any date, exporting to CSV or JSON, restoring from a JSON backup, and sharing a single scenario via URL. Color tags include presets as well as freely added custom colors, and browser notifications can remind you of deposit days while the page is open.
Additionally, it supports one-click scenario duplication, reach-date estimation for optional target amounts, accumulation trend visualization with HTML5 Canvas, and automatic localization (i18n) for Japanese and English.

### Technical notes

All monetary calculations use fixed-point arithmetic on `BigInt`, avoiding the overflow and rounding errors inherent to JavaScript's `Number` type. All data is stored only in the browser's `localStorage`; nothing is sent to any external server. The app is built with plain HTML, CSS, and JavaScript (modularized with ES Modules) with no build framework required, ready to be hosted directly on static hosts like GitHub Pages or Vercel.

### LICENSE
Third-Party → [NOTICE.md](./NOTICE.md)

