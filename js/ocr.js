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
     lines wherever the image wraps. Photos of laptop screens also pick up
     the taskbar and FPS overlays — "% 1333m: 1" — which must not be
     translated. */
  function squeezeScript(line) {
    var l = (line || '').replace(/\s+/g, ' ').trim();
    var prev;
    do {
      prev = l;
      l = l.replace(/([\u0E00-\u0E7F])[ \t]+([\u0E00-\u0E7F])/g, '$1$2')
           .replace(/([\u4E00-\u9FFF])[ \t]+([\u4E00-\u9FFF])/g, '$1$2');
    } while (l !== prev);
    return l;
  }

  function stripHudTail(line) {
    return line
      .replace(/\s*%+\s*[\d.\s:a-zA-Z|/\\-]+$/g, '')
      .replace(/\s+\d{2,5}\s*[mMkKgG]\s*:?\s*\d*\s*$/g, '')
      .replace(/\s+\d{3,5}\s*[xX×]\s*\d{3,5}\s*$/g, '')
      .trim();
  }

  function isHudJunk(line) {
    var t = stripHudTail(line);
    if (!t) return true;

    if (/^[%$€#]\s*\d/.test(t)) return true;
    if (/^\d{2,5}\s*[mMkKgG]\s*:?\s*\d*$/.test(t)) return true;
    if (/^\d{1,2}:\d{2}(\s*[AaPp][Mm])?$/.test(t)) return true;
    if (/^(search|type here|cortana|microsoft|windows)$/i.test(t)) return true;
    if (/^\d{3,5}\s*[xX×]\s*\d{3,5}$/.test(t)) return true;

    var letters = (t.match(/[\u0E00-\u0E7Fa-zA-Z\u4E00-\u9FFF]/g) || []).length;
    var digits  = (t.match(/\d/g) || []).length;
    var symbols = (t.match(/[%:$|\\/#@*+=~]/g) || []).length;
    if (digits + symbols >= 3 && letters <= 2) return true;
    if (t.length <= 4 && !/[\u0E00-\u0E7F\u4E00-\u9FFF]/.test(t) && /\d/.test(t)) return true;
    return false;
  }

  function tidyText(text) {
    var out = (text || '').replace(/\r/g, '').replace(/[ \t]+\n/g, '\n');
    return out.split('\n').map(function (line) {
      return squeezeScript(stripHudTail(line));
    }).filter(function (line) {
      return line && !isHudJunk(line);
    }).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function collectLines(data, imageHeight) {
    var raw = (data && data.lines) || [];
    var kept = [];
    var hasScript = false;

    raw.forEach(function (row) {
      var text = squeezeScript(stripHudTail(row && row.text));
      if (!text || isHudJunk(text)) return;

      var conf = typeof row.confidence === 'number' ? row.confidence : 100;
      var y0 = row.bbox && typeof row.bbox.y0 === 'number' ? row.bbox.y0 : 0;
      var nearBottom = imageHeight && y0 > imageHeight * 0.88;
      var script = /[\u0E00-\u0E7F\u4E00-\u9FFF]/.test(text);

      if (script) hasScript = true;
      if (conf < 35) return;
      if (nearBottom && !script && conf < 70) return;
      if (!script && conf < 48) return;

      kept.push({ text: text, confidence: conf, script: script });
    });

    if (hasScript) {
      kept = kept.filter(function (row) { return row.script || row.confidence >= 72; });
    }

    var texts = kept.map(function (row) { return row.text; }).filter(Boolean);
    if (!texts.length) return tidyText(data && data.text);
    return texts.join('\n');
  }

  function measureImage(src) {
    return new Promise(function (resolve) {
      if (!src || (typeof src === 'object' && !(src instanceof Blob) && !src.src)) {
        resolve({ w: 0, h: 0 });
        return;
      }
      var img = new Image();
      img.onload = function () { resolve({ w: img.naturalWidth, h: img.naturalHeight }); };
      img.onerror = function () { resolve({ w: 0, h: 0 }); };
      try {
        if (typeof src === 'string') img.src = src;
        else if (src instanceof Blob) img.src = URL.createObjectURL(src);
        else if (src.src) img.src = src.src;
        else resolve({ w: 0, h: 0 });
      } catch (e) {
        resolve({ w: 0, h: 0 });
      }
    });
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
        return measureImage(imageSource).then(function (size) {
          var text = collectLines(result.data, size.h) || tidyText(result.data.text);
          return {
            text: text,
            confidence: result.data.confidence,
            lines: text ? text.split('\n').filter(Boolean) : []
          };
        });
      })
      .catch(function (err) {
        busy = false;
        throw err;
      });
  }

  global.OCR = {
    isAvailable: isAvailable,
    recognize: recognize,
    tidy: tidyText,
    languageLabel: function (code) { return langsFor(code); }
  };
})(window);
