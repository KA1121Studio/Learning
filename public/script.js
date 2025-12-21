// public/script.js
const socket = io();

// 共通
window.currentRoomId = null;
let selectedImageUrl = null;

// ---------- UI ----------
function showPopup(e) {
  if (e) e.stopPropagation();

  // ★ 全ポップアップを必ず閉じる
  document.getElementById('popup').style.display = 'none';
  document.getElementById('mediaPopup').style.display = 'none';
  document.getElementById('namePopup').style.display = 'none';

  // ★ 改めて＋メニューだけ開く
  document.getElementById('popup').style.display = 'flex';
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

// ---------- ★ お知らせ読み込み（追加） ----------
async function loadNotice() {
  const res = await fetch('/notice');
  const data = await res.json();

  const box = document.getElementById('noticeBox');
  const closeBtn = document.getElementById('closeNoticeBtn');

  if (data?.content) {
    box.childNodes[box.childNodes.length - 1].textContent = data.content;
    box.style.display = 'block';

    closeBtn.onclick = () => {
      box.style.display = 'none';
    };
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

  loadNotice();   // ← ★ これだけ追加
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
      right.style.display = 'flex';
      right.style.alignItems = 'center';
      right.style.gap = '8px';

      const time = document.createElement('div');
      time.style.fontSize = '12px';
      time.style.color = '#666';
      time.textContent = new Date(r.created_at).toLocaleString();

      const menuBtn = document.createElement('div');
      menuBtn.textContent = '︙';
      menuBtn.style.cursor = 'pointer';
      menuBtn.style.fontSize = '18px';

      menuBtn.onclick = (e) => {
        e.stopPropagation();
        openRoomSettings(r);
      };

      right.appendChild(time);
      right.appendChild(menuBtn);

      li.appendChild(left);
      li.appendChild(right);
      li.onclick = () => openRoom(r.id);

      ul.appendChild(li);
    });
}

// ---------- ルームを開く ----------
async function openRoom(roomId) {
  closePopup();
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

  document.getElementById('saveNameBtn').onclick = () => {
    const name = document.getElementById('nameInput').value.trim();
    if (!name) return alert('名前を入力して');
    localStorage.setItem('userName', name);
    document.getElementById('userNameDisplay').textContent = name;
    document.getElementById('namePopup').style.display = 'none';
  };



  document.getElementById('addRoomBtn').onclick = showPopup;
  document.getElementById('closePopupBtn').onclick = closePopup;

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

  document.getElementById('backBtn').onclick = () => {
    document.getElementById('chatScreen').style.display = 'none';
    document.getElementById('homeScreen').style.display = 'block';
    window.currentRoomId = null;
    document.getElementById('chatArea').innerHTML = '';
  };

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

// ---------- ルーム設定 ----------
let selectedRoomForSettings = null;

async function openRoomSettings(room) {
  selectedRoomForSettings = room;

  const res = await fetch('/rooms/' + room.id + '/members');
  const members = await res.json();

  const box = document.getElementById('roomSettingsInfo');
  box.innerHTML = `
    <div><strong>ルーム名：</strong>${room.name}</div>
    <div><strong>作成者：</strong>${room.creator || '-'}</div>
    <div style="margin-top:8px;"><strong>メンバー：</strong></div>
    <ul>
      ${members.map(m => `<li>${m.user}</li>`).join('')}
    </ul>
  `;

  document.getElementById('roomSettingsPopup').style.display = 'flex';
}

function closeRoomSettings() {
  document.getElementById('roomSettingsPopup').style.display = 'none';
}

document.getElementById('leaveRoomFromSettings').onclick = async () => {
  if (!selectedRoomForSettings) return;

  const ok = confirm('本当にこのルームから退会する？');
  if (!ok) return;

  const user = localStorage.getItem('userName') || '名無し';

  await fetch('/rooms/' + selectedRoomForSettings.id + '/leave', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user })
  });

  const key = 'joinedRooms';
  const rooms = JSON.parse(localStorage.getItem(key) || '[]')
    .filter(id => id !== String(selectedRoomForSettings.id));
  localStorage.setItem(key, JSON.stringify(rooms));

  closeRoomSettings();
  loadRooms();
};

// ---------- 設定 ----------
const userSettingsPopup = document.getElementById('userSettingsPopup');

document.getElementById('settingsBtn').onclick = () => {
  userSettingsPopup.style.display = 'flex';

  darkModeToggle.checked = localStorage.getItem('darkMode') === 'on';
  noticeToggle.checked = localStorage.getItem('noticeHidden') !== 'true';
  enterSendToggle.checked = localStorage.getItem('enterSend') !== 'off';
  timeToggle.checked = localStorage.getItem('showTime') !== 'off';

  themeColorPicker.value = localStorage.getItem('themeColor') || '#2196f3';
  fontSizeRange.value = localStorage.getItem('fontSize') || 14;
};

function closeUserSettings() {
  userSettingsPopup.style.display = 'none';
}

// ダークモード
darkModeToggle.onchange = e => {
  localStorage.setItem('darkMode', e.target.checked ? 'on' : 'off');
  document.body.style.background = e.target.checked ? '#111' : '';
  document.body.style.color = e.target.checked ? '#eee' : '';
};

// お知らせ
noticeToggle.onchange = e =>
  localStorage.setItem('noticeHidden', e.target.checked ? 'false' : 'true');

// Enter送信
enterSendToggle.onchange = e =>
  localStorage.setItem('enterSend', e.target.checked ? 'on' : 'off');

// 時刻
timeToggle.onchange = e =>
  localStorage.setItem('showTime', e.target.checked ? 'on' : 'off');

// テーマカラー
themeColorPicker.oninput = e =>
  document.documentElement.style.setProperty('--theme', e.target.value);

// フォントサイズ
fontSizeRange.oninput = e =>
  document.body.style.fontSize = e.target.value + 'px';

// 名前変更
changeNameBtn.onclick = () => {
  const now = localStorage.getItem('userName') || '';
  const name = prompt('新しい名前', now);
  if (!name) return;
  localStorage.setItem('userName', name);
  userNameDisplay.textContent = name;
};

// ---------- 利用規約 ----------
function checkTerms() {
  if (localStorage.getItem('termsAgreed') !== 'true')
    termsPopup.style.display = 'flex';
}

agreeTermsBtn.onclick = () => {
  localStorage.setItem('termsAgreed', 'true');
  termsPopup.style.display = 'none';
};

// ---------- プライバシーポリシー ----------
function checkPrivacy() {
  if (localStorage.getItem('privacyAgreed') !== 'true')
    privacyPopup.style.display = 'flex';
}

agreePrivacyBtn.onclick = () => {
  localStorage.setItem('privacyAgreed', 'true');
  privacyPopup.style.display = 'none';
};

openTermsBtn.onclick = () => termsPopup.style.display = 'flex';
openPrivacyBtn.onclick = () => privacyPopup.style.display = 'flex';

// ---------- 初期反映 ----------
window.addEventListener('load', () => {
  if (localStorage.getItem('darkMode') === 'on') {
    document.body.style.background = '#111';
    document.body.style.color = '#eee';
  }
  document.body.style.fontSize =
    (localStorage.getItem('fontSize') || 14) + 'px';

  checkTerms();
  checkPrivacy();
});

if ('Notification' in window) {
  if (Notification.permission === 'default') {
    Notification.requestPermission();
  }
}
