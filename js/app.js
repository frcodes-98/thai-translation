/* ============================================================
   app.js — wires the interface to the translate / romanize /
   speech / OCR modules.

   Sections, in order:
     shared helpers · languages · views · text · word breakdown
     · picture · voice · phrasebook & journal · start-up
   ============================================================ */

(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var HISTORY_KEY = 'polylingo.history.v1';
  var PHRASE_KEY  = 'polylingo.phrasebook.v1';
  var PREFS_KEY   = 'polylingo.prefs.v1';

  /* ============================================================
     shared helpers
     ============================================================ */

  var toastEl = $('toast');
  var toastTimer = null;

  function toast(message, isError) {
    toastEl.textContent = message;
    toastEl.className = 'toast' + (isError ? ' error' : '');
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, isError ? 5600 : 2600);
  }

  function copyText(text) {
    if (!text || !text.trim()) { toast('Nothing to copy'); return; }
    if (!navigator.clipboard) { toast('This browser will not let the page copy text', true); return; }
    navigator.clipboard.writeText(text)
      .then(function () { toast('Copied'); })
      .catch(function () { toast('Could not copy to the clipboard', true); });
  }

  function speakOrWarn(text, lang) {
    if (!text || !text.trim()) { toast('Nothing to read out'); return; }

    var hasVoice = Speech.speak(text, lang);
    if (hasVoice) return;

    var name = Translator.languageName(lang);
    toast(Speech.capabilities().isIOS
      ? 'No ' + name + ' voice on this iPhone yet — add one under Settings › Accessibility › Spoken Content › Voices.'
      : 'No ' + name + ' voice is installed here — using the default voice.');
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function icon(name) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'ico');
    svg.setAttribute('aria-hidden', 'true');
    var use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#' + name);
    svg.appendChild(use);
    return svg;
  }

  /* ============================================================
     languages
     ============================================================ */

  var LANGS = [
    { code: 'auto',  short: 'Detect',   native: 'Detect language', sub: 'Work it out from the text', sourceOnly: true },
    { code: 'en',    short: 'English',  native: 'English',         sub: 'English' },
    { code: 'th',    short: 'Thai',     native: 'ไทย',              sub: 'Thai — always shown with romanization' },
    { code: 'zh-CN', short: '简体中文',  native: '简体中文',          sub: 'Chinese (Simplified)' },
    { code: 'zh-TW', short: '繁體中文',  native: '繁體中文',          sub: 'Chinese (Traditional)' }
  ];

  function langInfo(code) {
    for (var i = 0; i < LANGS.length; i++) if (LANGS[i].code === code) return LANGS[i];
    var name = Translator.languageName(code);
    return { code: code, short: name, native: name, sub: name };
  }

  function isKnownLang(code) {
    return LANGS.some(function (l) { return l.code === code; });
  }

  var state = { source: 'th', target: 'en' };

  /* Whichever of the two sides is not Thai — used for word glosses. */
  function otherSideOf(thaiSide) {
    if (thaiSide === 'target') return state.source === 'auto' ? (lastDetected || 'en') : state.source;
    return state.target;
  }

  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ source: state.source, target: state.target }));
    } catch (e) { /* private mode */ }
  }

  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
      if (isKnownLang(p.source)) state.source = p.source;
      if (isKnownLang(p.target) && p.target !== 'auto') state.target = p.target;
    } catch (e) { /* ignore */ }
  }

  function renderRoute() {
    $('fromValue').textContent = langInfo(state.source).short;
    $('toValue').textContent = langInfo(state.target).short;
    $('fromBtn').setAttribute('aria-label', 'Translate from ' + langInfo(state.source).sub + '. Change it.');
    $('toBtn').setAttribute('aria-label', 'Translate into ' + langInfo(state.target).sub + '. Change it.');

    document.querySelectorAll('.chip').forEach(function (chip) {
      var pair = chip.dataset.pair.split(',');
      var on = pair[0] === state.source && pair[1] === state.target;
      chip.classList.toggle('is-active', on);
      chip.setAttribute('aria-pressed', String(on));
    });
  }

  function setLangs(source, target) {
    if (source) state.source = source;
    if (target && target !== 'auto') state.target = target;

    // the same language on both sides is never what anyone means, so the
    // side that was not just picked gives way
    if (state.source !== 'auto' && state.source === state.target) {
      if (source) state.target = state.source === 'en' ? 'th' : 'en';
      else state.source = 'auto';
    }

    renderRoute();
    savePrefs();
    updateSaveButton();
    if (sourceText.value.trim()) runTextTranslation();
  }

  /* --- the language picker sheet --- */

  function openLangSheet(side) {
    $('sheet-lang-title').textContent = side === 'source' ? 'Translate from' : 'Translate into';

    var list = $('langOptions');
    list.innerHTML = '';

    LANGS.forEach(function (lang) {
      if (side === 'target' && lang.sourceOnly) return;

      var button = el('button', 'optrow');
      button.type = 'button';
      button.setAttribute('role', 'radio');
      button.setAttribute('aria-checked', String(state[side] === lang.code));

      var text = el('span', 'optrow-text');
      text.appendChild(el('span', 'optrow-native', lang.native));
      text.appendChild(el('span', 'optrow-sub', lang.sub));
      button.appendChild(text);
      button.appendChild(icon('i-check'));

      button.addEventListener('click', function () {
        Sheets.close();
        if (side === 'source') setLangs(lang.code, null);
        else setLangs(null, lang.code);
      });

      list.appendChild(button);
    });

    Sheets.open('sheet-lang');
  }

  $('fromBtn').addEventListener('click', function () { openLangSheet('source'); });
  $('toBtn').addEventListener('click', function () { openLangSheet('target'); });

  document.querySelectorAll('.chip').forEach(function (chip) {
    chip.addEventListener('click', function () {
      var pair = chip.dataset.pair.split(',');
      state.source = pair[0];
      state.target = pair[1];
      renderRoute();
      savePrefs();
      updateSaveButton();
      if (sourceText.value.trim()) runTextTranslation();
    });
  });

  var swapBtn = $('swapLang');
  swapBtn.addEventListener('click', function () {
    var from = state.source === 'auto' ? (lastDetected || 'en') : state.source;

    state.source = state.target;
    state.target = from === 'auto' ? 'en' : from;

    swapBtn.classList.toggle('is-spun');

    // carry the translation over so a conversation can keep going
    var translated = targetText.textContent.trim();
    if (translated) {
      sourceText.value = translated;
      targetText.textContent = '';
      romanizeBox.hidden = true;
      providerBadge.hidden = true;
      hideWords();
      updateCount();
    }

    renderRoute();
    savePrefs();
    updateSaveButton();
    if (sourceText.value.trim()) runTextTranslation();
  });

  /* ============================================================
     views (bottom nav on phones, pill tabs on desktop)
     ============================================================ */

  function showView(id) {
    document.querySelectorAll('.view').forEach(function (view) {
      view.classList.toggle('is-active', view.id === id);
    });
    document.querySelectorAll('.tabbtn').forEach(function (button) {
      var on = button.dataset.view === id;
      button.classList.toggle('is-active', on);
      if (on) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    if (id !== 'view-voice') stopListening();
  }

  document.querySelectorAll('.tabbtn').forEach(function (button) {
    button.addEventListener('click', function () { showView(button.dataset.view); });
  });

  /* Small segmented controls inside a view. */
  function wireSegments(attribute, onPick) {
    document.querySelectorAll('.seg-btn[data-' + attribute + ']').forEach(function (button) {
      button.addEventListener('click', function () {
        var group = button.closest('.seg');
        group.querySelectorAll('.seg-btn').forEach(function (b) { b.classList.remove('is-active'); });
        button.classList.add('is-active');
        onPick(button.dataset[attribute]);
      });
    });
  }

  /* ============================================================
     text
     ============================================================ */

  var sourceText   = $('sourceText');
  var targetText   = $('targetText');
  var romanizeBox  = $('romanizeBox');
  var romanizeText = $('romanizeText');
  var romanizeSide = $('romanizeSide');
  var providerBadge = $('providerBadge');
  var translateBtn = $('translateBtn');

  var lastDetected = null;
  var lastRequest = '';
  var typingTimer = null;
  var current = { src: '', tgt: '', rom: '', srcLang: '', tgtLang: '' };

  function updateCount() {
    $('charCount').textContent = sourceText.value.length;
  }

  /* Says which side was romanized, and by what — the built-in rules and
     the AI disagree occasionally, so it is worth being honest about it. */
  function romanCaption(result) {
    if (!result.romanizedSide) return '';
    return result.romanizedSide + (result.romanizationSource === 'groq' ? ' · by Groq' : '');
  }

  function showRomanization(text, side, box, textEl, sideEl) {
    if (text) {
      textEl.textContent = text;
      if (sideEl) sideEl.textContent = side || '';
      box.hidden = false;
    } else {
      box.hidden = true;
    }
  }

  function clearTextResult() {
    lastRequest = '';                 // so a reply still in flight is ignored
    targetText.textContent = '';
    targetText.classList.remove('is-loading');
    translateBtn.disabled = false;
    romanizeBox.hidden = true;
    providerBadge.hidden = true;
    hideWords();
    current = { src: '', tgt: '', rom: '', srcLang: '', tgtLang: '' };
    updateSaveButton();
  }

  function runTextTranslation() {
    var text = sourceText.value.trim();
    if (!text) { clearTextResult(); return; }

    lastRequest = text + '|' + state.source + '|' + state.target;
    var thisRequest = lastRequest;

    targetText.classList.add('is-loading');
    translateBtn.disabled = true;

    Translator.translate({ text: text, source: state.source, target: state.target })
      .then(function (result) {
        if (thisRequest !== lastRequest) return;      // a newer request won

        lastDetected = result.detected;
        targetText.textContent = result.text;
        targetText.setAttribute('lang', Translator.normalize(state.target));

        showRomanization(result.romanization, romanCaption(result), romanizeBox, romanizeText, romanizeSide);

        providerBadge.hidden = false;
        providerBadge.textContent = state.source === 'auto'
          ? Translator.languageName(result.detected) + ' · ' + result.provider
          : result.provider;

        current = {
          src: text, tgt: result.text, rom: result.romanization,
          srcLang: result.detected, tgtLang: state.target
        };
        updateSaveButton();
        buildWordBreakdown(text, result.text);
        addHistory(current);
      })
      .catch(function (err) {
        if (thisRequest !== lastRequest) return;
        targetText.textContent = '';
        romanizeBox.hidden = true;
        providerBadge.hidden = true;
        hideWords();
        toast(err.message, true);
      })
      .finally(function () {
        if (thisRequest !== lastRequest) return;
        targetText.classList.remove('is-loading');
        translateBtn.disabled = false;
      });
  }

  sourceText.addEventListener('input', function () {
    updateCount();
    clearTimeout(typingTimer);
    typingTimer = setTimeout(runTextTranslation, 800);
  });

  sourceText.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      clearTimeout(typingTimer);
      runTextTranslation();
    }
  });

  translateBtn.addEventListener('click', function () {
    clearTimeout(typingTimer);
    runTextTranslation();
  });

  $('clearSource').addEventListener('click', function () {
    sourceText.value = '';
    clearTextResult();
    updateCount();
    sourceText.focus();
  });

  $('copyTarget').addEventListener('click', function () { copyText(targetText.textContent); });
  $('copyRoman').addEventListener('click', function () { copyText(romanizeText.textContent); });

  $('speakSource').addEventListener('click', function () {
    var lang = state.source === 'auto'
      ? (lastDetected || Translator.guessLanguage(sourceText.value))
      : state.source;
    speakOrWarn(sourceText.value, lang);
  });

  $('speakTarget').addEventListener('click', function () {
    speakOrWarn(targetText.textContent, state.target);
  });

  /* ============================================================
     word-by-word breakdown
     Romanization per word comes from ThaiRomanizer; the meaning is
     only ever fetched from the translation provider, never invented.
     ============================================================ */

  var wordCard = $('wordCard');
  var wordList = $('wordList');
  var wordSide = $('wordSide');
  var glossCache = {};
  var MAX_WORDS = 80;

  function hideWords() {
    wordCard.hidden = true;
    wordList.innerHTML = '';
  }

  function buildWordBreakdown(originalText, translatedText) {
    var thaiText = null;
    var side = null;

    if (Translator.normalize(state.target) === 'th' && ThaiRomanizer.containsThai(translatedText)) {
      thaiText = translatedText;
      side = 'target';
    } else if (ThaiRomanizer.containsThai(originalText)) {
      thaiText = originalText;
      side = 'source';
    }

    if (!thaiText) { hideWords(); return; }

    var words = ThaiRomanizer.segments(thaiText).filter(function (s) { return s.thai; });
    if (!words.length) { hideWords(); return; }

    wordList.innerHTML = '';
    var glossTarget = otherSideOf(side);

    words.slice(0, MAX_WORDS).forEach(function (word) {
      var button = el('button', 'wordchip');
      button.type = 'button';
      button.setAttribute('aria-label', word.text + ' — ' + word.roman);
      button.appendChild(el('span', 'wordchip-th', word.text));
      button.appendChild(el('span', 'wordchip-rom', word.roman));
      button.addEventListener('click', function () { openWordSheet(word, glossTarget); });
      wordList.appendChild(button);
    });

    wordSide.textContent = side === 'target' ? 'from the translation' : 'from your text';
    wordCard.hidden = false;
  }

  var wordSheetWord = null;

  function openWordSheet(word, glossTarget) {
    wordSheetWord = word;

    $('sheet-word-title').textContent = 'Word';
    $('wordBig').textContent = word.text;
    $('wordBig').setAttribute('lang', 'th');
    $('wordRom').textContent = word.roman;

    var gloss = $('wordGloss');
    var key = word.text + '|' + glossTarget;

    if (glossCache[key]) {
      gloss.classList.remove('is-loading');
      gloss.textContent = glossCache[key];
    } else {
      gloss.classList.add('is-loading');
      gloss.textContent = 'Looking it up…';

      Translator.translate({ text: word.text, source: 'th', target: glossTarget })
        .then(function (result) {
          glossCache[key] = result.text;
          if (wordSheetWord === word) {
            gloss.classList.remove('is-loading');
            gloss.textContent = result.text;
          }
        })
        .catch(function () {
          if (wordSheetWord !== word) return;
          gloss.classList.remove('is-loading');
          gloss.textContent = 'No meaning available right now — the translation service could not be reached.';
        });
    }

    Sheets.open('sheet-word');
  }

  $('wordSpeak').addEventListener('click', function () {
    if (wordSheetWord) speakOrWarn(wordSheetWord.text, 'th');
  });
  $('wordCopy').addEventListener('click', function () {
    if (wordSheetWord) copyText(wordSheetWord.text);
  });

  /* ============================================================
     picture
     ============================================================ */

  var dropzone      = $('dropzone');
  var imageInput    = $('imageInput');
  var previewWrap   = $('previewWrap');
  var previewImg    = $('previewImg');
  var cameraWrap    = $('cameraWrap');
  var cameraFeed    = $('cameraFeed');
  var ocrProgress   = $('ocrProgress');
  var ocrBar        = $('ocrBar');
  var ocrStatus     = $('ocrStatus');
  var ocrTextEl     = $('ocrText');
  var ocrTranslation = $('ocrTranslation');
  var ocrRomanBox   = $('ocrRomanBox');
  var ocrRomanText  = $('ocrRomanText');
  var ocrBadge      = $('ocrBadge');
  var ocrCard       = $('ocrCard');
  var ocrLineCard   = $('ocrLineCard');
  var ocrLineList   = $('ocrLineList');
  var ocrLineBtn    = $('ocrLineBtn');

  var currentImage = null;
  var cameraStream = null;
  var lineRows = [];

  wireSegments('ocrview', function (value) { ocrCard.dataset.view = value; });

  function showImage(src) {
    currentImage = src;
    previewImg.src = src;
    previewWrap.hidden = false;
    dropzone.hidden = true;
    closeCamera();
  }

  function resetImage() {
    currentImage = null;
    previewImg.removeAttribute('src');
    previewWrap.hidden = true;
    dropzone.hidden = false;
    ocrProgress.hidden = true;
  }

  function readFile(file) {
    if (!file || !/^image\//.test(file.type)) { toast('That file is not an image', true); return; }
    var reader = new FileReader();
    reader.onload = function (e) { showImage(e.target.result); };
    reader.onerror = function () { toast('Could not read that file', true); };
    reader.readAsDataURL(file);
  }

  $('pickImage').addEventListener('click', function () { imageInput.click(); });
  imageInput.addEventListener('change', function () { readFile(imageInput.files[0]); imageInput.value = ''; });
  $('resetImage').addEventListener('click', resetImage);

  ['dragenter', 'dragover'].forEach(function (evt) {
    dropzone.addEventListener(evt, function (e) { e.preventDefault(); dropzone.classList.add('is-over'); });
  });
  ['dragleave', 'drop'].forEach(function (evt) {
    dropzone.addEventListener(evt, function (e) { e.preventDefault(); dropzone.classList.remove('is-over'); });
  });
  dropzone.addEventListener('drop', function (e) {
    if (e.dataTransfer.files.length) readFile(e.dataTransfer.files[0]);
  });

  document.addEventListener('paste', function (e) {
    if (!$('view-image').classList.contains('is-active')) return;
    var items = (e.clipboardData || {}).items || [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') === 0) {
        readFile(items[i].getAsFile());
        e.preventDefault();
        return;
      }
    }
  });

  /* --- camera --- */

  $('openCamera').addEventListener('click', function () {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast('This browser cannot open the camera here. Use https:// or localhost.', true);
      return;
    }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      .then(function (stream) {
        cameraStream = stream;
        cameraFeed.srcObject = stream;
        cameraWrap.hidden = false;
        dropzone.hidden = true;
      })
      .catch(function () { toast('Camera access was refused or no camera was found.', true); });
  });

  function closeCamera() {
    if (cameraStream) {
      cameraStream.getTracks().forEach(function (t) { t.stop(); });
      cameraStream = null;
    }
    cameraWrap.hidden = true;
    if (!currentImage) dropzone.hidden = false;
  }

  $('closeCamera').addEventListener('click', closeCamera);

  $('snapPhoto').addEventListener('click', function () {
    if (!cameraStream) return;
    var canvas = document.createElement('canvas');
    canvas.width = cameraFeed.videoWidth;
    canvas.height = cameraFeed.videoHeight;
    canvas.getContext('2d').drawImage(cameraFeed, 0, 0);
    showImage(canvas.toDataURL('image/png'));
  });

  /* --- run OCR --- */

  $('runOcr').addEventListener('click', function () {
    if (!currentImage) return;

    ocrProgress.hidden = false;
    ocrBar.style.width = '2%';
    ocrStatus.textContent = 'Starting…';
    ocrBadge.hidden = true;
    ocrTextEl.textContent = '';
    ocrTranslation.textContent = '';
    ocrRomanBox.hidden = true;
    ocrLineCard.hidden = true;
    ocrLineList.innerHTML = '';
    lineRows = [];

    OCR.recognize(currentImage, state.source, function (progress, message) {
      ocrBar.style.width = Math.round(progress * 100) + '%';
      ocrStatus.textContent = message;
    }).then(function (result) {
      ocrProgress.hidden = true;

      if (!result.text) {
        toast('No readable text was found in that picture. Try a sharper or closer photo.', true);
        return;
      }

      ocrTextEl.textContent = result.text;
      ocrBadge.hidden = false;
      ocrBadge.textContent = 'Confidence ' + Math.round(result.confidence) + '%';
      renderLines(result.lines || []);
      translateOcrText();
    }).catch(function (err) {
      ocrProgress.hidden = true;
      toast(err.message, true);
    });
  });

  function translateOcrText() {
    var text = ocrTextEl.textContent.trim();
    if (!text) { toast('There is no text to translate'); return; }

    ocrTranslation.classList.add('is-loading');
    Translator.translate({ text: text, source: state.source, target: state.target })
      .then(function (result) {
        ocrTranslation.textContent = result.text;
        showRomanization(result.romanization, '', ocrRomanBox, ocrRomanText, null);
        addHistory({
          src: text, tgt: result.text, rom: result.romanization,
          srcLang: result.detected, tgtLang: state.target
        });
      })
      .catch(function (err) {
        ocrTranslation.textContent = '';
        ocrRomanBox.hidden = true;
        toast(err.message, true);
      })
      .finally(function () { ocrTranslation.classList.remove('is-loading'); });
  }

  $('ocrRetranslate').addEventListener('click', function () {
    renderLines(ocrTextEl.textContent.split('\n').map(function (l) { return l.trim(); }).filter(Boolean));
    translateOcrText();
  });
  $('ocrCopy').addEventListener('click', function () { copyText(ocrTranslation.textContent); });
  $('ocrSpeak').addEventListener('click', function () { speakOrWarn(ocrTranslation.textContent, state.target); });

  /* --- line by line: menus and receipts, one item per row --- */

  function renderLines(lines) {
    lineRows = [];
    ocrLineList.innerHTML = '';

    if (lines.length < 2) { ocrLineCard.hidden = true; return; }

    lines.forEach(function (line) {
      var li = document.createElement('li');
      li.appendChild(el('span', 'line-src', line));

      var rom = el('span', 'line-rom', ThaiRomanizer.containsThai(line) ? ThaiRomanizer.romanize(line) : '');
      if (!rom.textContent) rom.hidden = true;
      li.appendChild(rom);

      var tgt = el('span', 'line-tgt', '');
      tgt.hidden = true;
      li.appendChild(tgt);

      ocrLineList.appendChild(li);
      lineRows.push({ text: line, tgt: tgt, rom: rom });
    });

    ocrLineBtn.disabled = false;
    ocrLineBtn.textContent = 'Translate each line';
    ocrLineCard.hidden = false;
  }

  ocrLineBtn.addEventListener('click', function () {
    if (!lineRows.length) return;

    ocrLineBtn.disabled = true;
    var done = 0;
    var failed = 0;

    function step(index) {
      if (index >= lineRows.length) {
        ocrLineBtn.disabled = false;
        ocrLineBtn.textContent = failed ? 'Try the rest again' : 'Translated';
        if (failed) toast(failed + ' of ' + lineRows.length + ' lines could not be translated', true);
        return;
      }

      var row = lineRows[index];
      ocrLineBtn.textContent = 'Line ' + (index + 1) + ' of ' + lineRows.length + '…';

      Translator.translate({ text: row.text, source: state.source, target: state.target })
        .then(function (result) {
          row.tgt.textContent = result.text;
          row.tgt.hidden = false;
          if (result.romanization) {
            row.rom.textContent = result.romanization;
            row.rom.hidden = false;
          }
          done++;
        })
        .catch(function () { failed++; })
        .finally(function () { step(index + 1); });
    }

    step(0);
  });

  /* ============================================================
     voice
     ============================================================ */

  var micBtn    = $('micBtn');
  var micStatus = $('micStatus');
  var voiceLog  = $('voiceLog');
  var autoSpeak = $('autoSpeak');
  var continuousMode = $('continuousMode');
  var interimBubble = null;

  var VOICE_IDLE = 'Tap the microphone and start talking';
  var VOICE_EMPTY = 'Nothing yet — what you say and what it means will appear here.';

  /* Spell out exactly what is wrong, because "not supported" sends people
     hunting for a setting that does not exist. */
  function describeVoiceSupport() {
    var can = Speech.capabilities();
    var warning = $('voiceWarning');

    if (can.recognition && can.secureContext) {
      warning.hidden = true;
      return true;
    }

    warning.innerHTML = '';
    warning.hidden = false;
    micBtn.disabled = true;

    if (can.iosNonSafari) {
      warning.appendChild(el('strong', null, 'Open this page in Safari to talk. '));
      warning.appendChild(document.createTextNode(
        'On iPhone, only Safari itself can listen to the microphone — Chrome, Edge and ' +
        'Firefox all borrow Safari without that part. Everything else on this page works here.'));
      micStatus.textContent = 'Voice input needs Safari on iPhone';
    } else if (!can.secureContext) {
      warning.appendChild(el('strong', null, 'This page needs a secure address. '));
      warning.appendChild(document.createTextNode(
        'The microphone and camera only work over https:// or on localhost. Opening the file ' +
        'directly, or over a plain http:// address on your network, blocks them.'));
      micStatus.textContent = 'Voice input needs an https:// address';
    } else {
      warning.appendChild(el('strong', null, 'This browser cannot listen. '));
      warning.appendChild(document.createTextNode(
        'Speech recognition needs Safari, Chrome or Edge. Reading translations out loud still works.'));
      micStatus.textContent = 'Speech recognition is not available in this browser';
    }

    return false;
  }

  var canListen = describeVoiceSupport();

  function recognitionLocale() {
    return Translator.speechLocale(state.source === 'auto' ? 'en' : state.source);
  }

  function clearEmptyState() {
    var empty = voiceLog.querySelector('.empty');
    if (empty) empty.remove();
  }

  function showInterim(text) {
    clearEmptyState();
    if (!interimBubble) {
      interimBubble = el('div', 'bubble interim');
      voiceLog.appendChild(interimBubble);
    }
    interimBubble.innerHTML = '';
    var p = el('p', 'said');
    p.appendChild(el('small', null, 'Listening…'));
    p.appendChild(document.createTextNode(text));
    interimBubble.appendChild(p);
    voiceLog.scrollTop = voiceLog.scrollHeight;
  }

  function dropInterim() {
    if (interimBubble) { interimBubble.remove(); interimBubble = null; }
  }

  function tinyButton(label, iconName, onClick) {
    var b = el('button', 'btn tiny quiet');
    b.type = 'button';
    if (iconName) b.appendChild(icon(iconName));
    b.appendChild(el('span', null, label));
    b.addEventListener('click', onClick);
    return b;
  }

  function addVoiceEntry(said) {
    clearEmptyState();
    dropInterim();

    var bubble = el('div', 'bubble');

    var saidP = el('p', 'said');
    saidP.appendChild(el('small', null, 'You said'));
    saidP.appendChild(document.createTextNode(said));

    var gotP = el('p', 'got', 'Translating…');

    bubble.appendChild(saidP);
    bubble.appendChild(gotP);
    voiceLog.appendChild(bubble);
    voiceLog.scrollTop = voiceLog.scrollHeight;

    var targetAtStart = state.target;

    Translator.translate({ text: said, source: state.source, target: targetAtStart })
      .then(function (result) {
        gotP.textContent = result.text;

        if (result.romanization) {
          bubble.appendChild(el('p', 'rom', result.romanization));
        }

        var row = el('div', 'row');
        row.appendChild(tinyButton('Listen', 'i-speak', function () { speakOrWarn(result.text, targetAtStart); }));
        row.appendChild(tinyButton('Copy', 'i-copy', function () { copyText(result.text); }));
        row.appendChild(tinyButton('Save', 'i-bookmark', function () {
          addPhrase({ src: said, tgt: result.text, rom: result.romanization, srcLang: result.detected, tgtLang: targetAtStart });
        }));
        bubble.appendChild(row);

        voiceLog.scrollTop = voiceLog.scrollHeight;
        if (autoSpeak.checked) Speech.speak(result.text, targetAtStart);

        addHistory({
          src: said, tgt: result.text, rom: result.romanization,
          srcLang: result.detected, tgtLang: targetAtStart
        });
      })
      .catch(function (err) {
        gotP.textContent = err.message;
        gotP.classList.add('is-error');
      });
  }

  var stoppedByHand = false;
  var quickRestarts = 0;
  var lastRestart = 0;

  function goIdle() {
    micBtn.classList.remove('is-recording');
    micBtn.setAttribute('aria-label', 'Start listening');
    dropInterim();
    micStatus.textContent = VOICE_IDLE;
  }

  function startListening() {
    stoppedByHand = false;
    Speech.stopSpeaking();

    Speech.start({
      lang: recognitionLocale(),
      continuous: continuousMode.checked,
      onStart: function () {
        micBtn.classList.add('is-recording');
        micBtn.setAttribute('aria-label', 'Stop listening');
        micStatus.textContent = 'Listening in ' +
          Translator.languageName(state.source === 'auto' ? 'en' : state.source) + '… tap again to stop';
      },
      onInterim: showInterim,
      onFinal: function (text) {
        quickRestarts = 0;
        addVoiceEntry(text);
      },
      onEnd: function () {
        /* Safari on iPhone ignores continuous mode and closes the mic after
           every phrase, so reopen it ourselves — while watching for a
           restart loop, which is what happens when the mic is unavailable. */
        if (!stoppedByHand && continuousMode.checked) {
          var now = Date.now();
          quickRestarts = (now - lastRestart < 800) ? quickRestarts + 1 : 0;
          lastRestart = now;

          if (quickRestarts < 4) {
            startListening();
            return;
          }
          toast('Conversation mode kept dropping out — listening one phrase at a time instead.', true);
          continuousMode.checked = false;
        }
        goIdle();
      },
      onError: function (err) {
        var fatal = /blocked|not available|no microphone|was found/i.test(err.message);
        if (fatal) stoppedByHand = true;

        // in conversation mode a pause is normal, not worth a warning
        var justAPause = /did not hear anything/i.test(err.message);
        if (!justAPause || !continuousMode.checked) toast(err.message, true);

        if (fatal || !continuousMode.checked) goIdle();
      }
    });
  }

  function stopListening() {
    stoppedByHand = true;
    if (Speech.isListening()) {
      Speech.stop();
      goIdle();
    }
  }

  micBtn.addEventListener('click', function () {
    if (!canListen) { toast(micStatus.textContent, true); return; }
    if (Speech.isListening()) stopListening();
    else startListening();
  });

  $('clearVoice').addEventListener('click', function () {
    voiceLog.innerHTML = '';
    voiceLog.appendChild(el('p', 'empty', VOICE_EMPTY));
    interimBubble = null;
  });

  /* ============================================================
     phrasebook & journal
     ============================================================ */

  var historyList = $('historyList');
  var phraseList  = $('phraseList');
  var saveTarget  = $('saveTarget');

  function read(key) {
    try { return JSON.parse(localStorage.getItem(key) || '[]'); }
    catch (e) { return []; }
  }

  function write(key, items) {
    try { localStorage.setItem(key, JSON.stringify(items)); } catch (e) { /* quota / private mode */ }
  }

  function sameEntry(a, b) {
    return a.src === b.src && a.tgt === b.tgt && a.tgtLang === b.tgtLang;
  }

  /* --- journal (automatic) --- */

  function addHistory(entry) {
    if (!entry.src || !entry.tgt) return;
    var items = read(HISTORY_KEY).filter(function (i) {
      return !(i.src === entry.src && i.tgtLang === entry.tgtLang);
    });
    items.unshift({
      src: entry.src, tgt: entry.tgt, rom: entry.rom || '',
      srcLang: entry.srcLang, tgtLang: entry.tgtLang, at: Date.now()
    });
    write(HISTORY_KEY, items.slice(0, 60));
    renderHistory();
  }

  /* --- phrasebook (on purpose) --- */

  function isSaved(entry) {
    return read(PHRASE_KEY).some(function (i) { return sameEntry(i, entry); });
  }

  function addPhrase(entry) {
    if (!entry.src || !entry.tgt) { toast('There is nothing to save yet'); return; }
    var items = read(PHRASE_KEY);
    if (items.some(function (i) { return sameEntry(i, entry); })) {
      toast('Already in your phrasebook');
      return;
    }
    items.unshift({
      src: entry.src, tgt: entry.tgt, rom: entry.rom || '',
      srcLang: entry.srcLang, tgtLang: entry.tgtLang, at: Date.now()
    });
    write(PHRASE_KEY, items.slice(0, 200));
    renderPhrases();
    updateSaveButton();
    toast('Saved to your phrasebook');
  }

  function removePhrase(entry) {
    write(PHRASE_KEY, read(PHRASE_KEY).filter(function (i) { return !sameEntry(i, entry); }));
    renderPhrases();
    updateSaveButton();
    toast('Removed from your phrasebook');
  }

  function removeHistory(entry) {
    write(HISTORY_KEY, read(HISTORY_KEY).filter(function (i) { return !sameEntry(i, entry); }));
    renderHistory();
    toast('Removed from your journal');
  }

  function updateSaveButton() {
    var label = saveTarget.querySelector('span');
    var can = !!(current.src && current.tgt);
    saveTarget.disabled = !can;
    if (can && isSaved(current)) {
      label.textContent = 'In phrasebook';
      saveTarget.dataset.saved = 'yes';
    } else {
      label.textContent = 'Save phrase';
      delete saveTarget.dataset.saved;
    }
  }

  saveTarget.addEventListener('click', function () {
    if (saveTarget.dataset.saved) removePhrase(current);
    else addPhrase(current);
  });

  /* --- rendering --- */

  function dayLabel(timestamp) {
    if (!timestamp) return 'Earlier';
    var then = new Date(timestamp);
    var today = new Date();
    var oneDay = 86400000;
    var startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();

    if (timestamp >= startOfToday) return 'Today';
    if (timestamp >= startOfToday - oneDay) return 'Yesterday';
    return then.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'long' });
  }

  function makeEntryRow(entry, kind) {
    var li = el('li', 'entry');

    var main = el('button', 'entry-main');
    main.type = 'button';

    var meta = el('span', 'entry-meta');
    meta.appendChild(el('span', null,
      Translator.languageName(entry.srcLang) + ' → ' + Translator.languageName(entry.tgtLang)));
    main.appendChild(meta);
    main.appendChild(el('span', 'entry-src', entry.src));
    main.appendChild(el('span', 'entry-tgt', entry.tgt));
    if (entry.rom) main.appendChild(el('span', 'entry-rom', entry.rom));

    main.addEventListener('click', function () { loadEntry(entry); });
    li.appendChild(main);

    var more = el('button', 'iconbtn entry-more');
    more.type = 'button';
    more.setAttribute('aria-label', 'More actions for “' + entry.src + '”');
    more.appendChild(icon('i-dots'));
    more.addEventListener('click', function () { openItemSheet(entry, kind); });
    li.appendChild(more);

    return li;
  }

  function loadEntry(entry) {
    showView('view-text');
    sourceText.value = entry.src;
    targetText.textContent = entry.tgt;
    targetText.setAttribute('lang', Translator.normalize(entry.tgtLang));
    showRomanization(entry.rom, '', romanizeBox, romanizeText, romanizeSide);
    providerBadge.hidden = true;

    if (entry.tgtLang) state.target = entry.tgtLang;
    if (entry.srcLang) state.source = entry.srcLang;
    renderRoute();
    savePrefs();

    current = {
      src: entry.src, tgt: entry.tgt, rom: entry.rom || '',
      srcLang: entry.srcLang, tgtLang: entry.tgtLang
    };
    updateSaveButton();
    buildWordBreakdown(entry.src, entry.tgt);
    updateCount();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderHistory() {
    var items = read(HISTORY_KEY);
    historyList.innerHTML = '';

    if (!items.length) {
      historyList.appendChild(el('li', 'empty',
        'Everything you translate is jotted down here, on this device only.'));
      return;
    }

    var lastDay = null;
    items.forEach(function (entry) {
      var day = dayLabel(entry.at);
      if (day !== lastDay) {
        historyList.appendChild(el('li', 'daymark', day));
        lastDay = day;
      }
      historyList.appendChild(makeEntryRow(entry, 'history'));
    });
  }

  function renderPhrases() {
    var items = read(PHRASE_KEY);
    phraseList.innerHTML = '';

    if (!items.length) {
      var empty = el('li', 'empty');
      empty.appendChild(document.createTextNode('Tap '));
      empty.appendChild(el('strong', null, 'Save phrase'));
      empty.appendChild(document.createTextNode(' on a translation to keep it here.'));
      phraseList.appendChild(empty);
      return;
    }

    items.forEach(function (entry) {
      phraseList.appendChild(makeEntryRow(entry, 'phrase'));
    });
  }

  /* --- the item actions sheet --- */

  function openItemSheet(entry, kind) {
    $('sheet-item-title').textContent = kind === 'phrase' ? 'Saved phrase' : 'Journal entry';

    var quote = $('itemQuote');
    quote.innerHTML = '';
    quote.appendChild(el('p', 'q-src', entry.src));
    quote.appendChild(el('p', 'q-tgt', entry.tgt));
    if (entry.rom) quote.appendChild(el('p', 'q-rom', entry.rom));

    var actions = $('itemActions');
    actions.innerHTML = '';

    function action(label, iconName, danger, run) {
      var button = el('button', 'actionrow' + (danger ? ' danger' : ''));
      button.type = 'button';
      button.appendChild(icon(iconName));
      button.appendChild(el('span', null, label));
      button.addEventListener('click', function () { Sheets.close(); run(); });
      var li = document.createElement('li');
      li.appendChild(button);
      actions.appendChild(li);
    }

    action('Open in the text box', 'i-pen', false, function () { loadEntry(entry); });
    action('Listen to the translation', 'i-speak', false, function () { speakOrWarn(entry.tgt, entry.tgtLang); });
    action('Copy the translation', 'i-copy', false, function () { copyText(entry.tgt); });

    if (kind === 'history') {
      action('Save to phrasebook', 'i-bookmark', false, function () { addPhrase(entry); });
      action('Remove from journal', 'i-trash', true, function () { removeHistory(entry); });
    } else {
      action('Remove from phrasebook', 'i-trash', true, function () { removePhrase(entry); });
    }

    Sheets.open('sheet-item');
  }

  wireSegments('savedview', function (value) {
    $('phrasePane').hidden = value !== 'phrases';
    $('historyPane').hidden = value !== 'history';
  });

  $('clearHistory').addEventListener('click', function () {
    if (!read(HISTORY_KEY).length) { toast('Your journal is already empty'); return; }
    try { localStorage.removeItem(HISTORY_KEY); } catch (e) { /* ignore */ }
    renderHistory();
    toast('Journal cleared');
  });

  $('clearPhrases').addEventListener('click', function () {
    if (!read(PHRASE_KEY).length) { toast('Your phrasebook is already empty'); return; }
    try { localStorage.removeItem(PHRASE_KEY); } catch (e) { /* ignore */ }
    renderPhrases();
    updateSaveButton();
    toast('Phrasebook cleared');
  });

  /* ============================================================
     translation engine settings (Groq)
     ============================================================ */

  var settingsBtn  = $('settingsBtn');
  var groqDot      = $('groqDot');
  var groqKey      = $('groqKey');
  var groqModel    = $('groqModel');
  var groqEnabled  = $('groqEnabled');
  var groqRomanize = $('groqRomanize');
  var groqStatus   = $('groqStatus');
  var groqSave     = $('groqSave');

  function engineStatus(message, kind) {
    if (!message) { groqStatus.hidden = true; return; }
    groqStatus.hidden = false;
    groqStatus.className = 'formstatus' + (kind ? ' is-' + kind : '');
    groqStatus.textContent = message;
  }

  function fillModels(models, chosen) {
    groqModel.innerHTML = '';
    models.forEach(function (id) {
      var option = el('option', null, id);
      option.value = id;
      groqModel.appendChild(option);
    });
    if (chosen && models.indexOf(chosen) === -1) {
      var extra = el('option', null, chosen + ' (not on your account)');
      extra.value = chosen;
      groqModel.appendChild(extra);
    }
    groqModel.value = chosen || models[0] || '';
  }

  /* The badge on the app-bar button tells you at a glance which engine
     is doing the work, without opening the sheet. */
  function renderEngineBadge() {
    var on = Groq.isConfigured();
    groqDot.hidden = !on;
    settingsBtn.classList.toggle('is-on', on);
    settingsBtn.setAttribute('aria-label', on
      ? 'Translation engine: Groq is on'
      : 'Translation engine settings');
  }

  function openSettings() {
    var saved = Groq.get();

    groqKey.value = saved.key;
    groqKey.type = 'password';
    groqEnabled.checked = saved.enabled;
    groqRomanize.checked = saved.romanize;
    fillModels(Groq.knownModels, saved.model);

    engineStatus(saved.key
      ? 'Groq is set up. Translations use ' + saved.model + '.'
      : 'Not set up yet — the free translators are being used.', saved.key ? '' : 'busy');

    $('groqModelHint').textContent = saved.key
      ? 'Tap "Test & save" to refresh the list from your account.'
      : 'Save your key to load the models your account can use.';

    // resync on the way in and on the way out, so the app-bar dot always
    // matches what is actually stored
    renderEngineBadge();
    Sheets.open('sheet-settings', { onClose: renderEngineBadge });

    if (saved.key) refreshModels(saved.key, saved.model, true);
  }

  /* Ask Groq which models this key may use, so the list is never stale. */
  function refreshModels(key, chosen, quiet) {
    return Groq.verify(key, chosen)
      .then(function (result) {
        fillModels(result.models, chosen);
        $('groqModelHint').textContent = result.models.length + ' models available to your key.';
        if (result.modelMissing) {
          engineStatus('The model "' + chosen + '" is no longer offered — pick another one below.', 'bad');
        }
        return result;
      })
      .catch(function (err) {
        if (!quiet) throw err;
        $('groqModelHint').textContent = 'Could not load the model list: ' + err.message;
        return null;
      });
  }

  settingsBtn.addEventListener('click', openSettings);

  $('groqKeyPeek').addEventListener('click', function () {
    var hidden = groqKey.type === 'password';
    groqKey.type = hidden ? 'text' : 'password';
    this.setAttribute('aria-label', hidden ? 'Hide the key' : 'Show the key');
    groqKey.focus();
  });

  groqSave.addEventListener('click', function () {
    var key = groqKey.value.trim();

    if (!key) {
      engineStatus('Paste a key first, or tap Remove to go back to the free translators.', 'bad');
      groqKey.focus();
      return;
    }

    groqSave.disabled = true;
    engineStatus('Checking the key with Groq…', 'busy');

    refreshModels(key, groqModel.value || Groq.defaultModel, false)
      .then(function (result) {
        var model = groqModel.value || result.models[0] || Groq.defaultModel;
        Groq.save({
          key: key,
          model: model,
          enabled: groqEnabled.checked,
          romanize: groqRomanize.checked
        });
        renderEngineBadge();
        engineStatus('Key saved. ' + (groqEnabled.checked
          ? 'Translations now go through ' + model + '.'
          : 'Groq is saved but switched off below.'), '');
        toast(groqEnabled.checked ? 'Groq is on' : 'Groq saved but switched off');
      })
      .catch(function (err) {
        engineStatus(err.message, 'bad');
      })
      .finally(function () { groqSave.disabled = false; });
  });

  $('groqForget').addEventListener('click', function () {
    if (!Groq.hasKey() && !groqKey.value) {
      engineStatus('There is no key saved here.', 'busy');
      return;
    }
    Groq.forget();
    groqKey.value = '';
    groqEnabled.checked = true;
    groqRomanize.checked = true;
    fillModels(Groq.knownModels, Groq.defaultModel);
    renderEngineBadge();
    engineStatus('Key removed. Back to the free translators.', '');
    toast('Groq key removed');
  });

  /* the two switches take effect immediately, no saving needed */
  groqEnabled.addEventListener('change', function () {
    Groq.save({ enabled: groqEnabled.checked });
    renderEngineBadge();
    if (Groq.hasKey()) {
      engineStatus(groqEnabled.checked
        ? 'Groq is on.'
        : 'Groq is off — using the free translators.', groqEnabled.checked ? '' : 'busy');
    }
  });

  groqRomanize.addEventListener('change', function () {
    Groq.save({ romanize: groqRomanize.checked });
    if (Groq.hasKey()) {
      engineStatus(groqRomanize.checked
        ? 'Groq will write the romanization.'
        : 'Romanization comes from the built-in rules again.', '');
    }
  });

  /* If Groq fails mid-translation we quietly fall back, but the user
     should still be told why the wording suddenly changed. */
  var lastEngineWarning = 0;
  window.onTranslationProviderFailure = function (name, err) {
    if (name !== 'Groq') return;
    var now = Date.now();
    if (now - lastEngineWarning < 20000) return;     // don't nag on every keystroke
    lastEngineWarning = now;
    toast(err.message + ' Using the free translator instead.', true);
  };

  /* ============================================================
     start-up
     ============================================================ */

  loadPrefs();
  renderRoute();
  updateCount();
  updateSaveButton();
  renderHistory();
  renderPhrases();
  renderEngineBadge();
})();
