/* ============================================================
   romanize.js — Thai script -> Latin letters (RTGS style)

   The Royal Thai General System of Transcription is what you see on
   Thai road signs: สวัสดี -> "sawatdi", กรุงเทพ -> "krungthep".
   There is no tone information in RTGS, and Thai writes without
   spaces, so this module does three things:

     1. looks up common whole words in a small dictionary
        (this also does the word-splitting for us),
     2. falls back to a rule-based syllable parser,
     3. leaves anything that is not Thai script untouched.

   The result is an approximation — good enough to read aloud,
   not a substitute for a full pronunciation dictionary.
   ============================================================ */

(function (global) {
  'use strict';

  /* ---------- character classes ---------- */

  var CONS = 'กขฃคฅฆงจฉชซฌญฎฏฐฑฒณดตถทธนบปผฝพฟภมยรลวศษสหฬอฮ';
  var TONES = '\u0E48\u0E49\u0E4A\u0E4B';          // ่ ้ ๊ ๋
  var MAITAIKHU = '\u0E47';                        // ็
  var KARAN = '\u0E4C';                            // ์  (silences its consonant)
  var PHINTHU = '\u0E3A';                          // ฺ
  var NIKHAHIT = '\u0E4D';                         // ํ
  var UPPER_VOWELS = '\u0E31\u0E34\u0E35\u0E36\u0E37\u0E38\u0E39'; // ั ิ ี ึ ื ุ ู
  var LEAD_VOWELS = 'เแโใไ';
  var FOLLOW_VOWELS = 'ะาำๅ';
  var CLUSTER_HEADS = 'กขคตปผพบ';
  var SONORANTS = 'งญณนมยรลวฬ';

  var INITIAL = {
    'ก': 'k', 'ข': 'kh', 'ฃ': 'kh', 'ค': 'kh', 'ฅ': 'kh', 'ฆ': 'kh', 'ง': 'ng',
    'จ': 'ch', 'ฉ': 'ch', 'ช': 'ch', 'ซ': 's', 'ฌ': 'ch', 'ญ': 'y',
    'ฎ': 'd', 'ฏ': 't', 'ฐ': 'th', 'ฑ': 'th', 'ฒ': 'th', 'ณ': 'n',
    'ด': 'd', 'ต': 't', 'ถ': 'th', 'ท': 'th', 'ธ': 'th', 'น': 'n',
    'บ': 'b', 'ป': 'p', 'ผ': 'ph', 'ฝ': 'f', 'พ': 'ph', 'ฟ': 'f', 'ภ': 'ph',
    'ม': 'm', 'ย': 'y', 'ร': 'r', 'ล': 'l', 'ว': 'w',
    'ศ': 's', 'ษ': 's', 'ส': 's', 'ห': 'h', 'ฬ': 'l', 'อ': '', 'ฮ': 'h'
  };

  var FINAL = {
    'ก': 'k', 'ข': 'k', 'ค': 'k', 'ฆ': 'k', 'ง': 'ng',
    'จ': 't', 'ช': 't', 'ซ': 't', 'ฎ': 't', 'ฏ': 't', 'ฐ': 't', 'ฑ': 't',
    'ฒ': 't', 'ด': 't', 'ต': 't', 'ถ': 't', 'ท': 't', 'ธ': 't',
    'ศ': 't', 'ษ': 't', 'ส': 't', 'ญ': 'n', 'ณ': 'n', 'น': 'n',
    'ร': 'n', 'ล': 'n', 'ฬ': 'n', 'บ': 'p', 'ป': 'p', 'พ': 'p',
    'ฟ': 'p', 'ภ': 'p', 'ม': 'm', 'ย': 'i', 'ว': 'o'
  };

  var THAI_DIGITS = { '๐': '0', '๑': '1', '๒': '2', '๓': '3', '๔': '4', '๕': '5', '๖': '6', '๗': '7', '๘': '8', '๙': '9' };

  /* ---------- irregular / very common words ----------
     Thai spelling hides a lot of pronunciation, so these are spelled out
     by hand. Matching them also splits the sentence into words for us. */

  var DICT = {
    'สวัสดี': 'sawatdi', 'สวัสดีครับ': 'sawatdi khrap', 'สวัสดีค่ะ': 'sawatdi kha',
    'ครับ': 'khrap', 'ค่ะ': 'kha', 'คะ': 'kha', 'จ้า': 'cha', 'จ๊ะ': 'cha',
    'ขอบคุณ': 'khopkhun', 'ขอบใจ': 'khopchai', 'ขอโทษ': 'khothot',
    'ยินดี': 'yindi', 'ยินดีที่ได้รู้จัก': 'yindi thi dai ruchak',
    'ไม่เป็นไร': 'mai pen rai', 'ไม่': 'mai', 'ใช่': 'chai', 'ไหม': 'mai', 'มั้ย': 'mai',
    'ผม': 'phom', 'ฉัน': 'chan', 'ดิฉัน': 'dichan', 'เรา': 'rao', 'คุณ': 'khun',
    'เขา': 'khao', 'เธอ': 'thoe', 'มัน': 'man', 'พวกเขา': 'phuak khao',
    'อะไร': 'arai', 'ที่ไหน': 'thinai', 'เมื่อไหร่': 'muearai', 'ทำไม': 'thammai',
    'อย่างไร': 'yangrai', 'ยังไง': 'yangngai', 'ใคร': 'khrai', 'เท่าไหร่': 'thaorai',
    'เท่าไร': 'thaorai', 'กี่': 'ki',
    'ที่': 'thi', 'นี่': 'ni', 'นั่น': 'nan', 'โน่น': 'non', 'นี้': 'ni', 'นั้น': 'nan',
    'และ': 'lae', 'แต่': 'tae', 'หรือ': 'rue', 'ก็': 'ko', 'กับ': 'kap', 'ของ': 'khong',
    'ใน': 'nai', 'บน': 'bon', 'ใต้': 'tai', 'จาก': 'chak', 'ถึง': 'thueng', 'ไป': 'pai',
    'มา': 'ma', 'อยู่': 'yu', 'เป็น': 'pen', 'คือ': 'khue', 'มี': 'mi', 'ได้': 'dai',
    'ให้': 'hai', 'ทำ': 'tham', 'ใช้': 'chai', 'รู้': 'ru', 'คิด': 'khit', 'ชอบ': 'chop',
    'รัก': 'rak', 'อยาก': 'yak', 'ต้องการ': 'tongkan', 'ต้อง': 'tong', 'จะ': 'cha',
    'กำลัง': 'kamlang', 'แล้ว': 'laeo', 'ยัง': 'yang', 'เคย': 'khoei', 'เลย': 'loei',
    'มาก': 'mak', 'นิดหน่อย': 'nitnoi', 'น้อย': 'noi', 'ดี': 'di', 'ดีมาก': 'di mak',
    'สบายดี': 'sabai di', 'สบาย': 'sabai', 'สวย': 'suai', 'หล่อ': 'lo', 'น่ารัก': 'narak',
    'อร่อย': 'aroi', 'เผ็ด': 'phet', 'หวาน': 'wan', 'เค็ม': 'khem', 'เปรี้ยว': 'priao',
    'ร้อน': 'ron', 'เย็น': 'yen', 'หนาว': 'nao', 'แพง': 'phaeng', 'ถูก': 'thuk',
    'ใหญ่': 'yai', 'เล็ก': 'lek', 'ใหม่': 'mai', 'เก่า': 'kao', 'เร็ว': 'reo', 'ช้า': 'cha',
    'กิน': 'kin', 'ทาน': 'than', 'ดื่ม': 'duem', 'นอน': 'non', 'ไหว': 'wai',
    'พูด': 'phut', 'ฟัง': 'fang', 'อ่าน': 'an', 'เขียน': 'khian', 'เรียน': 'rian',
    'ทำงาน': 'thamngan', 'เที่ยว': 'thiao', 'ซื้อ': 'sue', 'ขาย': 'khai', 'จ่าย': 'chai',
    'ข้าว': 'khao', 'น้ำ': 'nam', 'น้ำแข็ง': 'namkhaeng', 'กาแฟ': 'kafae', 'ชา': 'cha',
    'อาหาร': 'ahan', 'ร้านอาหาร': 'ran ahan', 'ร้าน': 'ran', 'ตลาด': 'talat',
    'โรงแรม': 'rongraem', 'โรงเรียน': 'rongrian', 'โรงพยาบาล': 'rongphayaban',
    'สนามบิน': 'sanambin', 'สถานี': 'sathani', 'ห้องน้ำ': 'hongnam', 'ห้อง': 'hong',
    'บ้าน': 'ban', 'เมือง': 'mueang', 'ประเทศ': 'prathet', 'ประเทศไทย': 'prathet thai',
    'ไทย': 'thai', 'ภาษาไทย': 'phasa thai', 'ภาษา': 'phasa', 'ภาษาอังกฤษ': 'phasa angkrit',
    'อังกฤษ': 'angkrit', 'จีน': 'chin', 'ภาษาจีน': 'phasa chin', 'คนไทย': 'khon thai',
    'คน': 'khon', 'ผู้ชาย': 'phuchai', 'ผู้หญิง': 'phuying', 'เด็ก': 'dek',
    'เพื่อน': 'phuean', 'ครอบครัว': 'khropkhrua', 'แม่': 'mae', 'พ่อ': 'pho',
    'พี่': 'phi', 'น้อง': 'nong', 'ชื่อ': 'chue', 'นามสกุล': 'namsakun',
    'เงิน': 'ngoen', 'บาท': 'bat', 'ราคา': 'rakha', 'เวลา': 'wela', 'วัน': 'wan',
    'วันนี้': 'wanni', 'พรุ่งนี้': 'phrungni', 'เมื่อวาน': 'mueawan', 'เดือน': 'duean',
    'ปี': 'pi', 'ชั่วโมง': 'chuamong', 'นาที': 'nathi', 'เช้า': 'chao', 'บ่าย': 'bai',
    'เย็นนี้': 'yen ni', 'กลางคืน': 'klangkhuen', 'ตอนนี้': 'tonni',
    'โทรศัพท์': 'thorasap', 'คอมพิวเตอร์': 'khomphiutoe', 'รถ': 'rot', 'รถไฟ': 'rotfai',
    'เครื่องบิน': 'khrueangbin', 'แท็กซี่': 'thaeksi', 'ถนน': 'thanon',
    'ช่วย': 'chuai', 'ช่วยด้วย': 'chuai duai', 'ระวัง': 'rawang', 'หยุด': 'yut',
    'เปิด': 'poet', 'ปิด': 'pit', 'เข้า': 'khao', 'ออก': 'ok',
    'หนึ่ง': 'nueng', 'สอง': 'song', 'สาม': 'sam', 'สี่': 'si', 'ห้า': 'ha',
    'หก': 'hok', 'เจ็ด': 'chet', 'แปด': 'paet', 'เก้า': 'kao', 'สิบ': 'sip',
    'ร้อย': 'roi', 'พัน': 'phan', 'หมื่น': 'muen', 'แสน': 'saen', 'ล้าน': 'lan',
    // places and longer words the syllable rules cannot split on their own
    'กรุงเทพ': 'krungthep', 'กรุงเทพมหานคร': 'krungthep mahanakhon',
    'สุวรรณภูมิ': 'suwannaphum', 'เชียงใหม่': 'chiangmai', 'ภูเก็ต': 'phuket',
    'พัทยา': 'phatthaya', 'อยุธยา': 'ayutthaya', 'ขอนแก่น': 'khonkaen',
    'หนังสือ': 'nangsue', 'อากาศ': 'akat', 'นักเรียน': 'nakrian',
    'นักศึกษา': 'naksueksa', 'มหาวิทยาลัย': 'mahawitthayalai',
    'ปลอดภัย': 'plotphai', 'สนุก': 'sanuk', 'เหนื่อย': 'nueai', 'หิว': 'hio',
    'อิ่ม': 'im', 'ป่วย': 'puai', 'หมอ': 'mo', 'ยา': 'ya', 'ตำรวจ': 'tamruat',
    'ราชการ': 'ratchakan', 'บริษัท': 'borisat', 'ธนาคาร': 'thanakhan',
    'สถานีตำรวจ': 'sathani tamruat', 'ปัญหา': 'panha', 'ประชาชน': 'prachachon',
    'เข้าใจ': 'khaochai', 'ไม่เข้าใจ': 'mai khaochai', 'พูดช้าๆ': 'phut cha cha',
    'อีกครั้ง': 'ik khrang', 'กรุณา': 'karuna', 'โปรด': 'prot',
    'มหา': 'maha', 'นคร': 'nakhon', 'ปฐม': 'pathom', 'สมัคร': 'samak',
    'อนุญาต': 'anuyat', 'สำเร็จ': 'samret', 'ผลไม้': 'phonlamai',
    'มะม่วง': 'mamuang', 'ทะเล': 'thale', 'ภูเขา': 'phukhao', 'ดอกไม้': 'dokmai',
    'กระเป๋า': 'krapao', 'สับปะรด': 'sapparot', 'กะเพรา': 'kaphrao'
  };

  // longest keys first, so "สวัสดีครับ" wins over "สวัสดี"
  var DICT_KEYS = Object.keys(DICT).sort(function (a, b) { return b.length - a.length; });
  var MAX_DICT_LEN = DICT_KEYS.length ? DICT_KEYS[0].length : 0;

  /* ---------- small helpers ---------- */

  function isThaiChar(c) { return c >= '\u0E00' && c <= '\u0E7F'; }
  function isCons(c) { return !!c && CONS.indexOf(c) !== -1; }
  function isUpperVowel(c) { return !!c && UPPER_VOWELS.indexOf(c) !== -1; }
  function isTone(c) { return !!c && (TONES.indexOf(c) !== -1 || c === MAITAIKHU || c === PHINTHU || c === NIKHAHIT); }
  function isLead(c) { return !!c && LEAD_VOWELS.indexOf(c) !== -1; }
  function isFollowVowel(c) { return !!c && FOLLOW_VOWELS.indexOf(c) !== -1; }

  // step past tone marks and other non-vowel diacritics
  function skipTones(s, k) {
    while (k < s.length && isTone(s[k])) k++;
    return k;
  }

  /* Does the consonant at position k begin a brand new syllable?
     It does when it carries its own vowel or tone mark. This is how we
     decide whether a consonant is a final of the current syllable or the
     initial of the next one — e.g. in คน the น is a final (khon), but in
     สบาย the บ carries า so it opens a new syllable (sa-bai). */
  function startsNewSyllable(s, k) {
    var c = s[k];
    if (!c) return false;
    if (isLead(c)) return true;
    if (!isCons(c)) return false;

    var m = k + 1;
    if (s[m] === 'ร' && s[m + 1] === 'ร') return true;   // …รร… is a vowel pattern
    if (CLUSTER_HEADS.indexOf(c) !== -1 && 'รลว'.indexOf(s[m]) !== -1) m++;
    else if (c === 'ห' && SONORANTS.indexOf(s[m]) !== -1) m++;

    var n = s[m];
    if (!n) return false;
    if (n === KARAN) return false;            // silent letter, not a new syllable
    if (isUpperVowel(n) || isFollowVowel(n)) return true;
    if (isTone(n)) return true;
    // …C อ C… means the อ is this consonant's vowel (สมอง -> sa-mong), but
    // อย is the silent-อ cluster of the *next* word (ทุกอย่าง -> thuk yang)
    if (n === 'อ' && c !== 'อ' && isCons(s[m + 1]) && s[m + 1] !== 'ย') return true;
    return false;
  }

  /* Read the initial consonant (or consonant cluster) at position k. */
  function readInitial(s, k) {
    var c = s[k];
    if (!c) return null;

    if (c === 'ฤ') return { rom: 'rue', end: k + 1 };
    if (!isCons(c)) return null;

    var nxt = s[k + 1];

    // true clusters: kr- khl- pr- phl- tr- …
    if (CLUSTER_HEADS.indexOf(c) !== -1 && nxt && 'รลว'.indexOf(nxt) !== -1) {
      // ...but only when something follows the cluster, otherwise the second
      // letter is a final (e.g. นคร -> nakhon) and belongs to the syllable end.
      var after = skipTones(s, k + 2);
      var a = s[after];
      if (isUpperVowel(a) || isFollowVowel(a) || a === 'อ' || isCons(a)) {
        var second = nxt === 'ว' ? 'w' : nxt === 'ล' ? 'l' : 'r';
        return { rom: INITIAL[c] + second, end: k + 2 };
      }
    }

    // ทร is pronounced "s" (ทราย = sai)
    if (c === 'ท' && nxt === 'ร') {
      var a2 = s[skipTones(s, k + 2)];
      if (isUpperVowel(a2) || isFollowVowel(a2)) return { rom: 's', end: k + 2 };
    }

    // silent ห / silent อ in front of a sonorant (หมา = ma, อย่าง = yang)
    if (c === 'ห' && nxt && SONORANTS.indexOf(nxt) !== -1) {
      return { rom: INITIAL[nxt], end: k + 2 };
    }
    if (c === 'อ' && nxt === 'ย') {
      return { rom: 'y', end: k + 2 };
    }

    return { rom: INITIAL[c], end: k + 1 };
  }

  /* Read one syllable starting at i. Returns { rom, end } or null. */
  function readSyllable(s, i) {
    var j = i;
    var lead = '';

    if (isLead(s[j])) { lead = s[j]; j++; }

    var init = readInitial(s, j);
    if (!init) return null;
    j = init.end;
    j = skipTones(s, j);

    var vowel = '';
    var allowFinal = true;
    var c = s[j];
    var c2 = s[j + 1];

    if (lead === 'เ') {
      if (c === 'ี' && s[skipTones(s, j + 1)] === 'ย') { vowel = 'ia'; j = skipTones(s, j + 1) + 1; }
      else if (c === 'ื') { vowel = 'uea'; j++; if (s[j] === 'อ') j++; }
      else if (c === 'อ') { vowel = 'oe'; j++; }
      else if (c === 'ิ') { vowel = 'oe'; j++; }
      else if (c === 'า' && c2 === 'ะ') { vowel = 'o'; j += 2; allowFinal = false; }
      else if (c === 'า') { vowel = 'ao'; j++; allowFinal = false; }
      else if (c === 'ะ') { vowel = 'e'; j++; allowFinal = false; }
      else if (c === 'ย') { vowel = 'oei'; j++; allowFinal = false; }
      else if (c === 'ว') { vowel = 'eo'; j++; allowFinal = false; }
      else { vowel = 'e'; }
    } else if (lead === 'แ') {
      if (c === 'ะ') { vowel = 'ae'; j++; allowFinal = false; }
      else if (c === 'ว') { vowel = 'aeo'; j++; allowFinal = false; }
      else { vowel = 'ae'; }
    } else if (lead === 'โ') {
      vowel = 'o';
      if (c === 'ะ') { j++; allowFinal = false; }
    } else if (lead === 'ใ' || lead === 'ไ') {
      vowel = 'ai';
      allowFinal = false;
      if (c === 'ย') j++;           // ไทย -> thai, the ย is not pronounced
    } else if (c === 'ั') {
      if (c2 === 'ว') { vowel = 'ua'; j += 2; if (s[j] === 'ะ') { j++; allowFinal = false; } }
      else { vowel = 'a'; j++; }
    } else if (c === 'ื') {
      // ือ on its own is "ue" (มือ -> mue); "uea" only appears after เ
      vowel = 'ue';
      j++;
      if (s[j] === 'อ') j++;
    } else if (c === 'ึ') { vowel = 'ue'; j++; }
    else if (c === 'ิ') { j++; if (s[j] === 'ว') { vowel = 'io'; j++; allowFinal = false; } else { vowel = 'i'; } }
    else if (c === 'ี') { j++; if (s[j] === 'ย') { vowel = 'ia'; j++; } else { vowel = 'i'; } }
    else if (c === 'ุ') { vowel = 'u'; j++; }
    else if (c === 'ู') { vowel = 'u'; j++; }
    else if (c === 'า') { vowel = 'a'; j++; }
    else if (c === 'ำ') { vowel = 'am'; j++; allowFinal = false; }
    else if (c === 'ะ') { vowel = 'a'; j++; allowFinal = false; }
    else if (c === 'อ' && init.rom !== '') { vowel = 'o'; j++; }
    else if (c === 'ฤ') { vowel = 'ri'; j++; }
    else if (c === 'ว' && isCons(c2) && !isUpperVowel(s[j + 2])) { vowel = 'ua'; j++; }
    else if (c === 'ร' && c2 === 'ร') {
      j += 2;
      if (isCons(s[j]) && !startsNewSyllable(s, j)) { vowel = 'a'; }
      else { vowel = 'an'; allowFinal = false; }
    } else if (isCons(c)) {
      // no written vowel: either an implied "a" (open) or an implied "o" (closed)
      if (startsNewSyllable(s, j)) { vowel = 'a'; allowFinal = false; }
      else { vowel = 'o'; }
    } else {
      vowel = 'o';
      allowFinal = false;
    }

    /* ---- final consonant ----
       Letters carrying ์ are silent and skipped (สัตว์ -> sat, จอห์น -> chon),
       and a leftover ร/ล after the real final is silent too (บัตร -> bat). */
    var fin = '';
    if (allowFinal) {
      var taken = false;
      while (true) {
        j = skipTones(s, j);
        var fc = s[j];
        if (!isCons(fc)) break;

        var afterFc = skipTones(s, j + 1);
        if (s[afterFc] === KARAN) { j = afterFc + 1; continue; }   // silent letter
        if (startsNewSyllable(s, j)) break;

        if (taken) {
          // a stray ร/ล right at the end of a word is not pronounced
          // (บัตร -> bat), but mid-word it opens the next syllable (ขับรถ -> khap rot)
          var tail = skipTones(s, j + 1);
          if ((fc === 'ร' || fc === 'ล') && !isCons(s[tail])) { j++; continue; }
          break;
        }
        fin = FINAL[fc] || '';
        taken = true;
        j++;
      }
      if (!taken && s[j] === NIKHAHIT) { fin = 'm'; j++; }
    }

    j = skipTones(s, j);
    if (s[j] === KARAN) j++;

    if (j === i) return null;
    return { rom: init.rom + vowel + fin, end: j };
  }

  /* Dictionary lookup with a guard: reject a match when the very next
     character is a vowel/tone mark, which means we cut a word in half. */
  function dictLookup(s, i) {
    var max = Math.min(MAX_DICT_LEN, s.length - i);
    for (var len = max; len > 0; len--) {
      var slice = s.substr(i, len);
      if (!Object.prototype.hasOwnProperty.call(DICT, slice)) continue;
      var next = s[i + len];
      if (next && (isUpperVowel(next) || isTone(next) || isFollowVowel(next) || next === KARAN)) continue;
      return { rom: DICT[slice], end: i + len };
    }
    return null;
  }

  /* Walk a stretch of pure Thai script, keeping each piece next to the
     letters it came from. romanizeRun() and segments() both read this,
     so they can never disagree about where the word boundaries are. */
  function splitRun(run) {
    var parts = [];
    var i = 0;
    var guard = 0;

    while (i < run.length && guard++ < 10000) {
      var ch = run[i];

      if (ch === 'ๆ') {                                   // repeat previous syllable
        if (parts.length) parts.push({ thai: ch, rom: parts[parts.length - 1].rom });
        i++;
        continue;
      }
      if (ch === 'ฯ' || ch === '\u0E3F') { i++; continue; } // abbreviation mark, baht sign
      if (THAI_DIGITS[ch]) { parts.push({ thai: ch, rom: THAI_DIGITS[ch] }); i++; continue; }

      var d = dictLookup(run, i);
      if (d) { parts.push({ thai: run.slice(i, d.end), rom: d.rom }); i = d.end; continue; }

      var syl = readSyllable(run, i);
      if (syl && syl.end > i) { parts.push({ thai: run.slice(i, syl.end), rom: syl.rom }); i = syl.end; continue; }

      i++;                                                 // unknown mark, drop it
    }

    return parts;
  }

  /* Romanize a stretch of pure Thai script. */
  function romanizeRun(run) {
    return splitRun(run).map(function (p) { return p.rom; }).filter(Boolean).join(' ');
  }

  /* Public entry point: romanize Thai, keep everything else as-is. */
  function romanize(text) {
    if (!text) return '';
    var out = '';
    var buf = '';

    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (isThaiChar(c)) {
        buf += c;
      } else {
        if (buf) { out += romanizeRun(buf); buf = ''; }
        out += c;
      }
    }
    if (buf) out += romanizeRun(buf);

    return out.replace(/[ \t]{2,}/g, ' ').replace(/ ([,.!?;:)])/g, '$1').trim();
  }

  function containsThai(text) {
    return /[\u0E00-\u0E7F]/.test(text || '');
  }

  /* segments(text) -> [{ text, roman, thai }]
     The same pieces romanize() produces, but kept separate so the
     interface can show a tappable word-by-word breakdown. Non-Thai
     stretches come back as plain words with no romanization. */
  function segments(text) {
    var out = [];
    if (!text) return out;

    var thaiBuf = '';
    var plainBuf = '';

    function flushThai() {
      if (!thaiBuf) return;
      splitRun(thaiBuf).forEach(function (p) {
        if (p.rom) out.push({ text: p.thai, roman: p.rom, thai: true });
      });
      thaiBuf = '';
    }

    function flushPlain() {
      if (!plainBuf) return;
      plainBuf.split(/\s+/).forEach(function (word) {
        var clean = word.replace(/^[^\w\u00C0-\uFFFF]+|[^\w\u00C0-\uFFFF]+$/g, '');
        if (clean) out.push({ text: clean, roman: '', thai: false });
      });
      plainBuf = '';
    }

    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (isThaiChar(c)) {
        flushPlain();
        thaiBuf += c;
      } else {
        flushThai();
        plainBuf += c;
      }
    }
    flushThai();
    flushPlain();

    return out;
  }

  global.ThaiRomanizer = { romanize: romanize, containsThai: containsThai, segments: segments };
})(window);
