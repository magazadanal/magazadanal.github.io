(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MABrowserSession = factory();
})(globalThis, function () {
  "use strict";
  const KEY = "magazadanal.web.browser-account.v1";
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  class SessionError extends Error {
    constructor(code) {
      super(code === "conflict"
        ? "Bu tarayıcıda başka bir hesap açık. Önce tarayıcıdaki oturumu kapat."
        : code === "retired"
          ? "Bu tarayıcıdaki oturum kapatıldı. Yeniden giriş yap."
          : "Tarayıcı oturum kontrolü kullanılamıyor. Güncel bir tarayıcıda site depolamasına izin verip yeniden dene.");
      this.code = code;
    }
  }

  function create(options = {}) {
    const storage = options.storage || (() => globalThis.localStorage);
    const locks = options.locks || globalThis.navigator?.locks;
    const uuid = options.uuid || (() => globalThis.crypto.randomUUID());
    function read() {
      try {
        const text = storage().getItem(KEY);
        if (text === null) return null;
        const record = JSON.parse(text);
        if (Object.keys(record).sort().join() !== "id,owner,version" || record.version !== 1 || !UUID.test(record.owner) || !UUID.test(record.id)) throw Error();
        return record;
      } catch { throw new SessionError("unavailable"); }
    }
    async function exclusive(operation) {
      if (!locks?.request) throw new SessionError("unavailable");
      try { return await locks.request(KEY, { mode: "exclusive" }, operation); }
      catch (error) { throw error instanceof SessionError ? error : new SessionError("unavailable"); }
    }
    function assert(owner, id) {
      const record = read();
      if (!UUID.test(owner) || !UUID.test(id) || record?.owner !== owner || record?.id !== id) throw new SessionError("retired");
      return record;
    }
    return {
      key: KEY,
      assert,
      claim(owner, previousID) {
        return exclusive(() => {
          if (!UUID.test(owner)) throw new SessionError("unavailable");
          const record = read();
          if (previousID && (record?.id !== previousID || record?.owner !== owner)) throw new SessionError("retired");
          if (record && record.owner !== owner) throw new SessionError("conflict");
          if (record) return record.id;
          const id = uuid();
          if (!UUID.test(id)) throw new SessionError("unavailable");
          storage().setItem(KEY, JSON.stringify({ version: 1, owner, id }));
          assert(owner, id);
          return id;
        });
      },
      release(owner, id) {
        return exclusive(() => {
          const record = read();
          if (record?.owner === owner && record?.id === id) storage().removeItem(KEY);
        });
      },
      reset() { return exclusive(() => storage().removeItem(KEY)); }
    };
  }
  return { create, SessionError };
});
