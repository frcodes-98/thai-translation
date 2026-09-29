/* ============================================================
   translate.js — turns text into another language

   Providers are tried in order, so the app keeps working when one of
   them is rate-limited or blocked:

     0. Groq (an LLM)                   only when a key has been saved;
                                        idiomatic, and it writes the Thai
                                        romanization itself
     1. Google's public "gtx" endpoint  (handles auto-detect)
     2. MyMemory                        (open API, needs an explicit pair)

   Providers 1 and 2 need no key and no server, so the app still works
   out of the box with nothing configured.
   ============================================================ */

(function (global) {
  'use strict';

  var REQUEST_TIMEOUT = 15000;
  var CHUNK_SIZE = 1400;          // keep GET URLs comfortably short

  /* ---------- helpers ---------- */

  function fetchWithTimeout(url) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT);
    return fetch(url, { signal: controller.signal })
      .finally(function () { clearTimeout(timer); });
  }

  /* Split long text on sentence boundaries so each request stays small. */
  function chunk(text) {
    if (text.length <= CHUNK_SIZE) return [text];

    var pieces = [];
    var rest = text;
    while (rest.length > CHUNK_SIZE) {
      var slice = rest.slice(0, CHUNK_SIZE);
      var cut = Math.max(
        slice.lastIndexOf('\n'), slice.lastIndexOf('. '),
        slice.lastIndexOf('。'), slice.lastIndexOf('! '),
        slice.lastIndexOf('? '), slice.lastIndexOf(' ')
      );
      if (cut < CHUNK_SIZE * 0.4) cut = CHUNK_SIZE;
      pieces.push(rest.slice(0, cut + 1));
      rest = rest.slice(cut + 1);
    }
    if (rest) pieces.push(rest);
    return pieces;
  }

  /* Rough guess used when the user picked "Detect language" but the
     provider we fall back to needs an explicit source language. */
  function guessLanguage(text) {
    if (/[\u0E00-\u0E7F]/.test(text)) return 'th';
    if (/[\u4E00-\u9FFF\u3400-\u4DBF]/.test(text)) return 'zh-CN';
    if (/[\u3040-\u30FF]/.test(text)) return 'ja';
    if (/[\uAC00-\uD7AF]/.test(text)) return 'ko';
    return 'en';
  }

  var LANG_NAMES = {
    'auto': 'Detected', 'en': 'English', 'th': 'Thai',
    'zh-CN': 'Chinese (Simplified)', 'zh-TW': 'Chinese (Traditional)',
    'zh': 'Chinese', 'ja': 'Japanese', 'ko': 'Korean'
  };

  var SPEECH_LOCALES = {
    'en': 'en-US', 'th': 'th-TH', 'zh-CN': 'zh-CN', 'zh-TW': 'zh-TW',
    'zh': 'zh-CN', 'ja': 'ja-JP', 'ko': 'ko-KR'
  };

  /* ---------- provider 0: Groq (only when a key is saved) ---------- */

  /* Which piece of Thai does the app need spelled out in Latin letters?
     The reader always wants the Thai side, whichever side that is. */
  function thaiSideOf(text, source, target) {
    if (normalize(target) === 'th') return 'translation';
    var from = source === 'auto' ? guessLanguage(text) : normalize(source);
    if (from === 'th' || /[\u0E00-\u0E7F]/.test(text)) return 'source';
    return null;
  }

  function groqTranslate(text, source, target) {
    var fromName = source === 'auto'
      ? 'whatever language it is written in'
      : (LANG_NAMES[normalize(source)] || source);
    var toName = LANG_NAMES[normalize(target)] || target;

    var side = Groq.romanizes() ? thaiSideOf(text, source, target) : null;

    var romanRule = side === 'translation'
      ? '"romanization": the Royal Thai General System reading of the Thai translation you just wrote.'
      : side === 'source'
        ? '"romanization": the Royal Thai General System reading of the Thai in the user message.'
        : '"romanization": an empty string, because no Thai is involved.';

    var rules = [
      'You are a careful translator working between Thai, English and Chinese.',
      'Translate the user message from ' + fromName + ' into ' + toName + '.',
      'Write it the way a native speaker would say it, not word by word.',
      'Never answer, explain, continue or comment on the text. Only translate it.',
      'Keep the original line breaks, numbers, names and punctuation.',
      'Reply with one JSON object and nothing else, in this exact shape:',
      '{"translation": "...", "romanization": "...", "detected": "..."}',
      romanRule
    ];

    if (side) {
      rules.push(
        'Royal Thai General System romanization uses plain lowercase Latin letters with ' +
        'a space between words, no tone marks and no accented characters. ' +
        'For example สวัสดีครับ becomes "sawatdi khrap" and ขอบคุณมาก becomes "khopkhun mak".'
      );
    }

    rules.push('"detected": the language of the user message, as one of en, th, zh-CN, zh-TW.');

    return Groq.chat([
      { role: 'system', content: rules.join('\n') },
      { role: 'user', content: text }
    ], {
      json: true,
      temperature: 0.2,
      maxTokens: Math.min(4096, 400 + text.length * 3)
    }).then(function (content) {
      var data = Groq.parseJson(content);
      if (!data || typeof data.translation !== 'string' || !data.translation.trim()) {
        throw new Error('Groq did not return a usable translation.');
      }

      var roman = typeof data.romanization === 'string' ? data.romanization.trim() : '';
      // a "romanization" still full of Thai script is no use to anyone
      if (/[\u0E00-\u0E7F]/.test(roman)) roman = '';

      return {
        text: data.translation.trim(),
        detected: normalize(data.detected) || (source === 'auto' ? guessLanguage(text) : source),
        sourceTranslit: '',
        providerRomanization: roman,
        provider: 'Groq'
      };
    });
  }

  /* ---------- provider 1: Google gtx ---------- */

  function googleTranslate(text, source, target) {
    var url = 'https://translate.googleapis.com/translate_a/single'
      + '?client=gtx&dt=t&dt=rm'
      + '&sl=' + encodeURIComponent(source)
      + '&tl=' + encodeURIComponent(target)
      + '&q=' + encodeURIComponent(text);

    return fetchWithTimeout(url).then(function (res) {
      if (!res.ok) throw new Error('Google endpoint returned ' + res.status);
      return res.json();
    }).then(function (data) {
      if (!data || !Array.isArray(data[0])) throw new Error('Unexpected response shape');

      var translated = '';
      var srcTranslit = '';
      data[0].forEach(function (seg) {
        if (seg[0]) translated += seg[0];
        if (seg[3]) srcTranslit += seg[3];
      });
      if (!translated) throw new Error('Empty translation');

      return {
        text: translated,
        detected: data[2] || source,
        sourceTranslit: srcTranslit,
        provider: 'Google'
      };
    });
  }

  /* ---------- provider 2: MyMemory ---------- */

  function myMemoryTranslate(text, source, target) {
    var sl = source === 'auto' ? guessLanguage(text) : source;
    var url = 'https://api.mymemory.translated.net/get'
      + '?q=' + encodeURIComponent(text)
      + '&langpair=' + encodeURIComponent(sl) + '|' + encodeURIComponent(target);

    return fetchWithTimeout(url).then(function (res) {
      if (!res.ok) throw new Error('MyMemory returned ' + res.status);
      return res.json();
    }).then(function (data) {
      var out = data && data.responseData && data.responseData.translatedText;
      if (!out) throw new Error('MyMemory gave no translation');
      if (/MYMEMORY WARNING|QUERY LENGTH LIMIT/i.test(out)) throw new Error(out);
      return {
        text: out,
        detected: sl,
        sourceTranslit: '',
        provider: 'MyMemory'
      };
    });
  }

  /* Built fresh for every translation, because the user can turn Groq
     on or off from the settings sheet at any time. */
  function providerChain() {
    var chain = [];
    if (global.Groq && Groq.isConfigured()) chain.push(groqTranslate);
    chain.push(googleTranslate, myMemoryTranslate);
    return chain;
  }

  /* ---------- public API ---------- */

  /**
   * translate({ text, source, target }) -> Promise<{
   *   text, detected, provider, romanization, romanizedSide
   * }>
   */
  function translate(opts) {
    var text = (opts.text || '').trim();
    var source = opts.source || 'auto';
    var target = opts.target || 'en';

    if (!text) return Promise.resolve({ text: '', detected: source, provider: '' });

    if (source !== 'auto' && source === target) {
      return Promise.resolve(decorate({
        text: text, detected: source, provider: 'unchanged'
      }, text, source, target));
    }

    var pieces = chunk(text);

    return runProviders(pieces, source, target, providerChain(), 0).then(function (result) {
      return decorate(result, text, source, target);
    });
  }

  function runProviders(pieces, source, target, providers, index) {
    if (index >= providers.length) {
      return Promise.reject(new Error(
        'No translation service could be reached. Check your internet connection and try again.'
      ));
    }

    var provider = providers[index];

    // translate the chunks one after another so we keep their order
    var merged = {
      text: '', detected: source, sourceTranslit: '',
      providerRomanization: '', provider: ''
    };
    var chain = Promise.resolve();

    pieces.forEach(function (piece) {
      chain = chain.then(function () {
        return provider(piece, source, target).then(function (r) {
          merged.text += r.text;
          merged.sourceTranslit += r.sourceTranslit || '';
          if (r.providerRomanization) {
            merged.providerRomanization += (merged.providerRomanization ? ' ' : '') + r.providerRomanization;
          }
          merged.detected = r.detected;
          merged.provider = r.provider;
        });
      });
    });

    return chain.then(function () { return merged; })
      .catch(function (err) {
        console.warn('Translation provider failed:', err.message);
        if (typeof global.onTranslationProviderFailure === 'function') {
          global.onTranslationProviderFailure(provider === groqTranslate ? 'Groq' : '', err);
        }
        return runProviders(pieces, source, target, providers, index + 1);
      });
  }

  /* Attach the Thai romanization to whichever side is Thai. When the LLM
     supplied one we trust it over the rule-based romanizer, since it knows
     the words the built-in list has never heard of. */
  function decorate(result, originalText, source, target) {
    var detected = normalize(result.detected || source);
    var tgt = normalize(target);
    var supplied = (result.providerRomanization || '').trim();
    var thaiText = null;
    var side = '';

    if (tgt === 'th' && ThaiRomanizer.containsThai(result.text)) {
      thaiText = result.text;
      side = 'of the translation';
    } else if (ThaiRomanizer.containsThai(originalText)) {
      thaiText = originalText;
      side = 'of your text';
    }

    result.detected = detected;
    result.romanization = thaiText ? (supplied || ThaiRomanizer.romanize(thaiText)) : '';
    result.romanizedSide = side;
    result.romanizationSource = thaiText && supplied ? 'groq' : 'built-in';
    return result;
  }

  function normalize(code) {
    if (!code) return 'auto';
    if (code === 'zh' || code === 'zh-Hans') return 'zh-CN';
    if (code === 'zh-Hant') return 'zh-TW';
    return code;
  }

  global.Translator = {
    translate: translate,
    guessLanguage: guessLanguage,
    normalize: normalize,
    usingGroq: function () { return !!(global.Groq && Groq.isConfigured()); },
    languageName: function (code) { return LANG_NAMES[normalize(code)] || code; },
    speechLocale: function (code) { return SPEECH_LOCALES[normalize(code)] || 'en-US'; }
  };
})(window);
