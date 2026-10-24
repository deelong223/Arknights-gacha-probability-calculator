/* i18n.js — 三語字典（zh-TW / zh-CN / en）
   規則：所有 key 在三種語言都必須存在（tests/check-i18n.js 會驗證）。 */
(function (root) {
  'use strict';

  var RULES = {};          // 先宣告，稍後填入
  var DICT = {};

  // ---------------------------------------------------------------- 繁體中文
  DICT['zh-TW'] = {
    'app.title': '終末地抽卡計算機',
    'app.tagline': 'Arknights: Endfield · 特許尋訪機率',
    'nav.rules': '抽卡規則',
    'nav.lang': '語言',
    'btn.calculate': '計算機率',
    'btn.calculating': '計算中…',
    'btn.reset': '重設',

    'panel.input': '條件設定',
    'label.pity': '目前保底水位',
    'hint.pity': '0–79：連續幾抽沒出 6★',
    'label.budget': '可用抽數',
    'hint.budget': '0–5000',
    'label.threshold': '續抽門檻',
    'hint.threshold': '達標後若已抽 ≥ 此抽數，就補到 60 抽賺情報書',
    'label.targets': '各期目標張數',
    'hint.targets': '0 = 跳過該期、1 = 只要一張、最多 6',
    'banner.n': '第 {n} 期',

    'panel.result': '成功率',
    'result.placeholder': '輸入條件後按「計算機率」',
    'result.caption': '達成全部目標的機率',
    'result.summary': '{banners} 期 · 共 {targets} 張 · 預算 {budget} 抽',
    'result.none': '—',

    'stats.title': '統計',
    'stats.mean': '平均抽數',
    'stats.median': '中位數',
    'stats.p90': 'P90',
    'stats.sub': '第一期 · 目標 {target} 張',
    'stats.marginal': '邊際效益',
    'stats.marginalText': '再 {n} 抽 +{d} pp',
    'stats.marginalEmpty': '已接近必得',
    'unit.pull': '抽',

    'chart.curve.title': '成功率累積曲線',
    'chart.curve.desc': '橫軸抽數 · 縱軸達成全部目標的機率（可點擊圖表調整預算）',
    'chart.cost.title': '各期達標抽數',
    'chart.cost.desc': '長條為中位數、橫線為 P10–P90、白點為平均',
    'chart.empty': '先按「計算機率」',
    'chart.tip': '{x} 抽 · {y}%',
    'chart.estimating': '估算中…',

    'share.title': '分享',
    'share.copyText': '複製結果',
    'share.copyImage': '複製圖片',
    'share.download': '下載 PNG',
    'share.copyLink': '複製連結',
    'share.copied': '已複製到剪貼簿',
    'share.failed': '複製失敗，已改為下載',
    'share.imageTitle': '終末地抽卡計算機',

    'rules.title': '抽卡規則',
    'rules.close': '關閉',
    'rules.note': '以 2026/10 現行版本（丹青渡）為準；官方日後調整請以遊戲內公告為準。',

    'footer.credit': '非官方工具 · 機率為數學模型推算，僅供參考',
  };

  RULES['zh-TW'] = [
    {
      h: '干員尋訪基礎機率',
      items: [
        '6★ 0.80%、5★ 8.00%、4★ 91.20%。',
        '每 10 次尋訪必定包含 5★ 以上干員。',
        '每抽獲得武庫配額：6★ 2000、5★ 200、4★ 20。',
      ],
    },
    {
      h: '小保底（跨池繼承）',
      items: [
        '連續 65 抽沒出 6★ → 第 66 抽起每抽機率 +5 個百分點（第 79 抽為 70.8%）。',
        '第 80 抽必定獲得 6★ 干員。',
        '保底水位會繼承到下一次「特許尋訪」。',
        '抽到的 6★ 有 50% 是當期 UP；歪掉之後下一次仍為 50%（沒有補正）。',
      ],
    },
    {
      h: '大保底（不繼承）',
      items: [
        '同一期累計第 120 抽，若尚未取得當期 UP，該抽必定為 UP 6★。',
        '每期只生效一次，抽到 UP 後即失效，且不繼承到下一期。',
        '因此「墊水位」只墊小保底，大保底每期都要重新累計。',
      ],
    },
    {
      h: '累計尋訪獎勵',
      items: [
        '30 抽：送同池 10 次「加急招募」，只吃基礎機率，不計保底、也不計累計次數。',
        '60 抽：【尋訪情報書】→ 下一期特許尋訪專屬十連（會計入下期保底；跳過該期就作廢）。',
        '每累計 240 抽：當期 UP 干員【信物】×1（240／480／720… 可重複）。',
      ],
    },
    {
      h: '武器池「武庫申領」（本工具未收錄）',
      items: [
        '一次申領消耗 1980 武庫配額，一次給 10 件武器，必定包含 5★ 以上。',
        '6★ 武器基礎 4%；每 4 次申領（40 抽）必 6★、每 8 次申領（80 抽）必當期 UP。',
        '累計獎勵交替給【補充武庫箱】與【UP 6★ 武器】，每期清零不繼承。',
      ],
    },
    {
      h: '這個工具的模型',
      items: [
        '情報書只作用於「緊接著的下一期」，中間若跳過該期就視為作廢。',
        '沒有「本期已累計抽數」欄位：120 大保底與 240 信物一律從本期第 0 抽算起。',
        '復刻混池「輝光慶典」（保底獨立、120 抽自選）規則不同，目前不支援。',
        '續抽門檻是策略參數：達標後要不要補到 60 抽換情報書，實測最佳區間約 45–50。',
      ],
    },
  ];

  // ---------------------------------------------------------------- 简体中文
  DICT['zh-CN'] = {
    'app.title': '终末地抽卡计算器',
    'app.tagline': 'Arknights: Endfield · 特许寻访概率',
    'nav.rules': '抽卡规则',
    'nav.lang': '语言',
    'btn.calculate': '计算概率',
    'btn.calculating': '计算中…',
    'btn.reset': '重置',

    'panel.input': '条件设置',
    'label.pity': '当前保底水位',
    'hint.pity': '0–79：连续几抽没出 6★',
    'label.budget': '可用抽数',
    'hint.budget': '0–5000',
    'label.threshold': '续抽阈值',
    'hint.threshold': '达标后若已抽 ≥ 此抽数，就补到 60 抽拿情报书',
    'label.targets': '各期目标张数',
    'hint.targets': '0 = 跳过该期、1 = 只要一张、最多 6',
    'banner.n': '第 {n} 期',

    'panel.result': '成功率',
    'result.placeholder': '输入条件后按「计算概率」',
    'result.caption': '达成全部目标的概率',
    'result.summary': '{banners} 期 · 共 {targets} 张 · 预算 {budget} 抽',
    'result.none': '—',

    'stats.title': '统计',
    'stats.mean': '平均抽数',
    'stats.median': '中位数',
    'stats.p90': 'P90',
    'stats.sub': '第一期 · 目标 {target} 张',
    'stats.marginal': '边际收益',
    'stats.marginalText': '再 {n} 抽 +{d} pp',
    'stats.marginalEmpty': '已接近必得',
    'unit.pull': '抽',

    'chart.curve.title': '成功率累积曲线',
    'chart.curve.desc': '横轴抽数 · 纵轴达成全部目标的概率（可点击图表调整预算）',
    'chart.cost.title': '各期达标抽数',
    'chart.cost.desc': '长条为中位数、横线为 P10–P90、白点为平均',
    'chart.empty': '先按「计算概率」',
    'chart.tip': '{x} 抽 · {y}%',
    'chart.estimating': '估算中…',

    'share.title': '分享',
    'share.copyText': '复制结果',
    'share.copyImage': '复制图片',
    'share.download': '下载 PNG',
    'share.copyLink': '复制链接',
    'share.copied': '已复制到剪贴板',
    'share.failed': '复制失败，已改为下载',
    'share.imageTitle': '终末地抽卡计算器',

    'rules.title': '抽卡规则',
    'rules.close': '关闭',
    'rules.note': '以 2026/10 现行版本（丹青渡）为准；官方日后调整请以游戏内公告为准。',

    'footer.credit': '非官方工具 · 概率为数学模型推算，仅供参考',
  };

  RULES['zh-CN'] = [
    {
      h: '干员寻访基础概率',
      items: [
        '6★ 0.80%、5★ 8.00%、4★ 91.20%。',
        '每 10 次寻访必定包含 5★ 以上干员。',
        '每抽获得武库配额：6★ 2000、5★ 200、4★ 20。',
      ],
    },
    {
      h: '小保底（跨池继承）',
      items: [
        '连续 65 抽没出 6★ → 第 66 抽起每抽概率 +5 个百分点（第 79 抽为 70.8%）。',
        '第 80 抽必定获得 6★ 干员。',
        '保底水位会继承到下一次「特许寻访」。',
        '抽到的 6★ 有 50% 是当期 UP；歪了之后下一次仍为 50%（没有补正）。',
      ],
    },
    {
      h: '大保底（不继承）',
      items: [
        '同一期累计第 120 抽，若尚未取得当期 UP，该抽必定为 UP 6★。',
        '每期只生效一次，抽到 UP 后即失效，且不继承到下一期。',
        '所以「垫水位」只垫小保底，大保底每期都要重新累计。',
      ],
    },
    {
      h: '累计寻访奖励',
      items: [
        '30 抽：送同池 10 次「加急招募」，只吃基础概率，不计保底、也不计累计次数。',
        '60 抽：【寻访情报书】→ 下一期特许寻访专属十连（会计入下期保底；跳过该期就作废）。',
        '每累计 240 抽：当期 UP 干员【信物】×1（240／480／720… 可重复）。',
      ],
    },
    {
      h: '武器池「武库申领」（本工具未收录）',
      items: [
        '一次申领消耗 1980 武库配额，一次给 10 件武器，必定包含 5★ 以上。',
        '6★ 武器基础 4%；每 4 次申领（40 抽）必 6★、每 8 次申领（80 抽）必当期 UP。',
        '累计奖励交替给【补充武库箱】与【UP 6★ 武器】，每期清零不继承。',
      ],
    },
    {
      h: '这个工具的模型',
      items: [
        '情报书只作用于「紧接着的下一期」，中间若跳过该期就视作作废。',
        '没有「本期已累计抽数」栏位：120 大保底与 240 信物一律从本期第 0 抽算起。',
        '复刻混池「辉光庆典」（保底独立、120 抽自选）规则不同，暂不支持。',
        '续抽阈值是策略参数：达标后要不要补到 60 抽换情报书，实测最佳区间约 45–50。',
      ],
    },
  ];

  // ---------------------------------------------------------------- English
  DICT['en'] = {
    'app.title': 'Endfield Gacha Calculator',
    'app.tagline': 'Arknights: Endfield · Limited banner odds',
    'nav.rules': 'Rates & rules',
    'nav.lang': 'Language',
    'btn.calculate': 'Calculate odds',
    'btn.calculating': 'Calculating…',
    'btn.reset': 'Reset',

    'panel.input': 'Your setup',
    'label.pity': 'Current pity',
    'hint.pity': '0–79 pulls since the last 6★',
    'label.budget': 'Pulls available',
    'hint.budget': '0–5000',
    'label.threshold': 'Top-up threshold',
    'hint.threshold': 'After hitting a target at ≥ this pull, keep going to 60 for the intel book',
    'label.targets': 'Copies wanted per banner',
    'hint.targets': '0 = skip banner, 1 = one copy, max 6',
    'banner.n': 'Banner {n}',

    'panel.result': 'Success chance',
    'result.placeholder': 'Set your inputs, then hit “Calculate odds”',
    'result.caption': 'Chance to get every target',
    'result.summary': '{banners} banner(s) · {targets} copy(ies) · {budget} pulls',
    'result.none': '—',

    'stats.title': 'Statistics',
    'stats.mean': 'Average pulls',
    'stats.median': 'Median',
    'stats.p90': 'P90',
    'stats.sub': 'First banner · {target} copy(ies)',
    'stats.marginal': 'Marginal gain',
    'stats.marginalText': '+{d} pp for {n} more',
    'stats.marginalEmpty': 'Already near certain',
    'unit.pull': 'pulls',

    'chart.curve.title': 'Cumulative success curve',
    'chart.curve.desc': 'Pulls on X, chance to clear every target on Y (click the chart to set the budget)',
    'chart.cost.title': 'Pulls needed per banner',
    'chart.cost.desc': 'Bar = median, line = P10–P90, dot = average',
    'chart.empty': 'Calculate first',
    'chart.tip': '{x} pulls · {y}%',
    'chart.estimating': 'Estimating…',

    'share.title': 'Share',
    'share.copyText': 'Copy result',
    'share.copyImage': 'Copy image',
    'share.download': 'Download PNG',
    'share.copyLink': 'Copy link',
    'share.copied': 'Copied to clipboard',
    'share.failed': 'Copy failed — downloaded instead',
    'share.imageTitle': 'Endfield Gacha Calculator',

    'rules.title': 'Rates & rules',
    'rules.close': 'Close',
    'rules.note': 'Based on the live version as of Oct 2026 (Danqing Du). Always check the in-game notice for later changes.',

    'footer.credit': 'Unofficial tool · odds are model estimates, for reference only',
  };

  RULES['en'] = [
    {
      h: 'Base rates (all operator banners)',
      items: [
        '6★ 0.80%, 5★ 8.00%, 4★ 91.20%.',
        'Every 10 pulls guarantees at least one 5★.',
        'Each pull grants Arsenal Quota: 2000 / 200 / 20 for 6★ / 5★ / 4★.',
      ],
    },
    {
      h: 'Soft + hard pity (carries over)',
      items: [
        'After 65 pulls without a 6★, every pull gains +5 percentage points (pull 79 = 70.8%).',
        'Pull 80 is a guaranteed 6★.',
        'The pity counter carries over between Limited (“Privileged”) banners.',
        'Any 6★ is the featured operator 50% of the time; losing the coin flip does not raise the next chance.',
      ],
    },
    {
      h: 'The 120-pull guarantee (does NOT carry over)',
      items: [
        'If you have not obtained the featured 6★ by your 120th pull on a banner, that pull is the featured operator.',
        'It works once per banner, ends once you get the featured operator, and resets when the banner ends.',
        'So “pre-pulling” only builds soft pity — the 120 counter restarts every banner.',
      ],
    },
    {
      h: 'Milestone rewards',
      items: [
        '30 pulls: 10 free pulls on the same banner (base rates only, no pity, no milestone credit).',
        '60 pulls: an intel book → 10 dedicated pulls on the NEXT Limited banner (counts toward its pity; expires if skipped).',
        'Every 240 pulls: one dupe token for the featured operator (240 / 480 / 720 … repeatable).',
      ],
    },
    {
      h: 'Weapon banner (not covered here)',
      items: [
        'One claim costs 1980 Arsenal Quota and yields 10 weapons, always including a 5★ or better.',
        '6★ weapon rate is 4%; every 4th claim (40 pulls) guarantees a 6★, every 8th guarantees the featured weapon.',
        'Milestone rewards alternate between a spare-weapon box and the featured 6★ weapon; they reset each banner.',
      ],
    },
    {
      h: 'How this calculator models it',
      items: [
        'The intel book only applies to the very next banner — if you skip that banner it is wasted.',
        'There is no “pulls already made this banner” field: the 120 guarantee and 240 token always start from pull 0.',
        'Rerun mix banners (“Glorious Celebration”, independent pity, 120-pull selector) work differently and are not supported.',
        'The top-up threshold is a strategy knob: after hitting a target, keep pulling to 60 for the intel book. Best range measured: 45–50.',
      ],
    },
  ];

  DICT.rules = RULES;

  // ---------------------------------------------------------------- 執行期
  var LANGS = ['zh-TW', 'zh-CN', 'en'];
  var STORAGE_KEY = 'endfield-calc-lang';

  function detect() {
    try {
      var saved = localStorage.getItem(STORAGE_KEY);
      if (saved && LANGS.indexOf(saved) >= 0) return saved;
    } catch (e) { /* ignore */ }
    var nav = (navigator.language || 'zh-TW').toLowerCase();
    if (nav.indexOf('zh-cn') === 0 || nav.indexOf('zh-hans') === 0 || nav === 'zh') return 'zh-CN';
    if (nav.indexOf('zh') === 0) return 'zh-TW';
    return 'en';
  }

  function t(lang, key, vars) {
    var table = DICT[lang] || DICT['zh-TW'];
    var s = table[key];
    if (s === undefined) s = DICT['zh-TW'][key];
    if (s === undefined) return key;
    if (vars) {
      s = s.replace(/\{(\w+)\}/g, function (m, k) {
        return (vars[k] === undefined) ? m : String(vars[k]);
      });
    }
    return s;
  }

  root.I18N = {
    LANGS: LANGS,
    dict: DICT,
    detect: detect,
    t: t,
    save: function (lang) {
      try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) { /* ignore */ }
    },
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
