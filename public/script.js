// public/script.js
// クライアントサイド全機能（ルーム一覧 / 作成・参加 / 名前管理 / ワンページチャット / Socket.io）
const socket = io();

// 共通
window.currentRoomId = null;

// ---------- UI 初期化 ----------
function showPopup() { document.getElementById('popup').style.display = 'flex'; }
function closePopup() { document.getElementById('popup').style.display = 'none'; }

// ---------- 名前管理 ----------
window.addEventListener('load', () => {
  const user = localStorage.getItem('userName');
  if (!user) {
    document.getElementById('namePopup').style.display = 'flex';
  } else {
    document.getElementById('userNameDisplay').textContent = user;
  }

  // ルーム読み込み
  loadRooms();
});

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

// ---------- ルーム読み込み ----------
// ---------- ルーム読み込み ----------
async function loadRooms() {
  const res = await fetch('/rooms');
  const rooms = await res.json();
  const ul = document.getElementById('roomList');
  ul.innerHTML = '';

  // ★ 追加（ユーザーの部屋だけ抽出）
  const user = localStorage.getItem('userName');
  const myRooms = rooms.filter(r => r.members?.includes(user));

  // ★ 元の rooms.forEach → myRooms.forEach に変更
  myRooms.forEach(r => {
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

// ---------- プラスボタンとメニュー ----------
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
  if (data && data.room) {
    document.getElementById('roomCodeDisplay').style.display = 'block';
    document.getElementById('roomCodeDisplay').innerHTML = 'ルームコード: <strong>' + data.room.id + '</strong>';
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
  closePopup();
  openRoom(room.id);
};

// ---------- ルームを開く（ホーム -> チャット） ----------
async function openRoom(roomId) {

  // 👇 ここに追加（ユーザー名を送る）
  await fetch('/rooms/' + roomId + '/join', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: localStorage.getItem('userName') })
  });

  // ルーム取得
  const res = await fetch('/rooms');
  const rooms = await res.json();
  const room = rooms.find(r => Number(r.id) === Number(roomId));
  if (!room) return alert('ルームがありません');

  // UI 切替
  document.getElementById('homeScreen').style.display = 'none';
  document.getElementById('chatScreen').style.display = 'block';
  document.getElementById('roomTitle').textContent = room.name;
  document.getElementById('roomTitle').dataset.id = room.id;
  document.getElementById('roomInfo').textContent = '作成者: ' + (room.creator || '-');

  window.currentRoomId = String(room.id);

  // join room（socket）
  socket.emit('joinRoom', String(room.id));

  // チャット読み込み（過去ログ）
  await loadChat(room.id);
}

// ---------- チャット読み込み（REST で過去メッセージ取得） ----------
async function loadChat(roomId) {
  const res = await fetch('/rooms/' + roomId + '/messages');
  const messages = await res.json();
  const chatArea = document.getElementById('chatArea');
  chatArea.innerHTML = '';

  messages.forEach(m => appendMessage(m.author, m.text, m.time));
  chatArea.scrollTop = chatArea.scrollHeight;
}

// ---------- メッセージ追加（UI） ----------
function appendMessage(author, text, time) {
  const chatArea = document.getElementById('chatArea');
  const wrapper = document.createElement('div');
  const name = localStorage.getItem('userName') || '名無し';
  const isMe = author === name;

  const bubble = document.createElement('div');
  bubble.className = 'bubble ' + (isMe ? 'right' : 'left');
  bubble.innerHTML = `<div style="font-size:12px; color:#444; margin-bottom:4px;">${author}</div>
                      <div>${escapeHtml(text)}</div>
                      <div style="font-size:10px; color:#888; margin-top:6px;">${time ? new Date(time).toLocaleTimeString() : ''}</div>`;

  // align wrapper
  wrapper.style.display = 'flex';
  wrapper.style.justifyContent = isMe ? 'flex-end' : 'flex-start';
  wrapper.appendChild(bubble);
  chatArea.appendChild(wrapper);

  chatArea.scrollTop = chatArea.scrollHeight;
}

// 簡易エスケープ
function escapeHtml(s) {
  if (!s) return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ---------- 送信（Socket.io） ----------
document.getElementById('sendBtn').onclick = () => {
  const textInput = document.getElementById('chatInput');
  const text = textInput.value.trim();
  if (!text) return;
  const author = localStorage.getItem('userName') || '名無し';
  const roomId = window.currentRoomId;
  if (!roomId) return alert('ルームが選択されていない');

  socket.emit('message', { roomId, author, text });
  textInput.value = '';
};

// Enter キーで送信
document.getElementById('chatInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    document.getElementById('sendBtn').click();
  }
});

// ---------- Socket.io 受信 ----------
socket.on('message', (data) => {
  // data: { roomId, author, text, time }
  if (!window.currentRoomId) return;
  if (String(data.roomId) !== String(window.currentRoomId)) return;
  appendMessage(data.author, data.text, data.time);
});
