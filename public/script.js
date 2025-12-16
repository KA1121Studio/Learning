// public/script.js
const socket = io();

// 共通
window.currentRoomId = null;
let selectedImageUrl = null;

// ---------- UI ----------
function showPopup(e) {
  if (e) e.stopPropagation();
  const popup = document.getElementById('popup');
  if (popup) popup.style.display = 'flex';
}
function closePopup() {
  const popup = document.getElementById('popup');
  if (popup) popup.style.display = 'none';
}

// ---------- 参加ルーム保存 ----------
function saveJoinedRoom(roomId) {
  const key = 'joinedRooms';
  const rooms = JSON.parse(localStorage.getItem(key) || '[]');
  if (!rooms.includes(String(roomId))) {
    rooms.push(String(roomId));
    localStorage.setItem(key, JSON.stringify(rooms));
  }
}

// ---------- 名前管理 ----------
window.addEventListener('load', () => {
  const user = localStorage.getItem('userName');
  if (!user) {
    document.getElementById('namePopup').style.display = 'flex';
  } else {
    document.getElementById('userNameDisplay').textContent = user;
  }
  loadRooms();
});

// ---------- ルーム読み込み ----------
async function loadRooms() {
  const res = await fetch('/rooms');
  const rooms = await res.json();

  const joined = JSON.parse(localStorage.getItem('joinedRooms') || '[]');
  const ul = document.getElementById('roomList');
  ul.innerHTML = '';

  rooms
    .filter(r => joined.includes(String(r.id)))
    .forEach(r => {
      const li = document.createElement('li');

      const left = document.createElement('div');
      left.textContent = r.name + ' (' + r.id + ')';

      const right = document.createElement('div');
      right.style.fontSize = '12px';
      right.style.color = '#666';
      right.textContent = new Date(r.created_at).toLocaleString();

      li.appendChild(left);
      li.appendChild(right);
      li.onclick = () => openRoom(r.id);
      ul.appendChild(li);
    });
}

// ---------- ルームを開く ----------
async function openRoom(roomId) {
  saveJoinedRoom(roomId);

  await fetch('/rooms/' + roomId + '/join', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: localStorage.getItem('userName') })
  });

  const res = await fetch('/rooms');
  const rooms = await res.json();
  const room = rooms.find(r => Number(r.id) === Number(roomId));
  if (!room) return alert('ルームがありません');

  document.getElementById('homeScreen').style.display = 'none';
  document.getElementById('chatScreen').style.display = 'block';
  document.getElementById('roomTitle').textContent = room.name;
  document.getElementById('roomInfo').textContent =
    '作成者: ' + (room.creator || '-');

  window.currentRoomId = String(room.id);
  socket.emit('joinRoom', String(room.id));
  await loadChat(room.id);
}

// ---------- チャット ----------
async function loadChat(roomId) {
  const res = await fetch('/rooms/' + roomId + '/messages');
  const messages = await res.json();
  const chatArea = document.getElementById('chatArea');
  chatArea.innerHTML = '';
  messages.forEach(m => appendMessage(m.author, m.text, m.time, m.image));
  chatArea.scrollTop = chatArea.scrollHeight;
}

function appendMessage(author, text, time, image) {
  const chatArea = document.getElementById('chatArea');
  const name = localStorage.getItem('userName') || '名無し';
  const isMe = author === name;

  const bubble = document.createElement('div');
  bubble.className = 'bubble ' + (isMe ? 'right' : 'left');
  bubble.innerHTML = `
    <div style="font-size:12px; color:#444;">${author}</div>
    ${text ? `<div>${escapeHtml(text)}</div>` : ''}
    ${image ? `<img src="${image}" style="max-width:200px; border-radius:8px; margin-top:6px;">` : ''}
    <div style="font-size:10px; color:#888;">
      ${time ? new Date(time).toLocaleTimeString() : ''}
    </div>
  `;

  const wrapper = document.createElement('div');
  wrapper.style.display = 'flex';
  wrapper.style.justifyContent = isMe ? 'flex-end' : 'flex-start';
  wrapper.appendChild(bubble);
  chatArea.appendChild(wrapper);
  chatArea.scrollTop = chatArea.scrollHeight;
}

function escapeHtml(s) {
  if (!s) return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ---------- DOM 初期化 & イベント登録 ----------
window.addEventListener('DOMContentLoaded', () => {

  // 名前
  document.getElementById('saveNameBtn').onclick = () => {
    const name = document.getElementById('nameInput').value.trim();
    if (!name) return alert('名前を入力して');
    localStorage.setItem('userName', name);
    document.getElementById('userNameDisplay').textContent = name;
    document.getElementById('namePopup').style.display = 'none';
  };

  document.getElementById('settingsBtn').onclick = () => {
    const now = localStorage.getItem('userName') || '';
    const newName = prompt('新しい名前を入力', now);
    if (!newName) return;
    localStorage.setItem('userName', newName);
    document.getElementById('userNameDisplay').textContent = newName;
  };

  // ＋メニュー ← ★ここが一番重要
  document.getElementById('addRoomBtn').onclick = showPopup;
  document.getElementById('closePopupBtn').onclick = closePopup;

  // ルーム作成
  document.getElementById('btnCreateRoom').onclick = async () => {
    const name = prompt('ルーム名を入力してください');
    if (!name) return;

    const creator = localStorage.getItem('userName') || '名無し';
    const res = await fetch('/rooms', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ name, creator })
    });

    const data = await res.json();
    if (data?.room) {
      saveJoinedRoom(data.room.id);
      document.getElementById('roomCodeDisplay').style.display = 'block';
      document.getElementById('roomCodeDisplay').innerHTML =
        'ルームコード: <strong>' + data.room.id + '</strong>';
    }

    closePopup();
    loadRooms();
  };

  // ルーム参加
  document.getElementById('btnJoinRoom').onclick = async () => {
    const code = prompt('ルームコードを入力してください');
    if (!code) return;

    const res = await fetch('/rooms');
    const rooms = await res.json();
    const room = rooms.find(r => String(r.id) === String(code));
    if (!room) return alert('ルームが見つかりません');

    saveJoinedRoom(room.id);
    closePopup();
    openRoom(room.id);
  };

  // 送信
  document.getElementById('sendBtn').onclick = () => {
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text && !selectedImageUrl) return;

    socket.emit('message', {
      roomId: window.currentRoomId,
      author: localStorage.getItem('userName') || '名無し',
      text,
      image: selectedImageUrl
    });

    input.value = '';
    selectedImageUrl = null;
  };

  document.getElementById('chatInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.getElementById('sendBtn').click();
    }
  });

  // 戻る
  document.getElementById('backBtn').onclick = () => {
    document.getElementById('chatScreen').style.display = 'none';
    document.getElementById('homeScreen').style.display = 'block';
    window.currentRoomId = null;
    document.getElementById('chatArea').innerHTML = '';
  };

  // メディア
  const mediaBtn = document.getElementById('mediaBtn');
  const mediaPopup = document.getElementById('mediaPopup');
  const closeMediaBtn = document.getElementById('closeMediaBtn');
  const imageUrlInput = document.getElementById('imageUrlInput');
  const imagePreview = document.getElementById('imagePreview');

  mediaBtn.onclick = () => mediaPopup.style.display = 'flex';
  closeMediaBtn.onclick = () => mediaPopup.style.display = 'none';
  imageUrlInput.oninput = () => {
    const url = imageUrlInput.value.trim();
    if (!url) {
      imagePreview.style.display = 'none';
      selectedImageUrl = null;
      return;
    }
    imagePreview.src = url;
    imagePreview.style.display = 'block';
    selectedImageUrl = url;
  };
});

// ---------- Socket ----------
socket.on('message', data => {
  if (String(data.room_id) !== String(window.currentRoomId)) return;
  appendMessage(data.author, data.text, data.time, data.image);
});
