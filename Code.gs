const PARENT_FOLDER_ID = "1SVtwNmBZG1NYoR0fdcRQaFhDCYRsJ5UP";
const TIME_ZONE = "Asia/Tokyo";
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 15 * 1024 * 1024;
const MAX_FILES_PER_RUN = 5;
const MAX_ITEMS_PER_RUN = 100;
const MAX_RUNS_PER_DAY = 100;
const MIN_RUN_INTERVAL_MS = 15 * 1000;
const TOKEN_TTL_MS = 30 * 60 * 1000;
const TOKEN_PREFIX = "roulette_run_";
const AUDIO_TYPES = {
  mp3: ["audio/mpeg", "audio/mp3"],
  wav: ["audio/wav", "audio/x-wav", "audio/wave"],
  ogg: ["audio/ogg", "application/ogg"],
  m4a: ["audio/mp4", "audio/x-m4a"],
  aac: ["audio/aac", "audio/x-aac"],
  webm: ["audio/webm"],
  flac: ["audio/flac", "audio/x-flac"],
};

function doGet() {
  return HtmlService.createTemplateFromFile("index")
    .evaluate()
    .setTitle("シンプルルーレット")
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function setup() {
  try {
    const folder = getParentFolder_();
    Logger.log("保存先フォルダを確認しました: " + folder.getName());
    return "保存先へのアクセスを確認しました。フォルダ: " + folder.getName();
  } catch (error) {
    const message = error && error.message ? error.message : "";
    if (message.indexOf("USER:") === 0) throw new Error(message.slice(5));
    throw error;
  }
}

function beginSpin(payload) {
  return api_(function () {
    const items = validateItems_(payload && payload.items);
    const files = validateFileDescriptors_(payload && payload.files, items);
    const lock = LockService.getScriptLock();
    try {
      lock.waitLock(10000);
    } catch (error) {
      throw userError_(
        "現在リクエストが集中しています。少し待ってから再試行してください。",
      );
    }
    try {
      const properties = PropertiesService.getScriptProperties();
      removeExpiredTokens_(properties);
      const now = new Date();
      const nowMs = now.getTime();
      const dateKey = Utilities.formatDate(now, TIME_ZONE, "yyyyMMdd");
      const lastRunMs = Number(
        properties.getProperty("roulette_last_run_ms") || 0,
      );
      if (lastRunMs && nowMs - lastRunMs < MIN_RUN_INTERVAL_MS) {
        throw userError_("実行間隔は15秒以上あけてください。");
      }
      const countKey = "roulette_runs_" + dateKey;
      const dailyCount = Number(properties.getProperty(countKey) || 0);
      if (dailyCount >= MAX_RUNS_PER_DAY) {
        throw userError_(
          "本日の実行上限に達しました。時間をおいて再度ご利用ください。",
        );
      }

      const parentFolder = getParentFolder_();
      const runId = Utilities.getUuid();
      const folder = createRunFolder_(parentFolder, now, runId);
      const token = Utilities.getUuid();
      const state = {
        runId: runId,
        folderId: folder.getId(),
        startedAt: now.toISOString(),
        expiresAt: nowMs + TOKEN_TTL_MS,
        itemsHash: hashItems_(items),
        expectedFiles: files,
        uploadedFiles: [],
        manifestId: "",
      };
      properties.setProperty(TOKEN_PREFIX + token, JSON.stringify(state));
      properties.setProperty(countKey, String(dailyCount + 1));
      properties.setProperty("roulette_last_run_ms", String(nowMs));
      return {
        ok: true,
        runId: runId,
        token: token,
        startedAt: state.startedAt,
      };
    } finally {
      lock.releaseLock();
    }
  });
}

function uploadAudio(payload) {
  return api_(function () {
    if (
      !payload ||
      typeof payload.itemId !== "string" ||
      typeof payload.base64 !== "string"
    ) {
      throw userError_("音声データの形式が正しくありません。");
    }
    const token = validateToken_(payload.token);
    const lock = LockService.getScriptLock();
    try {
      lock.waitLock(10000);
    } catch (error) {
      throw userError_(
        "現在リクエストが集中しています。少し待ってから再試行してください。",
      );
    }
    try {
      const properties = PropertiesService.getScriptProperties();
      const state = getTokenState_(properties, token);
      if (state.manifestId)
        throw userError_("この実行はすでに完了しています。");
      const index = state.expectedFiles.findIndex(function (file) {
        return file.itemId === payload.itemId;
      });
      if (index < 0) throw userError_("この実行に登録されていない項目です。");
      if (
        state.uploadedFiles.some(function (file) {
          return file.itemId === payload.itemId;
        })
      ) {
        throw userError_("この項目の音声はすでに送信されています。");
      }
      const descriptor = state.expectedFiles[index];
      const encoded = payload.base64;
      if (
        encoded.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 + 4 ||
        encoded.length % 4 !== 0 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
      ) {
        throw userError_("音声データが不正か、5MBの上限を超えています。");
      }
      let bytes;
      try {
        bytes = Utilities.base64Decode(encoded);
      } catch (error) {
        throw userError_("音声データを読み取れませんでした。");
      }
      if (
        !bytes.length ||
        bytes.length !== descriptor.size ||
        bytes.length > MAX_FILE_BYTES
      ) {
        throw userError_(
          "音声ファイルの容量が送信前の検証結果と一致しません。",
        );
      }
      validateAudioType_(descriptor.name, descriptor.mimeType);
      const extension = getExtension_(descriptor.name);
      const safeName =
        "audio-" + ("0" + (index + 1)).slice(-2) + "." + extension;
      let file;
      try {
        const folder = DriveApp.getFolderById(state.folderId);
        file = folder.createFile(
          Utilities.newBlob(bytes, descriptor.mimeType, safeName),
        );
      } catch (error) {
        console.error("Drive audio save failed: " + error.message);
        throw userError_(
          "音声の保存に失敗しました。保存先の権限と容量を確認してください。",
        );
      }
      state.uploadedFiles.push({
        itemId: descriptor.itemId,
        driveFileId: file.getId(),
        fileName: safeName,
        originalName: descriptor.name,
        mimeType: descriptor.mimeType,
        size: descriptor.size,
      });
      properties.setProperty(TOKEN_PREFIX + token, JSON.stringify(state));
      return { ok: true, fileName: safeName };
    } finally {
      lock.releaseLock();
    }
  });
}

function finishSpin(payload) {
  return api_(function () {
    if (
      !payload ||
      typeof payload.runId !== "string" ||
      typeof payload.winnerId !== "string" ||
      !Array.isArray(payload.items)
    ) {
      throw userError_("抽選結果の形式が正しくありません。");
    }
    const token = validateToken_(payload.token);
    const items = validateItems_(payload.items);
    const lock = LockService.getScriptLock();
    try {
      lock.waitLock(10000);
    } catch (error) {
      throw userError_(
        "現在リクエストが集中しています。少し待ってから再試行してください。",
      );
    }
    try {
      const properties = PropertiesService.getScriptProperties();
      const state = getTokenState_(properties, token);
      if (state.runId !== payload.runId)
        throw userError_("実行IDが一致しません。");
      if (state.manifestId)
        return { ok: true, runId: state.runId, duplicate: true };
      if (hashItems_(items) !== state.itemsHash)
        throw userError_("実行開始後に項目が変更されています。");
      const winner = items.find(function (item) {
        return item.id === payload.winnerId;
      });
      if (!winner) throw userError_("当選項目が登録内容と一致しません。");
      if (state.uploadedFiles.length !== state.expectedFiles.length) {
        throw userError_(
          "音声ファイルの保存が完了していないため、結果を記録できません。",
        );
      }
      const audioByItem = {};
      state.uploadedFiles.forEach(function (file) {
        audioByItem[file.itemId] = file;
      });
      const manifest = {
        schemaVersion: 1,
        runId: state.runId,
        startedAt: state.startedAt,
        finishedAt: new Date().toISOString(),
        timeZone: TIME_ZONE,
        items: items.map(function (item) {
          const audio = audioByItem[item.id];
          return {
            id: item.id,
            text: item.text,
            audio: audio
              ? {
                  fileId: audio.driveFileId,
                  fileName: audio.fileName,
                  originalName: audio.originalName,
                  mimeType: audio.mimeType,
                  size: audio.size,
                }
              : null,
          };
        }),
        winner: { id: winner.id, text: winner.text },
      };
      let manifestFile;
      try {
        manifestFile = DriveApp.getFolderById(state.folderId).createFile(
          "manifest.json",
          JSON.stringify(manifest, null, 2),
          MimeType.JSON,
        );
      } catch (error) {
        console.error("Drive manifest save failed: " + error.message);
        throw userError_(
          "結果の記録に失敗しました。保存先の権限と容量を確認してください。",
        );
      }
      state.manifestId = manifestFile.getId();
      properties.setProperty(TOKEN_PREFIX + token, JSON.stringify(state));
      return { ok: true, runId: state.runId };
    } finally {
      lock.releaseLock();
    }
  });
}

function api_(callback) {
  try {
    return callback();
  } catch (error) {
    const message = error && error.message ? error.message : "";
    if (message.indexOf("USER:") === 0) {
      return { ok: false, error: message.slice(5) };
    }
    console.error("Roulette API failed: " + message);
    return {
      ok: false,
      error:
        "サーバー処理に失敗しました。設定と保存先の権限を確認してください。",
    };
  }
}

function userError_(message) {
  return new Error("USER:" + message);
}

function getParentFolder_() {
  if (!PARENT_FOLDER_ID || PARENT_FOLDER_ID === "SET_PARENT_FOLDER_ID_HERE") {
    throw userError_(
      "Code.gs の PARENT_FOLDER_ID に保存先の親フォルダIDを設定してください。",
    );
  }
  try {
    return DriveApp.getFolderById(PARENT_FOLDER_ID);
  } catch (error) {
    console.error("Parent Drive folder is unavailable: " + error.message);
    throw userError_(
      "保存先の親フォルダにアクセスできません。フォルダIDと所有者の権限を確認してください。",
    );
  }
}

function validateItems_(items) {
  if (
    !Array.isArray(items) ||
    items.length < 2 ||
    items.length > MAX_ITEMS_PER_RUN
  ) {
    throw userError_("項目数は2件以上100件以下にしてください。");
  }
  const seen = {};
  return items.map(function (item) {
    if (
      !item ||
      typeof item.id !== "string" ||
      !/^[A-Za-z0-9_-]{1,80}$/.test(item.id) ||
      typeof item.text !== "string" ||
      !item.text.trim() ||
      item.text.trim().length > 100
    ) {
      throw userError_(
        "項目IDまたは項目名が正しくありません。項目名は1～100文字で入力してください。",
      );
    }
    if (seen[item.id]) throw userError_("項目IDが重複しています。");
    seen[item.id] = true;
    return { id: item.id, text: item.text.trim() };
  });
}

function validateFileDescriptors_(files, items) {
  if (!Array.isArray(files) || files.length > MAX_FILES_PER_RUN) {
    throw userError_("1回の実行で登録できる音声は最大5ファイルです。");
  }
  const ids = {};
  items.forEach(function (item) {
    ids[item.id] = true;
  });
  const usedItemIds = {};
  let totalSize = 0;
  const validated = files.map(function (file) {
    if (
      !file ||
      typeof file.itemId !== "string" ||
      !ids[file.itemId] ||
      usedItemIds[file.itemId] ||
      typeof file.name !== "string" ||
      file.name.length > 255 ||
      typeof file.mimeType !== "string" ||
      !Number.isInteger(file.size) ||
      file.size <= 0 ||
      file.size > MAX_FILE_BYTES
    ) {
      throw userError_(
        "音声ファイルの情報が正しくないか、5MBの上限を超えています。",
      );
    }
    validateAudioType_(file.name, file.mimeType);
    usedItemIds[file.itemId] = true;
    totalSize += file.size;
    return {
      itemId: file.itemId,
      name: cleanDisplayName_(file.name),
      mimeType: file.mimeType.toLowerCase(),
      size: file.size,
    };
  });
  if (totalSize > MAX_TOTAL_BYTES)
    throw userError_("1回の実行の音声合計容量は15MB以下にしてください。");
  return validated;
}

function validateAudioType_(name, mimeType) {
  const extension = getExtension_(name);
  const acceptedTypes = AUDIO_TYPES[extension];
  if (
    !acceptedTypes ||
    typeof mimeType !== "string" ||
    acceptedTypes.indexOf(mimeType.toLowerCase()) < 0
  ) {
    throw userError_(
      "音声ファイルの拡張子またはMIMEタイプに対応していません。",
    );
  }
}

function getExtension_(name) {
  const match = typeof name === "string" && name.match(/\.([A-Za-z0-9]+)$/);
  return match ? match[1].toLowerCase() : "";
}

function cleanDisplayName_(name) {
  return name.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 255);
}

function hashItems_(items) {
  const canonical = items.map(function (item) {
    return { id: item.id, text: item.text };
  });
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    JSON.stringify(canonical),
    Utilities.Charset.UTF_8,
  );
  return Utilities.base64EncodeWebSafe(digest);
}

function validateToken_(token) {
  if (typeof token !== "string" || !/^[0-9a-f-]{36}$/i.test(token)) {
    throw userError_("実行トークンが正しくありません。");
  }
  return token;
}

function getTokenState_(properties, token) {
  const key = TOKEN_PREFIX + token;
  const serialized = properties.getProperty(key);
  if (!serialized)
    throw userError_("実行トークンが無効か、有効期限が切れています。");
  let state;
  try {
    state = JSON.parse(serialized);
  } catch (error) {
    properties.deleteProperty(key);
    throw userError_(
      "実行データを読み取れません。最初からやり直してください。",
    );
  }
  if (!state.expiresAt || Date.now() > state.expiresAt) {
    properties.deleteProperty(key);
    throw userError_(
      "実行トークンの有効期限が切れています。最初からやり直してください。",
    );
  }
  return state;
}

function removeExpiredTokens_(properties) {
  const all = properties.getProperties();
  Object.keys(all).forEach(function (key) {
    if (key.indexOf(TOKEN_PREFIX) !== 0) return;
    try {
      const state = JSON.parse(all[key]);
      if (!state.expiresAt || Date.now() > state.expiresAt)
        properties.deleteProperty(key);
    } catch (error) {
      properties.deleteProperty(key);
    }
  });
}

function createRunFolder_(parent, date, runId) {
  const parts = [
    Utilities.formatDate(date, TIME_ZONE, "yyyy"),
    Utilities.formatDate(date, TIME_ZONE, "MM"),
    Utilities.formatDate(date, TIME_ZONE, "dd"),
    Utilities.formatDate(date, TIME_ZONE, "HH"),
    Utilities.formatDate(date, TIME_ZONE, "mm"),
    Utilities.formatDate(date, TIME_ZONE, "ss"),
  ];
  let current = parent;
  parts.forEach(function (part) {
    current = getOrCreateFolder_(current, part);
  });
  return current.createFolder("run_" + runId);
}

function getOrCreateFolder_(parent, name) {
  try {
    const folders = parent.getFoldersByName(name);
    if (folders.hasNext()) return folders.next();
    return parent.createFolder(name);
  } catch (error) {
    console.error("Drive folder creation failed: " + error.message);
    throw userError_(
      "保存先フォルダを作成できません。保存先の権限を確認してください。",
    );
  }
}
