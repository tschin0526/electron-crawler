/**
 * MD 編輯器 Lite - Markdown 渲染管線
 * 移植自 todo 編輯器的 renderMarkdown，支持盡可能多的擴展語法。
 */

// ========== 常用 emoji 短代碼映射（marked-emoji 使用）==========
const EMOJI_MAP = {
  smile: '😄', grin: '😁', laugh: '😆', wink: '😉', blush: '😊',
  heart: '❤️', hearts: '💕', kiss: '😘', kissing: '😗', relaxed: '☺️',
  thinking: '🤔', worried: '😟', sweat: '😓', cry: '😢', sob: '😭',
  joy: '😂', rofl: '🤣', sunglasses: '😎', rage: '😡', angry: '😠',
  confused: '😕', flushed: '😳', sleepy: '😪', tired: '😫', yum: '😋',
  sunglasses2: '😎', scream: '😱', fearful: '😨', neutral: '😐',
  star: '⭐', sparkles: '✨', fire: '🔥', ok: '👌', thumbsup: '👍',
  thumbsdown: '👎', clap: '👏', pray: '🙏', point_up: '☝️',
  wave: '👋', raised_hands: '🙌', rocket: '🚀', boom: '💥',
  check: '✅', x: '❌', warning: '⚠️', info: 'ℹ️', question: '❓',
  bulb: '💡', book: '📖', memo: '📝', calendar: '📅', clock: '🕐',
  computer: '💻', phone: '📱', email: '📧', link: '🔗', lock: '🔒',
  key: '🔑', tag: '🏷️', flag: '🚩', bell: '🔔', gift: '🎁',
  coffee: '☕', pizza: '🍕', beer: '🍺', wine: '🍷', apple: '🍎',
  banana: '🍌', cherry: '🍒', strawberry: '🍓', lemon: '🍋', melon: '🍈',
  grapes: '🍇', watermelon: '🍉', orange: '🍊', peach: '🍑', pear: '🍐',
  pineapple: '🍍', kiwi: '🥝', avocado: '🥑', tomato: '🍅', eggplant: '🍆',
  carrot: '🥕', corn: '🌽', potato: '🥔', broccoli: '🥦', cucumber: '🥒',
  mushroom: '🍄', peanuts: '🥜', bread: '🍞', cheese: '🧀', meat: '🍖',
  chicken: '🍗', egg: '🥚', rice: '🍚', noodle: '🍜', sushi: '🍣',
  icecream: '🍦', cake: '🍰', cookie: '🍪', donut: '🍩', chocolate: '🍫',
  candy: '🍬', lollipop: '🍭', honey: '🍯', baby: '👶', boy: '👦',
  girl: '👧', man: '👨', woman: '👩', older_man: '👴', older_woman: '👵',
  police: '👮', guard: '💂', construction: '👷', angel: '👼', santa: '🎅',
  mrs_claus: '🤶', princess: '👸', prince: '🤴', bride: '👰', groom: '🤵',
  runner: '🏃', surfer: '🏄', swimmer: '🏊', cyclist: '🚴', basketball: '⛹️',
  football: '🏈', tennis: '🎾', golf: '🏌️', ski: '⛷️', snowboarder: '🏂',
  dancer: '💃', bow: '🙇', facepalm: '🤦', shrug: '🤷', massage: '💆',
  haircut: '💇', nail_care: '💅', ring: '💍', gem: '💎', bouquet: '💐',
  tulip: '🌷', rose: '🌹', sunflower: '🌻', hibiscus: '🌺', blossom: '🌼',
  cherry_blossom: '🌸', four_leaf_clover: '🍀', maple_leaf: '🍁', fallen_leaf: '🍂',
  leaves: '🍃', mushroom2: '🍄', cactus: '🌵', evergreen: '🌲', palm: '🌴',
  seedling: '🌱', herb: '🌿', shamrock: '☘️', cloud: '☁️', sun: '☀️',
  moon: '🌙', star2: '🌟', zap: '⚡', snowflake: '❄️', fire2: '🔥',
  droplet: '💧', ocean: '🌊', umbrella: '☂️', umbrella2: '⛱️', fog: '🌫️',
  rainbow: '🌈', mountain: '⛰️', volcano: '🌋', japan: '🗾', earth: '🌍',
  globe: '🌐', compass: '🧭', map: '🗺️', world_map: '🗺️', beach: '🏖️',
  desert: '🏜️', island: '🏝️', park: '🏞️', stadium: '🏟️', classical: '🏛️',
  building: '🏢', house: '🏠', home: '🏠', school: '🏫', office: '🏢',
  hospital: '🏥', bank: '🏦', hotel: '🏨', convenience_store: '🏪', love_hotel: '🏩',
  wedding: '💒', church: '⛪', mosque: '🕌', temple: '🛕', shrine: '⛩️',
  kaaba: '🕋', fountain: '⛲', tent: '⛺', foggy: '🌁', night: '🌃',
  city: '🌆', city_sunset: '🌇', bridge: '🌉', watch: '⌚', phone2: '☎️',
  computer2: '🖥️', keyboard: '⌨️', mouse: '🖱️', trackball: '🖲️', printer: '🖨️',
  camera: '📷', video_camera: '📹', movie_camera: '🎥', projector: '📽️', tv: '📺',
  radio: '📻', microphone: '🎤', headphones: '🎧', musical_score: '🎼', musical_note: '🎵',
  notes: '🎶', guitar: '🎸', drum: '🥁', saxophone: '🎷', trumpet: '🎺',
  violin: '🎻', game: '🎮', alien: '👽', robot: '🤖', ghost: '👻',
  skull: '💀', poop: '💩', clown: '🤡', ogre: '👹', goblin: '👺',
  japanese_ogre: '👹', japanese_goblin: '👺', space_invader: '👾', see_no_evil: '🙈',
  hear_no_evil: '🙉', speak_no_evil: '🙊', monkey: '🐵', dog: '🐶', cat: '🐱',
  mouse2: '🐭', hamster: '🐹', rabbit: '🐰', fox: '🦊', bear: '🐻',
  panda: '🐼', koala: '🐨', tiger: '🐯', lion: '🦁', cow: '🐮',
  pig: '🐷', frog: '🐸', octopus: '🐙', squid: '🦑', shrimp: '🦐',
  crab: '🦀', snake: '🐍', turtle: '🐢', whale: '🐳', dolphin: '🐬',
  fish: '🐟', blowfish: '🐡', shark: '🦈', butterfly: '🦋', bug: '🐛',
  ant: '🐜', bee: '🐝', beetle: '🪲', ladybug: '🐞', cricket: '🦗',
  spider: '🕷️', scorpion: '🦂', mosquito: '🦟', microbe: '🦠', bouquet2: '💐',
  white_flower: '💮', rosette: '🏵️', sun_with_face: '🌞', full_moon: '🌕', new_moon: '🌑',
  first_quarter: '🌓', last_quarter: '🌗', waxing: '🌔', waning: '🌖', moon2: '🌙',
  crescent: '🌙', black_joker: '🃏', mahjong: '🀄', flower_playing_cards: '🎴', musical_keyboard: '🎹',
  dart: '🎯', bowling: '🎳', boxing: '🥊', martial_arts: '🥋', goal: '🥅',
  golf_flag: '⛳', ice_skate: '⛸️', fishing: '🎣', running_shirt: '🎽', medal: '🏅',
  trophy: '🏆', sports_medal: '🏅', first_place: '🥇', second_place: '🥈', third_place: '🥉',
  ribbon: '🎀', ticket: '🎫', tickets: '🎟️', circus: '🎪', performing_arts: '🎭',
  art: '🎨', slot_machine: '🎰', steam_locomotive: '🚂', railway_car: '🚃', bullettrain: '🚅',
  train: '🚆', metro: '🚇', light_rail: '🚈', station: '🚉', tram: '🚊',
  monorail: '🚝', mountain_railway: '🚞', bus: '🚌', trolleybus: '🚎', minibus: '🚐',
  ambulance: '🚑', fire_engine: '🚒', police_car: '🚓', taxi: '🚕', car: '🚗',
  truck: '🚚', articulated_lorry: '🚛', tractor: '🚜', race_car: '🏎️', motorcycle: '🏍️',
  bicycle: '🚲', kick_scooter: '🛴', skateboard: '🛹', bus_stop: '🚏', motorway: '🛣️',
  railtrack: '🛤️', barrel: '🛢️', construction2: '🚧', anchor: '⚓', boat: '⛵',
  sailboat: '⛵', speedboat: '🚤', passenger_ship: '🛳️', ferry: '⛴️', ship: '🚢',
  airplane: '✈️', small_airplane: '🛩️', flight_departure: '🛫', flight_arrival: '🛬', parachute: '🪂',
  seat: '💺', helicopter: '🚁', suspension_railway: '🚟', mountain_cableway: '🚠', aerial_tramway: '🚡',
  satellite: '🛰️', rocket2: '🚀', flying_saucer: '🛸', bellhop: '🛎️', luggage: '🧳',
  hourglass: '⌛', timer: '⏲️', alarm_clock: '⏰', stopwatch: '⏱️', clock2: '🕐',
  moon_cake: '🥮', dumpling: '🥟', fortune_cookie: '🥠', takeout_box: '🥡', chopsticks: '🥢',
  bowl: '🥣', salad: '🥗', shallow_pan: '🥘', stew: '🍲', curry: '🍛',
  rice_ball: '🍙', rice_cracker: '🍘', oden: '🍢', dango: '🍡', shaved_ice: '🍧',
  ice_cream: '🍨', doughnut: '🍩', cookie2: '🍪', custard: '🍮', lollipop2: '🍭',
  candy2: '🍬', chocolate_bar: '🍫', popcorn: '🍿', sandwich: '🥪', canned_food: '🥫',
  bento: '🍱', crab2: '🦀', lobster: '🦞', shrimp2: '🦐', squid2: '🦑',
  peacock: '🦚', parrot: '🦜', owl: '🦉', swan: '🦢', eagle: '🦅',
  duck: '🦆', bat: '🦇', rooster: '🐓', turkey: '🦃', dodo: '🦤',
  feather: '🪶', flamingo: '🦩', peacock2: '🦚', t_rex: '🦖', sauropod: '🦕',
  seal: '🦭', badger: '🦡', beaver: '🦫', sloth: '🦥', otter: '🦦',
  skunk: '🦨', kangaroo: '🦘', llama: '🦙', mammoth: '🦣', dna: '🧬',
  petri_dish: '🧫', microscope: '🔬', telescope: '🔭', satellite_antenna: '📡', syringe: '💉',
  drop_of_blood: '🩸', pill: '💊', adhesive_bandage: '🩹', stethoscope: '🩺', x_ray: '🩻',
  door: '🚪', elevator: '🛗', mirror: '🪞', window: '🪟', bed: '🛏️',
  couch: '🛋️', chair: '🪑', toilet: '🚽', plunger: '🪠', shower: '🚿',
  bathtub: '🛁', mouse_trap: '🪤', razor: '🪒', lotion: '🧴', safety_pin: '🧷',
  broom: '🧹', basket: '🧺', soap: '🧼', sponge: '🧽', fire_extinguisher: '🧯',
  shopping: '🛒', gift2: '🎁', balloon: '🎈', flags: '🎏', wind_chime: '🎐',
  ribbon2: '🎀', envelopes: '🧧', ping_pong: '🏓', badminton: '🏸', basketball2: '🏀',
  volleyball: '🏐', soccer: '⚽', baseball: '⚾', softball: '🥎', tennis2: '🎾',
  football2: '🏈', rugby: '🏉', golf2: '⛳', swimming: '🏊', surfing: '🏄',
  rowing: '🚣', biking: '🚴', mountain_biking: '🚵', running: '🏃', hiking: '🥾',
  dancing: '💃', woman_dancing: '💃', man_dancing: '🕺', levitate: '🕴️', people_wrestling: '🤼',
  water_polo: '🤽', handball: '🤾', juggling: '🤹', lotus_position: '🧘', bath: '🛀',
  sleep: '😴', zzz: '💤',thought_balloon: '💭', anger: '💢', sweat_drops: '💦',
  dash: '💨', dizzy: '💫', speech_balloon: '💬', left_speech: '🗨️', right_anger: '🗯️',
  bubble: '🗯️', spades: '♠️', hearts2: '♥️', diamonds: '♦️', clubs: '♣️',
  chess_pawn: '♟️', joker: '🃏', black_circle: '⚫', white_circle: '⚪', red_circle: '🔴',
  blue_circle: '🔵', green_circle: '🟢', yellow_circle: '🟡', purple_circle: '🟣', brown_circle: '🟤',
  orange_circle: '🟠', black_square: '⬛', white_square: '⬜', red_square: '🟥', blue_square: '🟦',
  green_square: '🟩', yellow_square: '🟨', purple_square: '🟪', brown_square: '🟫', orange_square: '🟧',
  black_small_square: '▪️', white_small_square: '▫️', red_triangle: '🔺', blue_triangle: '🔻',
  diamond_shape: '🔸', diamond_shape_blue: '🔹', eight_spoked: '☸️', eight_pointed: '✴️',
  sparkle: '❇️', copyright: '©️', registered: '®️', tm: '™️', hash: '#️⃣',
  asterisk: '*️⃣', information_source: 'ℹ️', m: 'Ⓜ️', wc: '🚾', parking: '🅿️',
  wheelchair: '♿', mens: '🚹', womens: '🚺', baby_symbol: '🚼', restroom: '🚻',
  passport_control: '🛂', customs: '🛃', baggage_claim: '🛄', left_luggage: '🛅', warning2: '⚠️',
  children_crossing: '🚸', no_entry: '⛔', prohibited: '🚫', bicycle2: '🚳', no_smoking: '🚭',
  do_not_litter: '🚯', non_potable_water: '🚱', no_pedestrians: '🚷', no_mobile_phones: '📵',
  underage: '🔞', radioactive: '☢️', biohazard: '☣️', arrow_up: '⬆️', arrow_down: '⬇️',
  arrow_left: '⬅️', arrow_right: '➡️', arrow_up_down: '↕️', left_right: '↔️', arrow_upper_left: '↖️',
  arrow_upper_right: '↗️', arrow_lower_right: '↘️', arrow_lower_left: '↙️', arrow_heading_up: '⤴️',
  arrow_heading_down: '⤵️', arrows_clockwise: '🔃', arrows_counterclockwise: '🔄', back: '🔙',
  end: '🔚', on: '🔛', soon: '🔜', top: '🔝', place_of_worship: '🛐',
  atom: '⚛️', om: '🕉️', star_of_david: '✡️', wheel_of_dharma: '☸️', yin_yang: '☯️',
  cross: '✝️', orthodox_cross: '☦️', star_and_crescent: '☪️', peace: '☮️', menorah: '🕎',
  six_pointed_star: '🔯', aries: '♈', taurus: '♉', gemini: '♊', cancer: '♋',
  leo: '♌', virgo: '♍', libra: '♎', scorpius: '♏', sagittarius: '♐',
  capricorn: '♑', aquarius: '♒', pisces: '♓', ophiuchus: '⛎', twisted: '〰️',
  exclamation: '❗', grey_exclamation: '❕', question2: '❓', grey_question: '❔', bangbang: '‼️',
  interrobang: '⁉️', low_brightness: '🔅', high_brightness: '🔆', signal_strength: '📶', vibration_mode: '📳',
  mobile_phone_off: '📴', recyle: '♻️', name_badge: '📛', no_entry_sign: '🚫', forbidded: '🚫',
  white_check_mark: '✅', ballot_box: '☑️', heavy_check_mark: '✔️', heavy_multiplication: '✖️', cross_mark: '❌',
  cross_mark_button: '❎', heavy_plus_sign: '➕', heavy_minus_sign: '➖', heavy_division_sign: '➗', curly_loop: '➰',
  loop: '➿', part_alternation: '〽️', clock_wise: '🔃', wavy_dash: '〰️', middle_dot: '·',
  one: '1️⃣', two: '2️⃣', three: '3️⃣', four: '4️⃣', five: '5️⃣',
  six: '6️⃣', seven: '7️⃣', eight: '8️⃣', nine: '9️⃣', zero: '0️⃣',
  keycap_ten: '🔟', capital_abcd: '🔠', abcd: '🔡', symbols: '🔣', abc: '🔤',
  abc2: '🔤', input_latin: '🔤', up: '⬆️', down: '⬇️', left: '⬅️', right: '➡️'
};

// 注册 marked-emoji 扩展（如果库已加载）
if (typeof window !== 'undefined' && window.marked && window.markedEmoji) {
  try {
    var emojiExt = (typeof window.markedEmoji === 'function')
      ? window.markedEmoji
      : (window.markedEmoji.markedEmoji || window.markedEmoji.default);
    if (emojiExt) {
      window.marked.use(emojiExt({
        emojis: window.gemojiData || EMOJI_MAP,
        renderer: function (token) { return token.emoji; }
      }));
    }
  } catch (e) {
    console.warn('[Lite] marked-emoji 注册失败：', e);
  }
}

// ========== 工具函数 ==========
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function slugify(t) {
  return String(t || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[&/\\#,+()$~%.'":*?<>{}，。、；：！？（）「」『』【】《》“”‘’—…·\s]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// ========== 主渲染管線 ==========
function renderMarkdown(text, opts) {
  if (!text) return '';

  // KaTeX 已渲染 HTML 短路：只跑輕量後處理
  if (!(opts && opts.force) && /<span[^>]*class="(?:katex|katex-display)"/.test(text)) {
    var km = processSortTables(processInlineCalc(processColWidths(processCalcTables(normalizeStyleHyphens(balanceHtmlTags(text))))));
    return km;
  }

  // 提取 LaTeX 公式
  const mathBlocks = [];
  let processed = text;
  processed = processed.replace(/\$\$([\s\S]*?)\$\$/g, (_, formula) => {
    var idx = mathBlocks.length;
    mathBlocks.push({ formula: formula, display: true });
    return '%%MATHBLOCK_' + idx + '%%';
  });
  processed = processed.replace(/(?<!\$)(?<!\d)\$(?!\$)(?!\s)([^$\n]+?)(?<!\s)\$(?!\$)(?!\d)/g, (_, formula) => {
    var idx = mathBlocks.length;
    mathBlocks.push({ formula: formula, display: false });
    return '%%MATHBLOCK_' + idx + '%%';
  });

  // GFM 修復：內聯標籤後的空行折疊
  var _inlineOpen = '(?:<(?:big|small|span|mark|sub|sup|u|s|del|ins|b|i|em|strong)\\b[^>]*>)';
  var _inlineClose = '(?:<\\/(?:big|small|span|mark|sub|sup|u|s|del|ins|b|i|em|strong)>)';
  processed = processed
    .replace(new RegExp('(' + _inlineOpen + '+)\\n\\n+', 'gi'), '$1\n')
    .replace(new RegExp('(' + _inlineOpen + '+)\\n([-*+]|\\d+\\.) ', 'gi'), '$1\n\n$2 ')
    .replace(new RegExp('\\n\\n+(' + _inlineClose + '+)', 'gi'), '\n$1');

  // BIG/SMALL 連續層級折疊
  ['big', 'small'].forEach(function (tag) {
    var openRe = new RegExp('<((' + tag + ')\\b[^>]*)>(\\s*<' + tag + '\\b[^>]*>)+(?=\\s*\\n)', 'gi');
    var closeRe = new RegExp('(?<=\\n\\s*)(</(' + tag + ')\\b[^>]*>(\\s*</' + tag + '\\b[^>]*>)+)', 'gi');
    processed = processed
      .replace(openRe, function (m, firstOpenTag) {
        var cnt = 0, re = new RegExp('<' + tag + '\\b', 'gi');
        while (re.exec(m) !== null) cnt++;
        if (cnt <= 1) return m;
        var ratio = tag === 'big' ? Math.pow(1.2, cnt) : Math.pow(1 / 1.2, cnt);
        var style = 'font-size:' + ratio.toFixed(4) + 'em;';
        if (/\\sstyle="/.test(firstOpenTag)) {
          return '<' + firstOpenTag.replace(/(style="[^"]*)">/, '$1;' + style + '">') + '>';
        }
        return '<' + firstOpenTag + ' style="' + style + '">';
      })
      .replace(closeRe, '</' + tag + '>');
  });

  // 圖片尺寸 + 圖組標記
  processed = processImageSizes(processed);
  processed = processRowMarkers(processed);

  // marked 渲染
  var html = '';
  if (typeof marked !== 'undefined') {
    marked.setOptions({ breaks: true, gfm: true });
    html = marked.parse(processed);
    // 代碼高亮
    if (typeof hljs !== 'undefined') {
      html = html.replace(/<pre><code(?:\s+class="([^"]*)")?>([\s\S]*?)<\/code><\/pre>/g, function (match, cls, code) {
        var langMatch = cls && cls.match(/language-([\w-]+)/);
        var lang = langMatch ? langMatch[1] : '';
        var decoded = code.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
        try {
          var language = lang && hljs.getLanguage(lang) ? lang : 'plaintext';
          var highlighted = hljs.highlight(decoded, { language: language }).value;
          return '<pre><code class="hljs language-' + language + '">' + highlighted + '</code></pre>';
        } catch (e) {
          return match;
        }
      });
    }
  } else {
    html = '<div style="background:#fef3c7;color:#92400e;border:1px solid #f59e0b;border-radius:6px;padding:8px 12px;margin:0 0 10px;font-size:12px;">⚠️ 渲染库（marked）未加载，以下为原文显示</div>' + escapeHtml(processed);
  }

  // 還原 KaTeX
  if (mathBlocks.length > 0) {
    html = html.replace(/%%MATHBLOCK_(\d+)%%/g, function (_, idx) {
      var item = mathBlocks[parseInt(idx, 10)];
      if (typeof katex !== 'undefined') {
        try {
          return katex.renderToString(item.formula, { displayMode: item.display, throwOnError: false });
        } catch (e) {
          return '<code>' + escapeHtml(item.formula) + '</code>';
        }
      }
      return '<code>' + escapeHtml(item.formula) + '</code>';
    });
  }

  html = processMarkdownInsideBig(html);
  html = balanceHtmlTags(html);
  html = normalizeStyleHyphens(html);
  html = transformCardLinks(html);
  html = processCalcTables(html);
  html = processColWidths(html);
  html = processImageRows(html);
  html = processInlineCalc(html);
  html = processSortTables(html);
  html = assignHeadingIds(html);
  html = processToc(html);

  return html;
}

// ========== 後處理函數 ==========
function normalizeStyleHyphens(html) {
  if (!html) return html;
  var HYPHENS = /[‐‑–—―−‒⁃]/g;
  return html.replace(/style\s*=\s*(["'])([\s\S]*?)\1/g, function (m, q, body) {
    var decls = body.split(';').map(function (decl) {
      var idx = decl.indexOf(':');
      if (idx === -1) return decl;
      return decl.slice(0, idx).replace(HYPHENS, '-') + decl.slice(idx);
    });
    return 'style=' + q + decls.join(';') + q;
  });
}

function processMarkdownInsideBig(html) {
  if (!html) return html;
  var prev;
  do {
    prev = html;
    html = html.replace(/<(big|BIG)>([\s\S]*?)<\/\1>/g, function (m, tag, inner) {
      var processed = inner
        .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
        .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');
      return '<' + tag.toLowerCase() + '>' + processed + '</' + tag.toLowerCase() + '>';
    });
  } while (html !== prev);
  return html;
}

function balanceHtmlTags(html) {
  var allowedTags = ['big', 'small', 'b', 'strong', 'i', 'em', 'u', 's', 'del', 'ins', 'sub', 'sup', 'mark', 'span', 'div', 'p', 'br', 'code', 'pre', 'a', 'ul', 'ol', 'li', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'tr', 'td', 'th', 'thead', 'tbody'];
  var tagPattern = /<\/?([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g;
  var tokens = [];
  var m;
  while ((m = tagPattern.exec(html)) !== null) {
    var full = m[0];
    var name = m[1].toLowerCase();
    if (!allowedTags.includes(name)) continue;
    if (full.match(/\/\s*>$/) || name === 'br') continue;
    tokens.push({ type: full.startsWith('</') ? 'close' : 'open', name: name, text: full, idx: m.index });
  }

  var openStack = [];
  var out = '';
  var cursor = 0;
  for (var i = 0; i < tokens.length; i++) {
    var tok = tokens[i];
    out += html.slice(cursor, tok.idx);
    cursor = tok.idx + tok.text.length;
    if (tok.type === 'open') {
      openStack.push({ name: tok.name });
      out += tok.text;
    } else {
      var j = openStack.length - 1;
      while (j >= 0 && openStack[j].name !== tok.name) j--;
      if (j >= 0) {
        for (var k = openStack.length - 1; k > j; k--) {
          out += '</' + openStack[k].name + '>';
          openStack.pop();
        }
        out += tok.text;
        openStack.pop();
      }
    }
  }
  out += html.slice(cursor);
  while (openStack.length > 0) {
    out += '</' + openStack[openStack.length - 1].name + '>';
    openStack.pop();
  }
  return out;
}

function processImageSizes(md) {
  if (!md) return md;
  return md.replace(/!\[([^\]]*)\]\(\s*(\S+?)\s+=\s*([^)\s]+?)\s*\)/g, function (m, alt, url, dim) {
    var style = parseImageDim(dim);
    if (!style) return m;
    var safeAlt = String(alt).replace(/"/g, '&quot;');
    var safeUrl = String(url).replace(/"/g, '&quot;');
    return '<img src="' + safeUrl + '" alt="' + safeAlt + '" style="' + style + '">\n\n';
  });
}

function parseImageDim(dim) {
  if (!dim) return '';
  var m = dim.match(/^(?:(\d+(?:\.\d+)?)(%?))?(?:x(\d+(?:\.\d+)?)(%?))?$/);
  if (!m) return '';
  var w = m[1], wPct = m[2], h = m[3], hPct = m[4];
  if (!w && !h) return '';
  var s = '';
  if (w) s += 'width:' + w + (wPct ? '%' : 'px') + ';';
  else s += 'width:auto;';
  if (h) s += 'height:' + h + (hPct ? '%' : 'px') + ';';
  else s += 'height:auto;';
  s += 'object-fit:contain;';
  return s;
}

function processRowMarkers(md) {
  if (!md) return md;
  return md
    .replace(/\{\{row\}\}/g, '<!--IMGROW_START-->')
    .replace(/\{\{endrow\}\}/g, '<!--IMGROW_END-->');
}

function processImageRows(html) {
  if (!html || typeof DOMParser === 'undefined') return html;
  return html.replace(/<!--IMGROW_START-->([\s\S]*?)<!--IMGROW_END-->/g, function (m, inner) {
    try {
      var doc = new DOMParser().parseFromString('<div>' + inner + '</div>', 'text/html');
      var root = doc.body.firstChild;
      var items = root.querySelectorAll('img, .file-embed');
      if (!items || items.length === 0) {
        return inner.replace(/<!--IMGROW_(?:START|END)-->/g, '');
      }
      var row = doc.createElement('div');
      row.className = 'img-row';
      Array.prototype.forEach.call(items, function (el) { row.appendChild(el); });
      return row.outerHTML;
    } catch (e) {
      return inner.replace(/<!--IMGROW_(?:START|END)-->/g, '');
    }
  });
}

function evalMathExpression(src) {
  var percent = false;
  var expr = String(src).trim();
  if (expr.charAt(expr.length - 1) === '%') { percent = true; expr = expr.slice(0, -1); }

  var tokens = [];
  var i = 0;
  while (i < expr.length) {
    var c = expr[i];
    if (/\s/.test(c)) { i++; continue; }
    if ('()+*/^:,'.indexOf(c) !== -1) { tokens.push({ t: c }); i++; continue; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(expr[i + 1] || ''))) {
      var num = '';
      while (i < expr.length && /[0-9.]/.test(expr[i])) { num += expr[i]; i++; }
      if ((num.match(/\./g) || []).length > 1) throw new Error('bad number');
      tokens.push({ t: 'num', v: parseFloat(num) });
      continue;
    }
    if (/[A-Za-z]/.test(c)) {
      var word = '';
      while (i < expr.length && /[A-Za-z]/.test(expr[i])) { word += expr[i]; i++; }
      var j = i;
      while (j < expr.length && /\s/.test(expr[j])) j++;
      if (expr[j] === '(') { tokens.push({ t: 'func', v: word.toUpperCase() }); continue; }
      var k = i;
      while (k < expr.length && /[0-9]/.test(expr[k])) k++;
      if (k > i) throw new Error('cell ref not supported inline: ' + word + expr.slice(i, k));
      throw new Error('unknown name: ' + word);
    }
    throw new Error('unexpected char: ' + c);
  }

  var pos = 0;
  function peek() { return tokens[pos]; }
  function next() { return tokens[pos++]; }
  function parseExpr() {
    var v = parseTerm();
    while (peek() && (peek().t === '+' || peek().t === '-')) {
      var op = next().t; var r = parseTerm();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }
  function parseTerm() {
    var v = parseFactor();
    while (peek() && (peek().t === '*' || peek().t === '/')) {
      var op = next().t; var r = parseFactor();
      v = op === '*' ? v * r : v / r;
    }
    return v;
  }
  function parseFactor() {
    if (peek() && peek().t === '-') { next(); return -parseFactor(); }
    if (peek() && peek().t === '+') { next(); return parseFactor(); }
    return parsePower();
  }
  function parsePower() {
    var v = parseUnary();
    while (peek() && peek().t === '^') { next(); var r = parseUnary(); v = Math.pow(v, r); }
    return v;
  }
  function parseUnary() {
    if (peek() && peek().t === '(') {
      next(); var v = parseExpr();
      if (!peek() || peek().t !== ')') throw new Error('missing )');
      next(); return v;
    }
    if (peek() && peek().t === 'num') { return next().v; }
    if (peek() && peek().t === 'func') {
      var fn = next().v;
      if (!peek() || peek().t !== '(') throw new Error('func no (');
      next();
      var args = [];
      if (peek() && peek().t !== ')') {
        args.push(parseExpr());
        while (peek() && peek().t === ',') { next(); args.push(parseExpr()); }
      }
      if (!peek() || peek().t !== ')') throw new Error('func missing )');
      next();
      return applyInlineFunc(fn, args);
    }
    throw new Error('unexpected token');
  }
  var result = parseExpr();
  if (pos < tokens.length) throw new Error('trailing tokens');
  return { value: result, percent: percent };
}

function applyInlineFunc(name, args) {
  switch (name) {
    case 'SUM': return args.reduce(function (a, b) { return a + b; }, 0);
    case 'AVG': case 'AVERAGE': return args.reduce(function (a, b) { return a + b; }, 0) / args.length;
    case 'MIN': return Math.min.apply(null, args);
    case 'MAX': return Math.max.apply(null, args);
    case 'PRODUCT': return args.reduce(function (a, b) { return a * b; }, 1);
    case 'MEDIAN': {
      var s = args.slice().sort(function (a, b) { return a - b; });
      var n = s.length;
      return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
    }
    case 'ABS': return Math.abs(args[0]);
    case 'SQRT': return Math.sqrt(args[0]);
    case 'ROUND': return args.length > 1 ? Math.round(args[0] * Math.pow(10, args[1])) / Math.pow(10, args[1]) : Math.round(args[0]);
    case 'POW': return Math.pow(args[0], args[1]);
    default: throw new Error('unknown func ' + name);
  }
}

function formatInlineNum(v, percent) {
  if (!isFinite(v)) return '#ERR';
  if (percent) return formatPercent(v);
  if (Math.abs(v) >= 1e15) return v.toExponential(6);
  if (Number.isInteger(v)) return String(v);
  return (Math.round(v * 1e6) / 1e6).toString();
}

function formatPercent(v) {
  if (!isFinite(v)) return '#ERR';
  var p = v * 100;
  return (Math.round(p * 100) / 100).toString() + '%';
}

function processInlineCalc(html) {
  if (!html || typeof document === 'undefined') return html;
  var holder = document.createElement('div');
  holder.innerHTML = html;
  var re = /\{\{=([\s\S]*?)\}\}/g;

  function processTextNode(textNode) {
    var txt = textNode.nodeValue;
    re.lastIndex = 0;
    if (!re.test(txt)) return;
    re.lastIndex = 0;
    var frag = document.createDocumentFragment();
    var last = 0, m, changed = false;
    while ((m = re.exec(txt)) !== null) {
      if (m.index > last) frag.appendChild(document.createTextNode(txt.slice(last, m.index)));
      var raw = m[1];
      var res;
      try {
        var r = evalMathExpression(raw);
        res = formatInlineNum(r.value, r.percent);
      } catch (e) { res = '#ERR'; }
      var span = document.createElement('span');
      span.className = 'inline-calc';
      span.textContent = res;
      span.setAttribute('title', '{{=' + raw + '}} = ' + res);
      frag.appendChild(span);
      last = re.lastIndex;
      changed = true;
    }
    if (!changed) return;
    if (last < txt.length) frag.appendChild(document.createTextNode(txt.slice(last)));
    textNode.parentNode.replaceChild(frag, textNode);
  }

  function walk(node) {
    var children = Array.prototype.slice.call(node.childNodes);
    for (var n = 0; n < children.length; n++) {
      var ch = children[n];
      if (ch.nodeType === 3) {
        if (ch.nodeValue.indexOf('{{=') !== -1) processTextNode(ch);
      } else if (ch.nodeType === 1) {
        var tag = ch.tagName.toLowerCase();
        if (tag === 'code' || tag === 'pre') continue;
        walk(ch);
      }
    }
  }
  walk(holder);
  return holder.innerHTML;
}

function collectVars(html) {
  var vars = {};
  if (!html) return vars;
  var re = /\{\{\s*let\s*:\s*([^\s}=]+)\s*(=?)\s*([^}]+?)\s*\}\}/g;
  var m;
  while ((m = re.exec(html)) !== null) {
    var name = m[1];
    var eq = m[2];
    var valStr = m[3].trim();
    var v;
    try {
      if (eq === '=') { v = evalMathExpression(valStr).value; }
      else { v = parseFloat(valStr); }
    } catch (e) { v = NaN; }
    if (isNaN(v)) { console.warn('[Lite] 忽略无法解析的 {{let}} 变量:', name, '=', valStr); continue; }
    vars[name] = v;
    vars[name.toUpperCase()] = v;
  }
  return vars;
}

function findNextTable(p) {
  var sib = p.nextElementSibling;
  while (sib) {
    var tag = sib.tagName.toLowerCase();
    if (tag === 'table') return sib;
    if (tag === 'p') {
      var t = (sib.textContent || '').trim();
      if (sib.getAttribute('data-calc-marker') || sib.getAttribute('data-cols-marker') || t.indexOf('{{') === 0) {
        sib = sib.nextElementSibling; continue;
      }
    }
    break;
  }
  return null;
}

function processCalcTables(html) {
  if (!html || typeof document === 'undefined') return html;
  var vars = collectVars(html);
  var holder = document.createElement('div');
  holder.innerHTML = html;
  var paras = holder.querySelectorAll('p');
  for (var i = 0; i < paras.length; i++) {
    var p = paras[i];
    if (p.getAttribute('data-calc-marker') || p.getAttribute('data-let-marker')) continue;
    var hasCalc = /\{\{calc\}\}/.test(p.textContent);
    var hasLet = /\{\{let\s*:/.test(p.textContent);
    if (!hasCalc && !hasLet) continue;
    if (hasLet) { p.style.display = 'none'; p.setAttribute('data-let-marker', 'true'); }
    if (hasCalc) {
      var table = findNextTable(p);
      if (!table) continue;
      try {
        evaluateCalcTable(table, vars);
        p.style.display = 'none';
        p.setAttribute('data-calc-marker', 'true');
        table.classList.add('calc-table');
      } catch (e) {
        console.error('[Lite] calc table error:', e);
      }
    }
  }
  return holder.innerHTML;
}

function processColWidths(html) {
  if (!html || typeof document === 'undefined') return html;
  var holder = document.createElement('div');
  holder.innerHTML = html;
  var paras = holder.querySelectorAll('p');
  for (var i = 0; i < paras.length; i++) {
    var p = paras[i];
    if (p.getAttribute('data-cols-marker')) continue;
    var m = (p.textContent || '').match(/\{\{cols:\s*([^}]*)\}\}/);
    if (!m) continue;
    var body = m[1].trim();
    if (!body) continue;
    var raw = body.split(/[\s,]+/).filter(Boolean);
    var widths = [];
    var ok = true;
    for (var k = 0; k < raw.length; k++) {
      var w = raw[k].trim();
      if (/^\d+(\.\d+)?(px|%|em|rem)$/.test(w)) widths.push(w);
      else if (/^\d+(\.\d+)?$/.test(w)) widths.push(w + '%');
      else { ok = false; break; }
    }
    if (!ok) { console.warn('[Lite] 忽略非法 {{cols}} 宽度声明:', (p.textContent || '').trim()); continue; }
    var table = findNextTable(p);
    if (!table) continue;
    var existing = table.querySelector('colgroup');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    var cg = document.createElement('colgroup');
    for (var c = 0; c < widths.length; c++) {
      var col = document.createElement('col');
      col.style.width = widths[c];
      cg.appendChild(col);
    }
    table.insertBefore(cg, table.firstChild);
    table.classList.add('fixed-cols');
    p.style.display = 'none';
    p.setAttribute('data-cols-marker', 'true');
  }
  return holder.innerHTML;
}

    function evaluateCalcTable(table, vars) {
      var trs = table.querySelectorAll('tr');
      var rowArr = [];
      var maxCols = 0;
      for (var ri = 0; ri < trs.length; ri++) {
        var cells = trs[ri].querySelectorAll('th, td');
        var row = [];
        for (var ci = 0; ci < cells.length; ci++) row.push(cells[ci]);
        rowArr.push(row);
        if (cells.length > maxCols) maxCols = cells.length;
      }
      if (rowArr.length === 0) return;
      var totalRows = rowArr.length;
      var totalCols = maxCols;
      var VARS = vars || {};

      function indexToCol(idx) {
        var s = ''; var n = idx + 1;
        while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
        return s;
      }
      function colToIndex(letters) {
        var idx = 0;
        for (var k = 0; k < letters.length; k++) idx = idx * 26 + (letters.charCodeAt(k) - 64);
        return idx - 1;
      }
      function parseRef(ref) {
        var m = String(ref).toUpperCase().match(/^([A-Z]+)(\d*)$/);
        if (!m) return null;
        return { col: m[1] ? colToIndex(m[1]) : null, row: m[2] ? parseInt(m[2], 10) : null };
      }
      function getCellEl(col, row) {
        if (row < 1 || row > rowArr.length) return null;
        var r = rowArr[row - 1];
        if (col < 0 || col >= r.length) return null;
        return r[col];
      }
      function numAt(col, row) {
        var el = getCellEl(col, row);
        if (!el) return NaN;
        if (el.hasAttribute('data-val')) {
          var dv = parseFloat(el.getAttribute('data-val'));
          return isNaN(dv) ? NaN : dv;
        }
        return parseNum(el.textContent);
      }
      function parseNum(raw) {
        raw = (raw == null ? '' : String(raw)).trim();
        if (/^-?\d+(\.\d+)?$/.test(raw)) return parseFloat(raw);
        return NaN;
      }
      function formatNum(v) {
        if (!isFinite(v)) return '#ERR';
        if (Math.abs(v) >= 1e15) return v.toExponential(6);
        if (Number.isInteger(v)) return String(v);
        return (Math.round(v * 1e6) / 1e6).toString();
      }

      var memo = {};
      var visiting = {};
      var depth = 0;
      function evalCell(ref) {
        ref = String(ref).toUpperCase();
        if (memo.hasOwnProperty(ref)) return memo[ref];
        if (visiting[ref]) return 0; // 循环引用 → 0
        visiting[ref] = true;
        depth++;
        var val;
        if (depth > 50) { val = 0; }
        else {
          var pr = parseRef(ref);
          var el = pr ? getCellEl(pr.col, pr.row) : null;
          if (!el) val = NaN;
          else {
            var raw = el.textContent.trim();
          if (raw.charAt(0) === '=') {
            try { val = evalFormula(raw.slice(1), ref); }
            catch (e) { val = NaN; }
          } else {
              if (el.hasAttribute('data-val')) {
                var dv2 = parseFloat(el.getAttribute('data-val'));
                val = isNaN(dv2) ? NaN : dv2;
              } else {
                val = parseNum(raw);
              }
            }
          }
        }
        depth--;
        visiting[ref] = false;
        memo[ref] = val;
        return val;
      }

      // ---- 公式解析器（递归下降，安全无 eval）----
      function tokenize(s) {
        var tokens = []; var i = 0;
        while (i < s.length) {
          var c = s[i];
          if (/\s/.test(c)) { i++; continue; }
          if ('()+*/^:,-'.indexOf(c) !== -1) { tokens.push({ t: c }); i++; continue; }
          if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(s[i + 1] || ''))) {
            var num = '';
            while (i < s.length && /[0-9.]/.test(s[i])) { num += s[i]; i++; }
            tokens.push({ t: 'num', v: parseFloat(num) });
            continue;
          }
          if (/[A-Za-z]/.test(c)) {
            var word = '';
            while (i < s.length && /[A-Za-z]/.test(s[i])) { word += s[i]; i++; }
            // 支持 A商品单价、price单价 等拉丁+中文混合变量名（仍以 var 类型处理）
            if (i < s.length && /[\u4e00-\u9fff]/.test(s[i])) {
              while (i < s.length && /[A-Za-z0-9_\u4e00-\u9fff]/.test(s[i])) { word += s[i]; i++; }
              tokens.push({ t: 'var', v: word });
              continue;
            }
            var k = i;
            while (k < s.length && /[0-9]/.test(s[k])) k++;
            if (k > i) { word += s.slice(i, k); i = k; tokens.push({ t: 'ref', v: word.toUpperCase() }); continue; } // B2 / D11 单元格引用
            var j = i; while (j < s.length && /\s/.test(s[j])) j++;
            if (s[j] === '(') { tokens.push({ t: 'func', v: word.toUpperCase() }); } // 函数
            else if (s[j] === ':') { tokens.push({ t: 'ref', v: word.toUpperCase() }); } // A:A 整列引用
            else { tokens.push({ t: 'var', v: word.toUpperCase() }); } // 拉丁变量名（大小写不敏感）
            continue;
          }
          if (/[\u4e00-\u9fff]/.test(c)) {
            var cjk = '';
            while (i < s.length && /[A-Za-z0-9_\u4e00-\u9fff]/.test(s[i])) { cjk += s[i]; i++; }
            tokens.push({ t: 'var', v: cjk }); // 中文/混合变量名
            continue;
          }
          i++; // 跳过未知字符
        }
        return tokens;
      }
      function toNum(x) {
        if (typeof x === 'number') return x;
        if (Array.isArray(x)) throw new Error('range not allowed in arithmetic');
        var n = Number(x);
        return isNaN(n) ? 0 : n;
      }
      function flatten(nums, excludeNonNumeric) {
        var out = [];
        for (var a = 0; a < nums.length; a++) {
          var arr = nums[a];
          for (var b = 0; b < arr.length; b++) {
            var v = arr[b];
            var n = (typeof v === 'number') ? v : Number(v);
            if (isNaN(n)) { if (!excludeNonNumeric) out.push(0); }
            else out.push(n);
          }
        }
        return out;
      }
      function getRange(startRef, endRef) {
        var s = parseRef(startRef), e = parseRef(endRef);
        if (!s || !e) throw new Error('bad range');
        var vals = [];
        if (s.col != null && e.col != null) {
          var col = s.col, r1 = s.row != null ? s.row : 1, r2 = e.row != null ? e.row : totalRows;
          for (var r = r1; r <= r2; r++) vals.push(numAt(col, r));
        } else if (s.col != null) {
          for (var r2 = 1; r2 <= totalRows; r2++) vals.push(numAt(s.col, r2));
        } else if (s.row != null) {
          var rr1 = s.row, rr2 = e.row != null ? e.row : totalRows;
          for (var r3 = rr1; r3 <= rr2; r3++) for (var c = 0; c < totalCols; c++) vals.push(numAt(c, r3));
        }
        return vals;
      }
      function callFunc(name, args, currentRef) {
        var nums = [];
        for (var a = 0; a < args.length; a++) {
          if (args[a].range) nums.push(args[a].range);
          else nums.push([toNum(args[a].value)]);
        }
        switch (name) {
          case 'SUM': return sumFlat(flatten(nums, false));
          case 'AVG': case 'AVERAGE': return avgFlat(flatten(nums, false));
          case 'MIN': return minFlat(flatten(nums, true));
          case 'MAX': return maxFlat(flatten(nums, true));
          case 'MEDIAN': return medianFlat(flatten(nums, true));
          case 'PRODUCT': return prodFlat(flatten(nums, true));
          case 'STDEV': return stdevFlat(flatten(nums, true));
          case 'VAR': return varFlat(flatten(nums, true));
          case 'COUNT': {
            var cnt = 0;
            for (var x = 0; x < nums.length; x++) for (var y = 0; y < nums[x].length; y++) { if (!isNaN(Number(nums[x][y]))) cnt++; }
            return cnt;
          }
          case 'ABS': return Math.abs(toNum(args[0].value));
          case 'SQRT': return Math.sqrt(toNum(args[0].value));
          case 'ROUND': return Math.round(toNum(args[0].value));
          case 'POW': return Math.pow(toNum(args[0].value), toNum(args[1].value));
          case 'ROW': {
            var pr = parseRef(currentRef);
            // 返回「数据行序号」（表头为第 0 行，第一行数据 = 1），便于做序号列
            return (pr && pr.row != null) ? Math.max(0, pr.row - 1) : 0;
          }
          case 'SORTROW': {
            var pr2 = parseRef(currentRef);
            // 计算阶段先回退为 ROW() 的值；排序阶段会再改写为「当前视觉行号」
            return (pr2 && pr2.row != null) ? Math.max(0, pr2.row - 1) : 0;
          }
          default: throw new Error('unknown function ' + name);
        }
      }
      function sumFlat(a){ var s=0; for(var i=0;i<a.length;i++) s+=a[i]; return s; }
      function avgFlat(a){ return a.length? sumFlat(a)/a.length : 0; }
      function minFlat(a){ var m=Infinity; for(var i=0;i<a.length;i++) if(a[i]<m) m=a[i]; return a.length?m:0; }
      function maxFlat(a){ var m=-Infinity; for(var i=0;i<a.length;i++) if(a[i]>m) m=a[i]; return a.length?m:0; }
      function prodFlat(a){ var p=1; for(var i=0;i<a.length;i++) p*=a[i]; return p; }
      function medianFlat(a){ if(!a.length) return 0; var b=a.slice().sort(function(x,y){return x-y;}); var n=b.length; return n%2? b[(n-1)/2] : (b[n/2-1]+b[n/2])/2; }
      function mean(a){ return a.length? sumFlat(a)/a.length : 0; }
      function varFlat(a){ if(a.length<2) return 0; var m=mean(a); var s=0; for(var i=0;i<a.length;i++) s+=(a[i]-m)*(a[i]-m); return s/(a.length-1); }
      function stdevFlat(a){ return Math.sqrt(varFlat(a)); }

      function parseAddSub(pos) {
        var left = parseMulDiv(pos);
        while (true) {
          var tk = pos.tokens[pos.i];
          if (tk && (tk.t === '+' || tk.t === '-')) {
            pos.i++;
            var right = parseMulDiv(pos);
            left = (tk.t === '+') ? (toNum(left) + toNum(right)) : (toNum(left) - toNum(right));
          } else break;
        }
        return left;
      }
      function parseMulDiv(pos) {
        var left = parsePow(pos);
        while (true) {
          var tk = pos.tokens[pos.i];
          if (tk && (tk.t === '*' || tk.t === '/')) {
            pos.i++;
            var right = parsePow(pos);
            left = (tk.t === '*') ? (toNum(left) * toNum(right)) : (toNum(left) / toNum(right));
          } else break;
        }
        return left;
      }
      function parsePow(pos) {
        var left = parseUnary(pos);
        var tk = pos.tokens[pos.i];
        if (tk && tk.t === '^') { pos.i++; var right = parsePow(pos); left = Math.pow(toNum(left), toNum(right)); }
        return left;
      }
      function parseUnary(pos) {
        var tk = pos.tokens[pos.i];
        if (tk && tk.t === '-') { pos.i++; return -toNum(parseUnary(pos)); }
        if (tk && tk.t === '+') { pos.i++; return toNum(parseUnary(pos)); }
        return parsePrimary(pos);
      }
      function parsePrimary(pos) {
        var tk = pos.tokens[pos.i];
        if (!tk) throw new Error('unexpected end');
        if (tk.t === 'num') { pos.i++; return tk.v; }
        if (tk.t === '(') {
          pos.i++; var v = parseAddSub(pos);
          if (pos.tokens[pos.i] && pos.tokens[pos.i].t === ')') pos.i++;
          else throw new Error('missing )');
          return v;
        }
        if (tk.t === 'func') {
          pos.i++;
          if (!pos.tokens[pos.i] || pos.tokens[pos.i].t !== '(') throw new Error('func missing (');
          pos.i++;
          var args = [];
          if (pos.tokens[pos.i] && pos.tokens[pos.i].t !== ')') {
            args.push(parseArg(pos));
            while (pos.tokens[pos.i] && pos.tokens[pos.i].t === ',') { pos.i++; args.push(parseArg(pos)); }
          }
          if (!pos.tokens[pos.i] || pos.tokens[pos.i].t !== ')') throw new Error('func missing )');
          pos.i++;
          return callFunc(tk.v, args, pos.currentRef);
        }
        if (tk.t === 'var') {
          pos.i++;
          if (VARS.hasOwnProperty(tk.v)) return VARS[tk.v];
          throw new Error('undefined variable ' + tk.v);
        }
        if (tk.t === 'ref') {
          if (pos.tokens[pos.i + 1] && pos.tokens[pos.i + 1].t === ':') {
            var startRef = tk.v; pos.i += 2;
            var endTk = pos.tokens[pos.i];
            if (!endTk || endTk.t !== 'ref') throw new Error('bad range');
            pos.i++;
            return getRange(startRef, endTk.v);
          }
          pos.i++;
          return evalCell(tk.v);
        }
        throw new Error('unexpected token ' + JSON.stringify(tk));
      }
      function parseArg(pos) {
        var tk = pos.tokens[pos.i];
        if (tk && tk.t === 'ref' && pos.tokens[pos.i + 1] && pos.tokens[pos.i + 1].t === ':') {
          var startRef = tk.v; pos.i += 2;
          var endTk = pos.tokens[pos.i];
          if (!endTk || endTk.t !== 'ref') throw new Error('bad range in arg');
          pos.i++;
          return { range: getRange(startRef, endTk.v) };
        }
        return { value: parseAddSub(pos) };
      }
      function evalFormula(expr, currentRef) {
        var tokens = tokenize(expr);
        var pos = { i: 0, tokens: tokens, currentRef: currentRef };
        if (tokens.length === 0) throw new Error('empty formula');
        var val = parseAddSub(pos);
        if (pos.i < tokens.length) throw new Error('trailing tokens');
        if (Array.isArray(val)) throw new Error('range not allowed as result');
        return val;
      }

      // 计算并写入所有公式单元格
      for (var r = 1; r <= rowArr.length; r++) {
        for (var c = 0; c < rowArr[r - 1].length; c++) {
          var el = rowArr[r - 1][c];
          var raw = el.textContent.trim();
          if (raw.charAt(0) === '=') {
            var exprBody = raw.slice(1).trim();
            var asPct = false;
            if (exprBody.charAt(exprBody.length - 1) === '%') {
              asPct = true;
              exprBody = exprBody.slice(0, -1).trim();
            }
            var ref = indexToCol(c) + r;
            var v;
            try { v = evalCell(ref); } catch (e) { v = NaN; }
            var display = isNaN(v) ? '#ERR' : (asPct ? formatPercent(v) : formatNum(v));
            el.textContent = display;
            el.setAttribute('title', raw + ' = ' + display);
            el.setAttribute('data-formula', raw);
            if (!isNaN(v)) el.setAttribute('data-val', String(v));
            el.classList.add('calc-cell');
          }
        }
      }
    }


function processSortTables(html) {
  if (!html || typeof document === 'undefined') return html;
  var holder = document.createElement('div');
  holder.innerHTML = html;
  var paras = holder.querySelectorAll('p');
  var SUMMARY_RE = /^(平均|合计|总计|小计|小計|總計|總和|均值|汇总|彙總)(?:\s|$)/;
  for (var i = 0; i < paras.length; i++) {
    var p = paras[i];
    if (p.getAttribute('data-sort-marker')) continue;
    var m = (p.textContent || '').match(/\{\{sort:\s*([^}]*)\}\}/);
    if (!m) continue;
    var body = m[1].trim();
    if (!body) continue;
    var parts = body.split(/[\s,]+/).filter(Boolean);
    var colSpec = parts[0];
    var dir = (parts[1] || 'asc').toLowerCase();
    if (dir === '降序') dir = 'desc';
    else if (dir === '升序') dir = 'asc';
    if (dir !== 'asc' && dir !== 'desc') dir = 'asc';
    var table = findNextTable(p);
    if (!table) continue;
    try {
      sortTableRows(table, colSpec, dir, SUMMARY_RE);
      p.style.display = 'none';
      p.setAttribute('data-sort-marker', 'true');
      table.classList.add('sorted-table');
    } catch (e) {
      console.error('[ToDoList] sort table error:', e);
    }
  }
  return holder.innerHTML;
}

function colIndexFromSpec(table, colSpec) {
  if (/^\d+$/.test(colSpec)) return parseInt(colSpec, 10) - 1; // 列序号（1 起）
  if (/^[A-Za-z]+$/.test(colSpec)) {                            // 列字母 A–Z
    var idx = 0;
    for (var k = 0; k < colSpec.length; k++) idx = idx * 26 + (colSpec.charCodeAt(k) - 64);
    return idx - 1;
  }
  var thead = table.querySelector('thead');                    // 列名：匹配表头文本
  var headCells = thead ? thead.querySelectorAll('th, td') : [];
  for (var c = 0; c < headCells.length; c++) {
    if ((headCells[c].textContent || '').trim() === colSpec) return c;
  }
  for (var c2 = 0; c2 < headCells.length; c2++) {
    if ((headCells[c2].textContent || '').indexOf(colSpec) !== -1) return c2; // 模糊包含兜底
  }
  return -1;
}

function cellSortVal(el) {
  if (el.hasAttribute('data-val')) {
    var dv = parseFloat(el.getAttribute('data-val'));
    if (!isNaN(dv)) return { num: dv, isNum: true };
  }
  var txt = (el.textContent || '').trim();
  var n = parseFloat(txt.replace(/[%,¥$]/g, ''));
  if (!isNaN(n) && /[-0-9.]/.test(txt)) return { num: n, isNum: true };
  return { str: txt, isNum: false };
}

function sortTableRows(table, colSpec, dir, summaryRe) {
  var col = colIndexFromSpec(table, colSpec);
  if (col < 0) { console.warn('[ToDoList] 排序列未找到:', colSpec); return; }
  var tbody = table.querySelector('tbody');
  var headerRow = null;
  var rows;
  if (!tbody) { // 极少见（无 tbody）：把首个 tr 当表头，不参与排序
    var all = Array.prototype.slice.call(table.querySelectorAll('tr'));
    if (all.length < 2) return;
    headerRow = all[0];
    tbody = table;
    rows = all.slice(1);
  } else {
    rows = Array.prototype.slice.call(tbody.querySelectorAll('tr'));
  }
  // 移除 marked 在某些 HTML 块包裹（如 <SMALL>）下可能产生的空行
  for (var e = rows.length - 1; e >= 0; e--) {
    var rowCells = rows[e].querySelectorAll('th, td');
    var allEmpty = true;
    for (var ec = 0; ec < rowCells.length; ec++) {
      if ((rowCells[ec].textContent || '').trim() !== '') { allEmpty = false; break; }
    }
    if (allEmpty && rows[e].parentNode) {
      rows[e].parentNode.removeChild(rows[e]);
      rows.splice(e, 1);
    }
  }
  if (rows.length < 2) return;
  var dataRows = [], summaryRows = [];
  for (var r = 0; r < rows.length; r++) {
    var cells = rows[r].querySelectorAll('th, td');
    var isSummary = false;
    for (var c = 0; c < cells.length; c++) {
      var txt = (cells[c].textContent || '').trim();
      if (summaryRe.test(txt)) { isSummary = true; break; }
    }
    if (isSummary) summaryRows.push(rows[r]);
    else dataRows.push(rows[r]);
  }
  if (dataRows.length >= 2) {
    dataRows.sort(function (a, b) {
      var ca = a.querySelectorAll('th, td')[col];
      var cb = b.querySelectorAll('th, td')[col];
      if (!ca || !cb) return 0;
      var va = cellSortVal(ca), vb = cellSortVal(cb);
      var cmp;
      if (va.isNum && vb.isNum) cmp = va.num - vb.num;
      else if (va.isNum) cmp = -1;   // 数字优先于文本
      else if (vb.isNum) cmp = 1;
      else cmp = va.str < vb.str ? -1 : (va.str > vb.str ? 1 : 0);
      return dir === 'desc' ? -cmp : cmp;
    });
  }
  // 重排：表头(若有) → 已排序数据行 → 汇总行固定表尾
  if (headerRow) tbody.insertBefore(headerRow, tbody.firstChild);
  for (var d = 0; d < dataRows.length; d++) tbody.appendChild(dataRows[d]);
  for (var s = 0; s < summaryRows.length; s++) tbody.appendChild(summaryRows[s]);

  // 对 =SORTROW() 单元格按当前视觉顺序重新编号（1 起）
  var visibleRows = tbody.querySelectorAll('tr');
  var visualIdx = 0;
  for (var v = 0; v < visibleRows.length; v++) {
    if (visibleRows[v] === headerRow) continue;
    visualIdx++;
    var cells = visibleRows[v].querySelectorAll('th, td');
    for (var c = 0; c < cells.length; c++) {
      var formula = cells[c].getAttribute('data-formula');
      if (formula && formula.trim().toUpperCase() === '=SORTROW()') {
        cells[c].textContent = String(visualIdx);
        cells[c].setAttribute('data-val', String(visualIdx));
        cells[c].setAttribute('title', '=SORTROW() = ' + visualIdx);
      }
    }
  }
}

function parseRefMarks(label) {
  var marks = [
    { ch: '※', cls: 'ref-num' },
    { ch: '▣', cls: 'ref-card' },
    { ch: '◎', cls: 'ref-circle' },
    { ch: '↑', cls: 'ref-up' },
    { ch: '↓', cls: 'ref-down' }
  ];
  var classes = [];
  var clean = label;
  var found = false;
  for (var i = 0; i < marks.length; i++) {
    var ch = marks[i].ch;
    if (clean.indexOf(ch) !== -1) {
      classes.push(marks[i].cls);
      clean = clean.replace(new RegExp(escapeRegExp(ch), 'g'), '');
      found = true;
    }
  }
  clean = clean.replace(/^\s+|\s+$/g, '');
  return { found: found, classes: classes.join(' '), clean: clean };
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function transformCardLinks(html) {
  if (!html) return html;
  return html.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, function (_full, attrsStr, label) {
    var hrefMatch = attrsStr.match(/\bhref="((?:card|win-img|win|cur|exec|edit):[^"]*)"/i);
    if (!hrefMatch) {
      var parsed = parseRefMarks(label);
      if (parsed.found) {
        return '<a class="' + parsed.classes + '"' + attrsStr + '>' + parsed.clean + '</a>';
      }
      return _full;
    }
    var href = hrefMatch[1];
    var scheme = href.slice(0, href.indexOf(':')).toLowerCase();
    var refParsed = parseRefMarks(label);
    var finalLabel = refParsed.found ? refParsed.clean : label;
    var refNumClass = refParsed.found ? (' ' + refParsed.classes) : '';

    if (scheme === 'win-img') {
      var imgSrc = decodeURIComponentSafe(href.slice(href.indexOf(':') + 1));
      if (!imgSrc) return _full;
      var otherAttrs = attrsStr.replace(/\s*href="win-img:[^"]*"/i, '');
      return '<a class="card-win-img-link' + refNumClass + '" data-img-src="' + escapeHtml(imgSrc) + '"' + otherAttrs + '>' + finalLabel + '</a>';
    }
    if (scheme === 'cur') {
      var curUrl = decodeURIComponentSafe(href.slice(href.indexOf(':') + 1));
      if (!curUrl) return _full;
      var otherAttrs2 = attrsStr.replace(/\s*href="cur:[^"]*"/i, '');
      return '<a class="card-cur-link' + refNumClass + '" href="' + escapeHtml(curUrl) + '" target="_blank" rel="noopener"' + otherAttrs2 + '>' + finalLabel + '</a>';
    }
    if (scheme === 'exec' || scheme === 'edit') {
      return '<span class="card-disabled-link' + refNumClass + '" title="Lite 不支援 ' + scheme + ': 協議">' + escapeHtml(finalLabel) + '</span>';
    }
    var otherAttrs3 = attrsStr.replace(/\s*href="(?:card|win):[^"]*"/i, '');
    var url = (scheme === 'win') ? href.slice(href.indexOf(':') + 1) : '#';
    var targetAttr = (scheme === 'win') ? ' target="_blank" rel="noopener"' : '';
    var cls = (scheme === 'win') ? 'card-win-link' : 'card-jump-link';
    return '<a class="' + cls + refNumClass + '" href="' + escapeHtml(url) + '"' + targetAttr + otherAttrs3 + '>' + finalLabel + '</a>';
  });
}

function decodeURIComponentSafe(s) {
  try { return decodeURIComponent(s || '').trim(); }
  catch (_) { return (s || '').trim(); }
}

function assignHeadingIds(html) {
  if (!html || typeof DOMParser === 'undefined') return html;
  var doc = new DOMParser().parseFromString(html, 'text/html');
  var headings = doc.querySelectorAll('h1, h2, h3, h4, h5, h6');
  var used = {};
  for (var i = 0; i < headings.length; i++) {
    var h = headings[i];
    var base = slugify(h.textContent);
    var id = base || ('heading-' + i);
    var suffix = 1;
    while (used[id]) id = base + '-' + suffix++;
    used[id] = true;
    h.id = id;
  }
  var links = doc.querySelectorAll('a[href^="#"]');
  for (var j = 0; j < links.length; j++) {
    var a = links[j];
    var frag = a.getAttribute('href').slice(1);
    var target = doc.getElementById(frag);
    if (!target) {
      var normalized = slugify(decodeURIComponentSafe(frag));
      if (used[normalized]) a.setAttribute('href', '#' + normalized);
    }
  }
  return doc.body.innerHTML;
}

function processToc(html) {
  if (!html || html.indexOf('[TOC]') === -1 || typeof DOMParser === 'undefined') return html;
  var doc = new DOMParser().parseFromString(html, 'text/html');
  var tocEls = doc.querySelectorAll('p');
  var headings = doc.querySelectorAll('h1, h2, h3, h4, h5, h6');
  for (var i = 0; i < tocEls.length; i++) {
    var p = tocEls[i];
    if (p.textContent.trim() !== '[TOC]') continue;
    if (headings.length === 0) { p.innerHTML = '<em>（無標題）</em>'; continue; }
    var ul = document.createElement('ul');
    ul.className = 'md-toc';
    for (var h = 0; h < headings.length; h++) {
      var heading = headings[h];
      var li = document.createElement('li');
      li.className = 'md-toc-' + heading.tagName.toLowerCase();
      var a = document.createElement('a');
      a.href = '#' + (heading.id || slugify(heading.textContent));
      a.textContent = heading.textContent;
      li.appendChild(a);
      ul.appendChild(li);
    }
    p.replaceWith(ul);
  }
  return doc.body.innerHTML;
}
