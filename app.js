const DB_NAME = "offline-beat-db";
const DB_VERSION = 1;
const DEFAULT_PLAYLIST_ID = "library";
const AUDIO_TYPES = new Set(["audio/mpeg", "audio/mp3", "audio/wav", "audio/ogg", "audio/mp4", "audio/x-m4a", "audio/aac"]);

const state = {
  songs: [],
  playlists: [],
  activePlaylistId: DEFAULT_PLAYLIST_ID,
  currentSongId: null,
  isPlaying: false,
  objectUrl: null,
  volume: 0.8,
};

const audio = new Audio();
audio.preload = "metadata";
audio.volume = state.volume;

const els = {
  activePlaylistTitle: document.querySelector("#activePlaylistTitle"),
  audioUrlButton: document.querySelector("#audioUrlButton"),
  audioUrlForm: document.querySelector("#audioUrlForm"),
  audioUrlInput: document.querySelector("#audioUrlInput"),
  currentPlaylistName: document.querySelector("#currentPlaylistName"),
  currentSongTitle: document.querySelector("#currentSongTitle"),
  currentTime: document.querySelector("#currentTime"),
  durationTime: document.querySelector("#durationTime"),
  importSongsButton: document.querySelector("#importSongsButton"),
  nextButton: document.querySelector("#nextButton"),
  playPauseButton: document.querySelector("#playPauseButton"),
  playPauseIcon: document.querySelector("#playPauseIcon"),
  playPlaylistButton: document.querySelector("#playPlaylistButton"),
  playPlaylistIcon: document.querySelector("#playPlaylistIcon"),
  playlistForm: document.querySelector("#playlistForm"),
  playlistMeta: document.querySelector("#playlistMeta"),
  playlistNameInput: document.querySelector("#playlistNameInput"),
  playlistNav: document.querySelector("#playlistNav"),
  previousButton: document.querySelector("#previousButton"),
  progressRange: document.querySelector("#progressRange"),
  songFileInput: document.querySelector("#songFileInput"),
  toast: document.querySelector("#toast"),
  trackList: document.querySelector("#trackList"),
  volumeRange: document.querySelector("#volumeRange"),
};

let dbPromise;
let toastTimer;

function openDb() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("songs")) {
        db.createObjectStore("songs", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("playlists")) {
        db.createObjectStore("playlists", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("settings")) {
        db.createObjectStore("settings", { keyPath: "key" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

async function dbGetAll(storeName) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, "readonly").objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function dbPut(storeName, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, "readwrite").objectStore(storeName).put(value);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function dbDelete(storeName, key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, "readwrite").objectStore(storeName).delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function dbGetSetting(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction("settings", "readonly").objectStore("settings").get(key);
    request.onsuccess = () => resolve(request.result?.value);
    request.onerror = () => reject(request.error);
  });
}

async function dbSetSetting(key, value) {
  return dbPut("settings", { key, value });
}

async function init() {
  bindEvents();
  await loadState();
  render();
  registerServiceWorker();
}

async function loadState() {
  state.songs = await dbGetAll("songs");
  state.playlists = await dbGetAll("playlists");

  if (!state.playlists.some((playlist) => playlist.id === DEFAULT_PLAYLIST_ID)) {
    const library = { id: DEFAULT_PLAYLIST_ID, name: "我的音乐库", songIds: [], createdAt: Date.now() };
    state.playlists.unshift(library);
    await dbPut("playlists", library);
  }

  const settings = await dbGetSetting("player");
  if (settings) {
    state.activePlaylistId = settings.activePlaylistId || DEFAULT_PLAYLIST_ID;
    state.currentSongId = settings.currentSongId || null;
    state.volume = typeof settings.volume === "number" ? settings.volume : 0.8;
    audio.volume = state.volume;
    els.volumeRange.value = String(state.volume);
  }

  if (!getActivePlaylist()) {
    state.activePlaylistId = DEFAULT_PLAYLIST_ID;
  }
}

function bindEvents() {
  els.importSongsButton.addEventListener("click", () => els.songFileInput.click());
  els.songFileInput.addEventListener("change", handleSongImport);
  els.audioUrlForm.addEventListener("submit", handleAudioUrlImport);
  els.playlistForm.addEventListener("submit", handlePlaylistCreate);
  els.playPauseButton.addEventListener("click", togglePlayPause);
  els.playPlaylistButton.addEventListener("click", togglePlayPause);
  els.previousButton.addEventListener("click", playPrevious);
  els.nextButton.addEventListener("click", playNext);

  els.progressRange.addEventListener("input", () => {
    if (Number.isFinite(audio.duration)) {
      audio.currentTime = (Number(els.progressRange.value) / 100) * audio.duration;
    }
  });

  els.volumeRange.addEventListener("input", () => {
    state.volume = Number(els.volumeRange.value);
    audio.volume = state.volume;
    persistSettings();
  });

  audio.addEventListener("loadedmetadata", updateProgress);
  audio.addEventListener("timeupdate", updateProgress);
  audio.addEventListener("play", () => {
    state.isPlaying = true;
    updatePlayerUi();
  });
  audio.addEventListener("pause", () => {
    state.isPlaying = false;
    updatePlayerUi();
  });
  audio.addEventListener("ended", playNext);
  audio.addEventListener("error", () => {
    toast("这首歌无法播放，请尝试重新导入文件。");
    state.isPlaying = false;
    updatePlayerUi();
  });
}

async function handleSongImport(event) {
  const files = Array.from(event.target.files || []).filter(isSupportedAudio);
  if (!files.length) {
    toast("请选择 mp3、wav、ogg 或 m4a 音频文件。");
    return;
  }

  const importedIds = [];

  for (const file of files) {
    const id = await saveImportedSong(file);
    importedIds.push(id);
  }

  if (!state.currentSongId) {
    await selectSong(importedIds[0], false);
  }

  event.target.value = "";
  toast(`已导入 ${files.length} 首歌曲`);
  render();
}

async function handleAudioUrlImport(event) {
  event.preventDefault();
  const url = els.audioUrlInput.value.trim();
  if (!url) return;

  if (isYouTubeUrl(url)) {
    toast("不支持 YouTube 转 MP3；请使用你有权下载的直接音频文件链接。");
    return;
  }

  if (!isLikelyDirectAudioUrl(url)) {
    toast("请粘贴以 mp3、m4a、wav、ogg 或 aac 结尾的直接音频链接。");
    return;
  }

  setUrlImportBusy(true);
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const blob = await response.blob();
    if (!isSupportedAudioBlob(blob, url)) {
      throw new Error("Unsupported audio type");
    }

    const name = getNameFromUrl(url);
    const fileName = ensureAudioFileName(name, blob.type, url);
    const file = new File([blob], fileName, { type: blob.type || getAudioTypeFromUrl(url) });
    const songId = await saveImportedSong(file);

    if (!state.currentSongId) {
      await selectSong(songId, false);
    }

    els.audioUrlInput.value = "";
    render();
    toast("音频链接已下载并加入当前歌单");
  } catch (error) {
    console.error(error);
    toast("无法下载这个链接。请确认它是可公开访问的音频直链，并允许跨域访问。");
  } finally {
    setUrlImportBusy(false);
  }
}

async function saveImportedSong(file) {
  const id = crypto.randomUUID();
  const song = {
    id,
    name: cleanSongName(file.name),
    fileName: file.name,
    type: file.type || "audio/mpeg",
    size: file.size,
    blob: file,
    createdAt: Date.now(),
  };
  const targetPlaylist = getActivePlaylist() || getPlaylist(DEFAULT_PLAYLIST_ID);

  state.songs.push(song);
  targetPlaylist.songIds.push(id);

  await dbPut("songs", song);
  await dbPut("playlists", targetPlaylist);

  return id;
}

async function handlePlaylistCreate(event) {
  event.preventDefault();
  const name = els.playlistNameInput.value.trim();
  if (!name) return;

  const playlist = {
    id: crypto.randomUUID(),
    name,
    songIds: [],
    createdAt: Date.now(),
  };

  state.playlists.push(playlist);
  state.activePlaylistId = playlist.id;
  els.playlistNameInput.value = "";
  await dbPut("playlists", playlist);
  await persistSettings();
  render();
  toast("歌单已创建");
}

function isSupportedAudio(file) {
  return AUDIO_TYPES.has(file.type) || /\.(mp3|wav|ogg|m4a|aac)$/i.test(file.name);
}

function isSupportedAudioBlob(blob, url) {
  return AUDIO_TYPES.has(blob.type) || /\.(mp3|wav|ogg|m4a|aac)(\?.*)?$/i.test(url);
}

function isYouTubeUrl(value) {
  try {
    const hostname = new URL(value).hostname.replace(/^www\./, "");
    return hostname === "youtube.com" || hostname === "youtu.be" || hostname.endsWith(".youtube.com");
  } catch {
    return false;
  }
}

function isLikelyDirectAudioUrl(value) {
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) && /\.(mp3|wav|ogg|m4a|aac)$/i.test(url.pathname);
  } catch {
    return false;
  }
}

function getNameFromUrl(value) {
  try {
    const pathname = new URL(value).pathname;
    const name = decodeURIComponent(pathname.split("/").filter(Boolean).pop() || "audio.mp3");
    return name || "audio.mp3";
  } catch {
    return "audio.mp3";
  }
}

function getAudioTypeFromUrl(value) {
  const extension = getNameFromUrl(value).split(".").pop()?.toLowerCase();
  const types = {
    aac: "audio/aac",
    m4a: "audio/mp4",
    mp3: "audio/mpeg",
    ogg: "audio/ogg",
    wav: "audio/wav",
  };
  return types[extension] || "audio/mpeg";
}

function ensureAudioFileName(name, type, url) {
  if (/\.(mp3|wav|ogg|m4a|aac)$/i.test(name)) return name;
  const extensionByType = {
    "audio/aac": "aac",
    "audio/mp4": "m4a",
    "audio/mpeg": "mp3",
    "audio/ogg": "ogg",
    "audio/wav": "wav",
    "audio/x-m4a": "m4a",
  };
  const extension = extensionByType[type] || getNameFromUrl(url).split(".").pop() || "mp3";
  return `${name}.${extension}`;
}

function setUrlImportBusy(isBusy) {
  els.audioUrlButton.disabled = isBusy;
  els.audioUrlInput.disabled = isBusy;
  els.audioUrlButton.textContent = isBusy ? "添加中..." : "添加链接";
}

function cleanSongName(fileName) {
  return fileName.replace(/\.[^/.]+$/, "").replace(/[_-]+/g, " ").trim() || fileName;
}

function getPlaylist(id) {
  return state.playlists.find((playlist) => playlist.id === id);
}

function getActivePlaylist() {
  return getPlaylist(state.activePlaylistId);
}

function getSong(id) {
  return state.songs.find((song) => song.id === id);
}

function getActiveSongs() {
  const playlist = getActivePlaylist();
  if (!playlist) return [];
  return playlist.songIds.map(getSong).filter(Boolean);
}

async function setActivePlaylist(id) {
  state.activePlaylistId = id;
  await persistSettings();
  render();
}

async function addSongToPlaylist(songId, playlistId) {
  const playlist = getPlaylist(playlistId);
  if (!playlist || playlist.songIds.includes(songId)) return;
  playlist.songIds.push(songId);
  await dbPut("playlists", playlist);
  render();
  toast("已加入歌单");
}

async function renamePlaylist(playlistId) {
  const playlist = getPlaylist(playlistId);
  if (!playlist) return;
  const nextName = prompt("输入新的歌单名", playlist.name)?.trim();
  if (!nextName || nextName === playlist.name) return;

  playlist.name = nextName.slice(0, 40);
  await dbPut("playlists", playlist);
  render();
  toast("歌单名已更新");
}

async function deletePlaylist(playlistId) {
  const playlist = getPlaylist(playlistId);
  if (!playlist) return;
  if (playlist.id === DEFAULT_PLAYLIST_ID) {
    toast("默认音乐库不能删除，可以修改名称。");
    return;
  }
  if (state.playlists.length <= 1) {
    toast("至少保留一个歌单。");
    return;
  }

  const confirmed = confirm(`删除歌单「${playlist.name}」？歌单中的歌曲不会从其它歌单删除。`);
  if (!confirmed) return;

  const removedSongIds = [...playlist.songIds];
  await dbDelete("playlists", playlistId);
  state.playlists = state.playlists.filter((item) => item.id !== playlistId);

  for (const songId of removedSongIds) {
    const isStillReferenced = state.playlists.some((item) => item.songIds.includes(songId));
    if (!isStillReferenced) {
      state.songs = state.songs.filter((song) => song.id !== songId);
      await dbDelete("songs", songId);
      if (state.currentSongId === songId) {
        audio.pause();
        state.currentSongId = null;
        releaseObjectUrl();
      }
    }
  }

  if (state.activePlaylistId === playlistId) {
    state.activePlaylistId = state.playlists[0]?.id || DEFAULT_PLAYLIST_ID;
  }

  await persistSettings();
  render();
  toast("歌单已删除");
}

async function renameSong(songId) {
  const song = getSong(songId);
  if (!song) return;
  const nextName = prompt("输入新的歌曲名", song.name)?.trim();
  if (!nextName || nextName === song.name) return;

  song.name = nextName.slice(0, 80);
  await dbPut("songs", song);
  render();
  toast("歌曲名已更新");
}

async function removeSongFromPlaylist(songId) {
  const playlist = getActivePlaylist();
  if (!playlist) return;
  playlist.songIds = playlist.songIds.filter((id) => id !== songId);
  await dbPut("playlists", playlist);

  const isStillReferenced = state.playlists.some((item) => item.songIds.includes(songId));
  if (!isStillReferenced) {
    state.songs = state.songs.filter((song) => song.id !== songId);
    await dbDelete("songs", songId);
  }

  if (state.currentSongId === songId) {
    audio.pause();
    state.currentSongId = null;
    releaseObjectUrl();
    await persistSettings();
  }

  render();
  toast(isStillReferenced ? "已从当前歌单移除" : "已从当前歌单删除");
}

async function selectSong(songId, shouldPlay = true) {
  const song = getSong(songId);
  if (!song) return;

  state.currentSongId = songId;
  releaseObjectUrl();
  state.objectUrl = URL.createObjectURL(song.blob);
  audio.src = state.objectUrl;
  audio.load();
  await persistSettings();
  render();

  if (shouldPlay) {
    try {
      await audio.play();
    } catch {
      toast("浏览器需要你再次点击播放。");
    }
  }
}

async function togglePlayPause() {
  if (!state.currentSongId) {
    const firstSong = getActiveSongs()[0] || state.songs[0];
    if (!firstSong) {
      toast("先导入几首本地歌曲。");
      return;
    }
    await selectSong(firstSong.id, true);
    return;
  }

  if (!audio.src) {
    await selectSong(state.currentSongId, false);
  }

  if (audio.paused) {
    try {
      await audio.play();
    } catch {
      toast("浏览器需要你再次点击播放。");
    }
  } else {
    audio.pause();
  }
}

async function playNext() {
  const queue = getActiveSongs();
  if (!queue.length) return;

  const currentIndex = Math.max(0, queue.findIndex((song) => song.id === state.currentSongId));
  const nextSong = queue[(currentIndex + 1) % queue.length];
  await selectSong(nextSong.id, true);
}

async function playPrevious() {
  const queue = getActiveSongs();
  if (!queue.length) return;

  if (audio.currentTime > 3) {
    audio.currentTime = 0;
    return;
  }

  const currentIndex = Math.max(0, queue.findIndex((song) => song.id === state.currentSongId));
  const previousSong = queue[(currentIndex - 1 + queue.length) % queue.length];
  await selectSong(previousSong.id, true);
}

function releaseObjectUrl() {
  if (state.objectUrl) {
    URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = null;
  }
}

async function persistSettings() {
  await dbSetSetting("player", {
    activePlaylistId: state.activePlaylistId,
    currentSongId: state.currentSongId,
    volume: state.volume,
  });
}

function render() {
  renderPlaylists();
  renderTracks();
  updatePlayerUi();
}

function renderPlaylists() {
  els.playlistNav.innerHTML = "";
  const fragment = document.createDocumentFragment();

  for (const playlist of state.playlists) {
    const item = document.createElement("div");
    item.className = `playlist-tab${playlist.id === state.activePlaylistId ? " active" : ""}`;
    item.innerHTML = `
      <button class="playlist-main" type="button">
        <span>
          <strong></strong>
          <span></span>
        </span>
      </button>
      <span class="playlist-actions"></span>
    `;
    item.querySelector("strong").textContent = playlist.name;
    item.querySelector(".playlist-main span span").textContent = `${playlist.songIds.length} 首歌曲`;
    item.querySelector(".playlist-main").addEventListener("click", () => setActivePlaylist(playlist.id));

    const actions = item.querySelector(".playlist-actions");
    actions.append(makeActionButton("✎", "修改歌单名", (event) => {
      event.stopPropagation();
      renamePlaylist(playlist.id);
    }));
    if (playlist.id !== DEFAULT_PLAYLIST_ID) {
      actions.append(makeActionButton("×", "删除歌单", (event) => {
        event.stopPropagation();
        deletePlaylist(playlist.id);
      }, "danger"));
    }

    fragment.append(item);
  }

  els.playlistNav.append(fragment);
}

function renderTracks() {
  const playlist = getActivePlaylist();
  const songs = getActiveSongs();
  els.activePlaylistTitle.textContent = playlist?.name || "我的歌单";
  els.playlistMeta.textContent = songs.length ? `${songs.length} 首歌曲 · 循环播放已开启` : "导入歌曲或切换歌单开始播放";
  els.trackList.innerHTML = "";

  if (!songs.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = `<div><strong>这里还没有歌曲</strong><span>导入本地音乐，或在音乐库里把歌曲加入这个歌单。</span></div>`;
    els.trackList.append(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  songs.forEach((song, index) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = `track-row${song.id === state.currentSongId ? " active" : ""}`;
    row.innerHTML = `
      <span class="track-index"></span>
      <span class="track-title"><span></span><small class="track-subtitle"></small></span>
      <time>--:--</time>
      <span class="track-actions"></span>
    `;
    row.querySelector(".track-index").textContent = String(index + 1);
    row.querySelector(".track-title span").textContent = song.name;
    row.querySelector(".track-subtitle").textContent = readableFileSize(song.size);
    row.querySelector("time").textContent = song.duration ? formatTime(song.duration) : "--:--";
    row.addEventListener("click", () => selectSong(song.id, true));

    const actions = row.querySelector(".track-actions");
    if (state.activePlaylistId !== DEFAULT_PLAYLIST_ID) {
      actions.append(makeActionButton("✎", "修改歌曲名", (event) => {
        event.stopPropagation();
        renameSong(song.id);
      }));
      actions.append(makeActionButton("−", "从歌单移除", (event) => {
        event.stopPropagation();
        removeSongFromPlaylist(song.id);
      }));
    } else {
      actions.append(makePlaylistSelect(song.id));
      actions.append(makeActionButton("✎", "修改歌曲名", (event) => {
        event.stopPropagation();
        renameSong(song.id);
      }));
      actions.append(makeActionButton("×", "从当前歌单删除", (event) => {
        event.stopPropagation();
        removeSongFromPlaylist(song.id);
      }, "danger"));
    }

    fragment.append(row);
  });

  els.trackList.append(fragment);
}

function makeActionButton(text, label, onClick, extraClass = "") {
  const button = document.createElement("button");
  button.className = `small-button ${extraClass}`.trim();
  button.type = "button";
  button.textContent = text;
  button.title = label;
  button.setAttribute("aria-label", label);
  button.addEventListener("click", onClick);
  return button;
}

function makePlaylistSelect(songId) {
  const select = document.createElement("select");
  select.className = "playlist-select";
  select.title = "加入歌单";
  select.setAttribute("aria-label", "加入歌单");
  select.innerHTML = `<option value="">+</option>`;

  for (const playlist of state.playlists.filter((item) => item.id !== DEFAULT_PLAYLIST_ID)) {
    const option = document.createElement("option");
    option.value = playlist.id;
    option.textContent = playlist.name;
    select.append(option);
  }

  select.addEventListener("click", (event) => event.stopPropagation());
  select.addEventListener("change", async (event) => {
    event.stopPropagation();
    if (select.value) {
      await addSongToPlaylist(songId, select.value);
      select.value = "";
    }
  });

  return select;
}

function updatePlayerUi() {
  const song = getSong(state.currentSongId);
  const playlist = getActivePlaylist();
  els.currentSongTitle.textContent = song?.name || "未播放";
  els.currentPlaylistName.textContent = playlist?.name || "选择一首歌曲";
  els.playPauseIcon.textContent = state.isPlaying ? "⏸" : "▶";
  els.playPlaylistIcon.textContent = state.isPlaying ? "⏸" : "▶";

  const hasSongs = state.songs.length > 0;
  els.playPauseButton.disabled = !hasSongs;
  els.playPlaylistButton.disabled = getActiveSongs().length === 0;
  els.previousButton.disabled = getActiveSongs().length === 0;
  els.nextButton.disabled = getActiveSongs().length === 0;
}

function updateProgress() {
  const current = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
  const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
  els.currentTime.textContent = formatTime(current);
  els.durationTime.textContent = formatTime(duration);
  els.progressRange.value = duration ? String((current / duration) * 100) : "0";

  const song = getSong(state.currentSongId);
  if (song && duration && song.duration !== duration) {
    song.duration = duration;
    dbPut("songs", song);
  }
}

function formatTime(seconds) {
  const safeSeconds = Math.max(0, Math.floor(seconds || 0));
  const mins = Math.floor(safeSeconds / 60);
  const secs = String(safeSeconds % 60).padStart(2, "0");
  return `${mins}:${secs}`;
}

function readableFileSize(bytes) {
  if (!bytes) return "本地音频";
  const mb = bytes / 1024 / 1024;
  return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2600);
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {
      toast("离线缓存暂时不可用，请通过本地服务器打开应用。");
    });
  }
}

init().catch((error) => {
  console.error(error);
  toast("应用启动失败，请刷新后重试。");
});
