/**
 * IndexedDB 适配器：浏览器静态环境的正式存储，标注「本机保存」。
 *
 * 与 MemoryBackend 共用同一 StorageBackend 接口；数据按访问者 userId 分区
 * （object store `partitions`，键 = userId）。单个 readwrite 事务内完成
 * 读-改-写，失败即中止回滚——写入中断不会出现半个版本。
 *
 * 「本机保存」只在当前浏览器设备上有效，不是跨设备同步；访客数据留在
 * 本机分区，不进入任何匿名公共表。托管数据库适配器待 Function 路由与
 * backend 授权后接入（见 sites/docs/progress.md 能力记录）。
 */

import { defaultStoreState, type Actor, type StorageBackend, type StoreState } from "./storage.ts";

export const LOCAL_STORAGE_LABEL = "本机保存";
export const DEFAULT_DB_NAME = "agentflow-exp";

/** 本适配器实际用到的 IndexedDB 结构子集（仓库无 DOM lib，按结构声明）。 */
interface IDBRequestLike<T> {
  result: T;
  error: unknown;
  onsuccess: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

interface IDBObjectStoreLike {
  get(key: string): IDBRequestLike<StoreState | undefined>;
  put(value: StoreState, key: string): IDBRequestLike<unknown>;
}

interface IDBTransactionLike {
  error: unknown;
  oncomplete: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onabort: ((event: unknown) => void) | null;
  abort(): void;
}

interface IDBDatabaseLike {
  objectStoreNames: { contains(name: string): boolean };
  createObjectStore(name: string): void;
  transaction(name: string, mode: "readonly" | "readwrite"): IDBTransactionLike & {
    objectStore(name: string): IDBObjectStoreLike;
  };
}

interface IDBOpenDBRequestLike extends IDBRequestLike<IDBDatabaseLike> {
  onupgradeneeded: ((event: unknown) => void) | null;
}

interface IDBFactoryLike {
  open(name: string, version?: number): IDBOpenDBRequestLike;
}

type TxWithStore = IDBTransactionLike & { objectStore(name: string): IDBObjectStoreLike };

export function createIndexedDBBackend(
  factory: IDBFactoryLike,
  dbName: string = DEFAULT_DB_NAME,
): StorageBackend {
  let dbPromise: Promise<IDBDatabaseLike> | null = null;

  function openDb(): Promise<IDBDatabaseLike> {
    if (!dbPromise) {
      dbPromise = new Promise<IDBDatabaseLike>((resolve, reject) => {
        const request = factory.open(dbName, 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains("partitions")) {
            db.createObjectStore("partitions");
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("indexeddb_open_failed"));
      });
      dbPromise.catch(() => {
        dbPromise = null;
      });
    }
    return dbPromise;
  }

  async function transactLocal<T>(actor: Actor, fn: (draft: StoreState) => T): Promise<T> {
    const db = await openDb();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction("partitions", "readwrite") as TxWithStore;
      const store = tx.objectStore("partitions");
      let settled = false;
      let output: T | undefined;
      const getReq = store.get(actor.userId);

      getReq.onsuccess = () => {
        try {
          const draft: StoreState = getReq.result
            ? structuredClone(getReq.result)
            : defaultStoreState();
          output = fn(draft);
          store.put(draft, actor.userId);
        } catch (error) {
          try {
            tx.abort();
          } catch {
            // 事务可能已进入失败态，统一走 reject
          }
          if (!settled) {
            settled = true;
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        }
      };
      getReq.onerror = () => {
        if (!settled) {
          settled = true;
          reject(getReq.error ?? new Error("indexeddb_get_failed"));
        }
      };
      tx.oncomplete = () => {
        if (!settled) {
          settled = true;
          resolve(output as T);
        }
      };
      tx.onerror = () => {
        if (!settled) {
          settled = true;
          reject(tx.error ?? new Error("indexeddb_transaction_failed"));
        }
      };
      tx.onabort = () => {
        if (!settled) {
          settled = true;
          reject(tx.error ?? new Error("indexeddb_transaction_aborted"));
        }
      };
    });
  }

  async function readLocal(actor: Actor): Promise<StoreState> {
    const db = await openDb();
    return new Promise<StoreState>((resolve, reject) => {
      const tx = db.transaction("partitions", "readonly") as TxWithStore;
      const store = tx.objectStore("partitions");
      const getReq = store.get(actor.userId);
      getReq.onsuccess = () =>
        resolve(getReq.result ? structuredClone(getReq.result) : defaultStoreState());
      getReq.onerror = () => reject(getReq.error ?? new Error("indexeddb_get_failed"));
      tx.onerror = () => reject(tx.error ?? new Error("indexeddb_transaction_failed"));
      tx.onabort = () => reject(tx.error ?? new Error("indexeddb_transaction_aborted"));
    });
  }

  return {
    transact: transactLocal,
    read: readLocal,
  };
}
