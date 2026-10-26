/**
 * Storage Service: Uses IndexedDB to persist large binary .hfstol models,
 * custom user dictionaries, settings, and saved annotation sessions.
 * Gracefully falls back to in-memory map if IndexedDB is not available.
 */

const DB_NAME = 'hfst_glosser_db';
const DB_VERSION = 1;

class StorageService {
  constructor() {
    this.db = null;
    this.memoryStore = {
      models: new Map(),
      dictionaries: new Map(),
      settings: new Map(),
      sessions: new Map()
    };
    this._hasIndexedDB = typeof indexedDB !== 'undefined';
    this._initPromise = this._hasIndexedDB ? this._initDB() : Promise.resolve(null);
  }

  async _initDB() {
    if (!this._hasIndexedDB) return null;
    return new Promise((resolve) => {
      try {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
          const db = event.target.result;

          if (!db.objectStoreNames.contains('models')) {
            db.createObjectStore('models', { keyPath: 'id' });
          }

          if (!db.objectStoreNames.contains('dictionaries')) {
            const dictStore = db.createObjectStore('dictionaries', { keyPath: 'id' });
            dictStore.createIndex('src_lang', 'src_lang', { unique: false });
            dictStore.createIndex('lemma', 'lemma', { unique: false });
          }

          if (!db.objectStoreNames.contains('settings')) {
            db.createObjectStore('settings', { keyPath: 'key' });
          }

          if (!db.objectStoreNames.contains('sessions')) {
            db.createObjectStore('sessions', { keyPath: 'id' });
          }
        };

        request.onsuccess = (event) => {
          this.db = event.target.result;
          resolve(this.db);
        };

        request.onerror = (event) => {
          console.warn('IndexedDB unavailable, falling back to memory store:', event.target.error);
          this.db = null;
          resolve(null);
        };
      } catch (err) {
        this.db = null;
        resolve(null);
      }
    });
  }

  async _getStore(storeName, mode = 'readonly') {
    await this._initPromise;
    if (!this.db) return null;
    try {
      const tx = this.db.transaction(storeName, mode);
      return tx.objectStore(storeName);
    } catch (e) {
      return null;
    }
  }

  // Model storage
  async saveModel(id, name, type, arrayBuffer, metadata = {}) {
    const store = await this._getStore('models', 'readwrite');
    const record = {
      id,
      name,
      type,
      buffer: arrayBuffer,
      size: arrayBuffer.byteLength,
      timestamp: Date.now(),
      metadata
    };

    if (!store) {
      this.memoryStore.models.set(id, record);
      return record;
    }

    return new Promise((resolve, reject) => {
      const req = store.put(record);
      req.onsuccess = () => resolve(record);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async getModel(id) {
    const store = await this._getStore('models', 'readonly');
    if (!store) {
      return this.memoryStore.models.get(id) || null;
    }
    return new Promise((resolve) => {
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  }

  async getAllModels() {
    const store = await this._getStore('models', 'readonly');
    if (!store) {
      return Array.from(this.memoryStore.models.values());
    }
    return new Promise((resolve) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  }

  async deleteModel(id) {
    const store = await this._getStore('models', 'readwrite');
    if (!store) {
      this.memoryStore.models.delete(id);
      return true;
    }
    return new Promise((resolve) => {
      const req = store.delete(id);
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
    });
  }

  // Custom Dictionary Entries storage
  async addDictionaryEntry(entry) {
    if (!entry.id) {
      entry.id = `${entry.src_lang}_${entry.lemma}_${entry.tgt_lang}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    }
    entry.timestamp = Date.now();

    const store = await this._getStore('dictionaries', 'readwrite');
    if (!store) {
      this.memoryStore.dictionaries.set(entry.id, entry);
      return entry;
    }

    return new Promise((resolve, reject) => {
      const req = store.put(entry);
      req.onsuccess = () => resolve(entry);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async addDictionaryEntries(entries) {
    const store = await this._getStore('dictionaries', 'readwrite');
    if (!store) {
      for (const entry of entries) {
        if (!entry.id) {
          entry.id = `${entry.src_lang}_${entry.lemma}_${entry.tgt_lang}_${Math.random().toString(36).substring(2, 9)}`;
        }
        entry.timestamp = Date.now();
        this.memoryStore.dictionaries.set(entry.id, entry);
      }
      return entries.length;
    }

    return new Promise((resolve, reject) => {
      for (const entry of entries) {
        if (!entry.id) {
          entry.id = `${entry.src_lang}_${entry.lemma}_${entry.tgt_lang}_${Math.random().toString(36).substring(2, 9)}`;
        }
        entry.timestamp = Date.now();
        store.put(entry);
      }
      store.transaction.oncomplete = () => resolve(entries.length);
      store.transaction.onerror = (e) => reject(e.target.error);
    });
  }

  async getCustomEntries(src_lang = null, lemma = null) {
    const store = await this._getStore('dictionaries', 'readonly');
    let results = [];

    if (!store) {
      results = Array.from(this.memoryStore.dictionaries.values());
    } else {
      results = await new Promise((resolve) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      });
    }

    if (src_lang) {
      results = results.filter(e => e.src_lang.toLowerCase() === src_lang.toLowerCase());
    }
    if (lemma) {
      results = results.filter(e => e.lemma.toLowerCase() === lemma.toLowerCase());
    }
    return results;
  }

  async deleteDictionaryEntry(id) {
    const store = await this._getStore('dictionaries', 'readwrite');
    if (!store) {
      this.memoryStore.dictionaries.delete(id);
      return true;
    }
    return new Promise((resolve) => {
      const req = store.delete(id);
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
    });
  }

  // Settings
  async getSetting(key, defaultValue = null) {
    const store = await this._getStore('settings', 'readonly');
    if (!store) {
      return this.memoryStore.settings.has(key) ? this.memoryStore.settings.get(key) : defaultValue;
    }
    return new Promise((resolve) => {
      const req = store.get(key);
      req.onsuccess = () => {
        resolve(req.result ? req.result.value : defaultValue);
      };
      req.onerror = () => resolve(defaultValue);
    });
  }

  async setSetting(key, value) {
    const store = await this._getStore('settings', 'readwrite');
    if (!store) {
      this.memoryStore.settings.set(key, value);
      return value;
    }
    return new Promise((resolve) => {
      const req = store.put({ key, value });
      req.onsuccess = () => resolve(value);
      req.onerror = () => resolve(value);
    });
  }

  // Treebank Accumulator storage (persists in 'sessions' store)
  async saveAccumulatedTreebank(treebank) {
    if (!treebank.id) {
      treebank.id = `tb_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    }
    treebank.timestamp = treebank.timestamp || Date.now();

    const store = await this._getStore('sessions', 'readwrite');
    if (!store) {
      this.memoryStore.sessions.set(treebank.id, treebank);
      return treebank;
    }

    return new Promise((resolve, reject) => {
      const req = store.put(treebank);
      req.onsuccess = () => resolve(treebank);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async getAllAccumulatedTreebanks() {
    const store = await this._getStore('sessions', 'readonly');
    let results = [];
    if (!store) {
      results = Array.from(this.memoryStore.sessions.values());
    } else {
      results = await new Promise((resolve) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      });
    }

    // Filter to treebank items (those having tokens or sent_id) and sort by order/sent_id
    results = results.filter(item => item && (item.tokens || item.sent_id));
    results.sort((a, b) => (a.order || a.sent_id || 0) - (b.order || b.sent_id || 0));
    return results;
  }

  async deleteAccumulatedTreebank(id) {
    const store = await this._getStore('sessions', 'readwrite');
    if (!store) {
      this.memoryStore.sessions.delete(id);
      return true;
    }
    return new Promise((resolve) => {
      const req = store.delete(id);
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
    });
  }

  async clearAccumulatedTreebanks() {
    const store = await this._getStore('sessions', 'readwrite');
    if (!store) {
      this.memoryStore.sessions.clear();
      return true;
    }
    return new Promise((resolve) => {
      const req = store.clear();
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
    });
  }
}

export const storageService = new StorageService();
