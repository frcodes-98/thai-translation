/* ============================================================
   groq.js — optional Groq (LLM) backend

   The built-in romanizer works from rules plus a word list, so rare or
   literary Thai can slip through it, and the free translation endpoints
   are word-for-word rather than idiomatic. When a Groq API key is saved
   here, an LLM does both jobs instead: a natural translation *and* the
   Royal Thai General System romanization for the Thai side.

   The key lives in this browser's localStorage and is sent straight to
   api.groq.com from the page — there is no server in between. That is
   fine for personal use on your own machine; do not publish the site
   with a key saved, and do not save a key on a shared computer.
   ============================================================ */

(function (global) {
  'use strict';

  var STORE = 'polylingo.groq.v1';
  var BASE = 'https://api.groq.com/openai/v1';
  var TIMEOUT = 30000;

  var DEFAULT_MODEL = 'llama-3.3-70b-versatile';

  // shown before we have ever talked to the API; the real list is
  // fetched from /models as soon as a key is tested
  var KNOWN_MODELS = [
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
    'openai/gpt-oss-120b',
    'openai/gpt-oss-20b',
    'moonshotai/kimi-k2-instruct',
    'qwen/qwen3-32b'
  ];

  var SKIP_MODEL = /whisper|tts|guard|embed|vision-preview|prompt-?guard/i;

  /* ---------------- stored settings ---------------- */

  var settings = load();

  function load() {
    var out = { key: '', model: DEFAULT_MODEL, enabled: true, romanize: true };
    try {
      var saved = JSON.parse(localStorage.getItem(STORE) || '{}');
      if (typeof saved.key === 'string') out.key = saved.key;
      if (typeof saved.model === 'string' && saved.model) out.model = saved.model;
      if (typeof saved.enabled === 'boolean') out.enabled = saved.enabled;
      if (typeof saved.romanize === 'boolean') out.romanize = saved.romanize;
    } catch (e) { /* unreadable storage, use defaults */ }
    return out;
  }

  function save(patch) {
    Object.keys(patch || {}).forEach(function (k) {
      if (k in settings) settings[k] = patch[k];
    });
    try {
      localStorage.setItem(STORE, JSON.stringify(settings));
    } catch (e) {
      console.warn('Could not save the Groq settings:', e.message);
    }
    return get();
  }

  function forget() {
    settings = { key: '', model: DEFAULT_MODEL, enabled: true, romanize: true };
    try { localStorage.removeItem(STORE); } catch (e) { /* ignore */ }
  }

  function get() {
    return {
      key: settings.key,
      model: settings.model,
      enabled: settings.enabled,
      romanize: settings.romanize
    };
  }

  function hasKey() { return !!settings.key; }

  /** Ready to be used as a translation provider. */
  function isConfigured() { return !!settings.key && settings.enabled; }

  /** Should the LLM also supply the Thai romanization? */
  function romanizes() { return isConfigured() && settings.romanize; }

  /* ---------------- requests ---------------- */

  function describeFailure(status, payload) {
    var detail = (payload && payload.error && payload.error.message) || '';

    if (status === 401) return 'Groq rejected the API key. Check that it was copied in full and is still active.';
    if (status === 403) return 'This Groq key is not allowed to use that model.';
    if (status === 429) return 'Groq rate limit reached — waiting a moment usually clears it.';
    if (status === 413) return 'That text is too long for Groq in one go.';
    if (status >= 500) return 'Groq is having trouble right now (error ' + status + ').';
    if (detail) return 'Groq: ' + detail;
    return 'Groq returned error ' + status + '.';
  }

  function request(path, init) {
    if (!settings.key) return Promise.reject(new Error('No Groq API key has been saved yet.'));

    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, TIMEOUT);

    var options = Object.assign({ method: 'GET' }, init, {
      signal: controller.signal,
      headers: Object.assign({
        'Authorization': 'Bearer ' + settings.key,
        'Content-Type': 'application/json'
      }, (init && init.headers) || {})
    });

    return fetch(BASE + path, options)
      .catch(function (err) {
        throw new Error(err.name === 'AbortError'
          ? 'Groq did not answer within ' + (TIMEOUT / 1000) + ' seconds.'
          : 'Could not reach Groq. Check your internet connection.');
      })
      .then(function (res) {
        return res.text().then(function (body) {
          var payload = null;
          try { payload = JSON.parse(body); } catch (e) { /* not JSON */ }
          if (!res.ok) {
            var error = new Error(describeFailure(res.status, payload));
            error.status = res.status;
            error.detail = (payload && payload.error && payload.error.message) || body;
            throw error;
          }
          return payload;
        });
      })
      .finally(function () { clearTimeout(timer); });
  }

  /**
   * chat(messages, opts) -> Promise<string>  (the assistant's text)
   * opts: { json: true, temperature, maxTokens, model }
   */
  function chat(messages, opts) {
    opts = opts || {};

    var body = {
      model: opts.model || settings.model || DEFAULT_MODEL,
      messages: messages,
      temperature: typeof opts.temperature === 'number' ? opts.temperature : 0.2,
      max_tokens: opts.maxTokens || 2048
    };
    if (opts.json) body.response_format = { type: 'json_object' };

    function send(payload) {
      return request('/chat/completions', { method: 'POST', body: JSON.stringify(payload) });
    }

    return send(body)
      .catch(function (err) {
        // a few models refuse response_format; try again in plain text mode
        var unsupported = err.status === 400 && /response_format|json/i.test(err.detail || '');
        if (!unsupported) throw err;
        var plain = Object.assign({}, body);
        delete plain.response_format;
        return send(plain);
      })
      .then(function (data) {
        var content = data && data.choices && data.choices[0] &&
                      data.choices[0].message && data.choices[0].message.content;
        if (!content) throw new Error('Groq replied with an empty message.');
        return content;
      });
  }

  /** Pull out the first JSON object in a reply, fenced or not. */
  function parseJson(content) {
    var text = String(content).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    try { return JSON.parse(text); } catch (e) { /* keep digging */ }

    var start = text.indexOf('{');
    var end = text.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try { return JSON.parse(text.slice(start, end + 1)); } catch (e) { /* give up */ }
    }
    return null;
  }

  /** Chat models available to this key, best-effort. */
  function listModels() {
    return request('/models').then(function (data) {
      var items = (data && data.data) || [];
      var ids = items
        .filter(function (m) { return m && m.id && !SKIP_MODEL.test(m.id); })
        .map(function (m) { return m.id; })
        .sort();
      return ids.length ? ids : KNOWN_MODELS.slice();
    });
  }

  /** Check a key works and return the usable model list. */
  function verify(key, model) {
    var previous = settings.key;
    settings.key = key;

    return listModels()
      .then(function (models) {
        if (model && models.indexOf(model) === -1) {
          // keep going, but let the caller know the saved choice is gone
          return { models: models, modelMissing: true };
        }
        return { models: models, modelMissing: false };
      })
      .catch(function (err) {
        settings.key = previous;
        throw err;
      });
  }

  global.Groq = {
    get: get,
    save: save,
    forget: forget,
    hasKey: hasKey,
    isConfigured: isConfigured,
    romanizes: romanizes,
    chat: chat,
    parseJson: parseJson,
    listModels: listModels,
    verify: verify,
    defaultModel: DEFAULT_MODEL,
    knownModels: KNOWN_MODELS.slice()
  };
})(window);
