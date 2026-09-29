/* ============================================================
   ocr.js — reads text out of a picture with Tesseract.js

   The language data files are downloaded from a CDN the first time a
   language is used (Thai is the biggest, a few megabytes) and then the
   worker is kept alive so later pictures are fast.
   ============================================================ */

(function (global) {
  'use strict';

  // app language code -> Tesseract traineddata name
  var TESS_LANG = {
    'en': 'eng',
    'th': 'tha',
    'zh-CN': 'chi_sim',
    'zh-TW': 'chi_tra',
    'auto': 'eng+tha'
  };

  var worker = null;
  var workerLangs = null;
  var busy = false;

  function isAvailable() { return typeof global.Tesseract !== 'undefined'; }

  function langsFor(code) { return TESS_LANG[code] || 'eng'; }

  function getWorker(langs, onProgress) {
    if (worker && workerLangs === langs) return Promise.resolve(worker);

    var teardown = worker ? worker.terminate().catch(function () {}) : Promise.resolve();

    return teardown.then(function () {
      worker = null;
      workerLangs = null;
      return global.Tesseract.createWorker(langs, 1, {
        logger: function (m) {
          if (!onProgress) return;
          if (m.status === 'loading tesseract core') onProgress(0.05, 'Loading OCR engine…');
          else if (m.status === 'loading language traineddata') onProgress(0.1 + m.progress * 0.35, 'Downloading language data…');
          else if (m.status === 'initializing api' || m.status === 'initializing tesseract') onProgress(0.5, 'Getting ready…');
          else if (m.status === 'recognizing text') onProgress(0.55 + m.progress * 0.45, 'Reading the picture… ' + Math.round(m.progress * 100) + '%');
        }
      });
    }).then(function (w) {
      worker = w;
      workerLangs = langs;
      return w;
    });
  }

  /* Tesseract sprinkles spaces through Thai and Chinese text and breaks
     lines wherever the image wraps. Tidy that up before translating. */
  function tidy(text, code) {
    var out = (text || '').replace(/\r/g, '').replace(/[ \t]+\n/g, '\n');

    out = out.split('\n').map(function (line) {
      var l = line.trim();
      var prev;
      do {
        prev = l;
        l = l.replace(/([\u0E00-\u0E7F])[ \t]+([\u0E00-\u0E7F])/g, '$1$2')
             .replace(/([\u4E00-\u9FFF])[ \t]+([\u4E00-\u9FFF])/g, '$1$2');
      } while (l !== prev);
      return l;
    }).filter(Boolean).join('\n');

    return out.replace(/\n{3,}/g, '\n\n').trim();
  }

  /**
   * recognize(imageSource, langCode, onProgress) -> Promise<{ text, confidence, lines }>
   * imageSource can be a File, a data URL, a canvas or an <img>.
   * `lines` is the same text split per line, which menus and receipts
   * need so each item can be translated on its own.
   */
  function recognize(imageSource, langCode, onProgress) {
    if (!isAvailable()) {
      return Promise.reject(new Error('The OCR library did not load. Check your internet connection and refresh.'));
    }
    if (busy) {
      return Promise.reject(new Error('Still reading the previous picture — one moment.'));
    }

    busy = true;
    var langs = langsFor(langCode);

    return getWorker(langs, onProgress)
      .then(function (w) {
        onProgress && onProgress(0.55, 'Reading the picture…');
        return w.recognize(imageSource);
      })
      .then(function (result) {
        busy = false;
        onProgress && onProgress(1, 'Done');
        var text = tidy(result.data.text, langCode);
        return {
          text: text,
          confidence: result.data.confidence,
          lines: text ? text.split('\n').filter(Boolean) : []
        };
      })
      .catch(function (err) {
        busy = false;
        throw err;
      });
  }

  global.OCR = {
    isAvailable: isAvailable,
    recognize: recognize,
    languageLabel: function (code) { return langsFor(code); }
  };
})(window);
