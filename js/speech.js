/* ============================================================
   speech.js — microphone input and spoken output

   Uses the browser's built-in Web Speech API:
     • SpeechRecognition  — turns speech into text (Chromium browsers)
     • speechSynthesis    — reads text out loud (everywhere)

   Recognition only works on https:// or http://localhost, and the
   available voices depend on what the operating system has installed.
   ============================================================ */

(function (global) {
  'use strict';

  var SR = global.SpeechRecognition || global.webkitSpeechRecognition;
  var recognition = null;
  var listening = false;

  /* ---------- what can this device actually do? ---------- */

  var ua = navigator.userAgent;
  var isIOS = /iPad|iPhone|iPod/.test(ua) ||
              (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  // Chrome, Firefox and Edge on iOS are WebKit wrappers and do not expose
  // speech recognition, so the voice tab needs Safari itself
  var iosNonSafari = isIOS && /CriOS|FxiOS|EdgiOS|OPiOS|GSA|DuckDuckGo/.test(ua);

  function capabilities() {
    return {
      recognition: !!SR,
      synthesis: !!global.speechSynthesis,
      secureContext: !!global.isSecureContext,
      isIOS: isIOS,
      iosNonSafari: iosNonSafari
    };
  }

  /* ---------- speech to text ---------- */

  function isRecognitionSupported() { return !!SR; }

  /**
   * start({ lang, continuous, onInterim, onFinal, onStart, onEnd, onError })
   */
  function start(opts) {
    if (!SR) {
      opts.onError && opts.onError(new Error('This browser does not support speech recognition.'));
      return;
    }
    stop();

    recognition = new SR();
    recognition.lang = opts.lang || 'en-US';
    recognition.continuous = !!opts.continuous;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = function () {
      listening = true;
      opts.onStart && opts.onStart();
    };

    recognition.onresult = function (event) {
      var interim = '';
      for (var i = event.resultIndex; i < event.results.length; i++) {
        var result = event.results[i];
        var transcript = result[0].transcript;
        if (result.isFinal) {
          var clean = transcript.trim();
          if (clean) opts.onFinal && opts.onFinal(clean, result[0].confidence);
        } else {
          interim += transcript;
        }
      }
      if (interim) opts.onInterim && opts.onInterim(interim.trim());
    };

    recognition.onerror = function (event) {
      var messages = {
        'no-speech': 'I did not hear anything — try speaking a bit closer to the mic.',
        'audio-capture': 'No microphone was found.',
        'not-allowed': 'Microphone access was blocked. Allow it in the address bar and try again.',
        'service-not-allowed': 'Speech recognition is not available in this context (needs https or localhost).',
        'network': 'The speech service could not be reached.'
      };
      opts.onError && opts.onError(new Error(messages[event.error] || ('Speech error: ' + event.error)));
    };

    recognition.onend = function () {
      listening = false;
      opts.onEnd && opts.onEnd();
    };

    try {
      recognition.start();
    } catch (err) {
      opts.onError && opts.onError(err);
    }
  }

  function stop() {
    if (recognition) {
      try { recognition.onend = null; recognition.stop(); } catch (e) { /* already stopped */ }
      recognition = null;
    }
    listening = false;
  }

  function isListening() { return listening; }

  /* ---------- text to speech ---------- */

  var voices = [];

  function loadVoices() {
    if (!global.speechSynthesis) return;
    voices = global.speechSynthesis.getVoices() || [];
  }

  loadVoices();
  if (global.speechSynthesis && typeof global.speechSynthesis.addEventListener === 'function') {
    global.speechSynthesis.addEventListener('voiceschanged', loadVoices);
  }

  function pickVoice(locale) {
    if (!voices.length) loadVoices();
    var lower = locale.toLowerCase();
    var base = lower.split('-')[0];

    return voices.find(function (v) { return v.lang.toLowerCase() === lower; })
      || voices.find(function (v) { return v.lang.toLowerCase().replace('_', '-') === lower; })
      || voices.find(function (v) { return v.lang.toLowerCase().indexOf(base) === 0; })
      || null;
  }

  /* iOS will only start speaking if the very first utterance comes from a
     real tap, so we spend a silent one on the user's first touch. After
     that, reading a translation out on its own works. */
  var unlocked = false;

  function unlockAudio() {
    if (unlocked || !global.speechSynthesis) return;
    unlocked = true;
    try {
      var silent = new SpeechSynthesisUtterance(' ');
      silent.volume = 0;
      global.speechSynthesis.speak(silent);
      loadVoices();
    } catch (e) { /* nothing to do */ }
  }

  ['touchend', 'mousedown', 'keydown'].forEach(function (evt) {
    document.addEventListener(evt, unlockAudio, { once: true, capture: true });
  });

  /**
   * speak(text, langCode) — langCode is an app code such as 'th' or 'zh-CN'.
   * Returns false when no matching voice is installed on this machine.
   */
  function speak(text, langCode) {
    if (!global.speechSynthesis || !text) return false;

    var locale = Translator.speechLocale(langCode);
    var voice = pickVoice(locale);

    function say() {
      var utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = locale;
      utterance.rate = 0.95;
      utterance.pitch = 1;
      if (voice) utterance.voice = voice;
      global.speechSynthesis.speak(utterance);
    }

    // cancelling and speaking in the same tick drops the new utterance on
    // iOS, so give the queue a moment when something is already playing
    if (global.speechSynthesis.speaking || global.speechSynthesis.pending) {
      global.speechSynthesis.cancel();
      setTimeout(say, isIOS ? 140 : 0);
    } else {
      say();
    }

    return !!voice;
  }

  function stopSpeaking() {
    if (global.speechSynthesis) global.speechSynthesis.cancel();
  }

  global.Speech = {
    capabilities: capabilities,
    isRecognitionSupported: isRecognitionSupported,
    start: start,
    stop: stop,
    isListening: isListening,
    speak: speak,
    stopSpeaking: stopSpeaking,
    hasVoiceFor: function (langCode) { return !!pickVoice(Translator.speechLocale(langCode)); }
  };
})(window);
