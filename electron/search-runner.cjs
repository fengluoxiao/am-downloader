const { randomUUID } = require('node:crypto');

function createSearchRunner({ getPage, search, getStorefront }) {
  const active = new Map();
  const closePage = (run) => { if (run.page) void run.page.close().catch(() => {}); };
  const abort = (run) => { run.controller.abort(); closePage(run); };
  return {
    cancel(event, requestId) {
      const run = active.get(event.sender.id);
      if (run?.requestId === requestId) abort(run);
    },
    async run(event, opts) {
      const { sender } = event;
      const requestId = opts.requestId || randomUUID();
      if (!opts.term || !String(opts.term).trim()) return { error: '搜索词不能为空', status: 400, requestId };
      const previous = active.get(sender.id);
      if (previous) abort(previous);
      const run = { requestId, controller: new AbortController(), page: null };
      active.set(sender.id, run);
      const current = () => active.get(sender.id) === run && !run.controller.signal.aborted && !sender.isDestroyed();
      const update = (data) => { if (current()) sender.send('search:update', { requestId, ...data }); };
      const destroyed = () => abort(run);
      sender.once('destroyed', destroyed);
      try {
        run.page = await getPage();
        if (!current()) return { cancelled: true, requestId };
        const payload = await search(run.page, String(opts.term).trim(), opts.storefront || getStorefront(),
          opts.type || 'song', opts.albumFilter || 'albumPriority', Math.max(0, Number(opts.offset) || 0), {
            mode: opts.mode === 'alac' || opts.mode === 'aac' ? opts.mode : 'atmos',
            signal: run.controller.signal,
            onResult: (item) => update({ item }),
            onProgress: (progress) => update({ progress }),
          });
        if (!current()) return { cancelled: true, requestId };
        const error = Array.isArray(payload) ? payload[0] : (payload?.error ? payload : null);
        if (error?.error) return { error: error.error, status: error.status || 500, requestId };
        return { ok: true, results: payload.results || [], pagination: payload.pagination || null, requestId };
      } catch (error) {
        if (!current()) return { cancelled: true, requestId };
        return { error: `搜索失败: ${error.message}`, status: 500, requestId };
      } finally {
        sender.removeListener('destroyed', destroyed);
        if (active.get(sender.id) === run) active.delete(sender.id);
        if (run.page) await run.page.close().catch(() => {});
      }
    },
  };
}

module.exports = { createSearchRunner };
