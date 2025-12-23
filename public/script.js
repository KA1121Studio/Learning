// public/script.js
const socket = io();

// 共通
window.currentRoomId = null;
let selectedImageUrl = null;

// ===== 通話機能 追加 =====
let localStream = null;
const peers = {}; // userName -> RTCPeerConnection
// =========================


// ---------- UI ----------
function showPopup(e) {
  if (e) e.stopPropagation();

  document.getElementById('popup').style.display = 'none';
  document.getElementById('mediaPopup').style.display = 'none';
  document.getElementById('namePopup').style.display = 'none';

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

// ---------- ★ お知らせ読み込み ----------
async function loadNotice() {
  const res = await fetch('/notice');
  const data = await res.json();

  const box = document.getElementById('noticeBox');
  const closeBtn = document.getElementById('closeNoticeBtn');

  if (data?.content) {
    const hidden = localStorage.getItem('noticeHidden') === 'true';
    if (hidden) return;

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

  loadNotice();
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
    ${localStorage.getItem('showTime') !== 'off' ? `
      <div style="font-size:10px; color:#888;">
        ${time ? new Date(time).toLocaleTimeString() : ''}
      </div>
    ` : ''}
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
  return s
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/\n/g,'<br>');
}

// ---------- DOM 初期化 & イベント登録 ----------
window.addEventListener('DOMContentLoaded', () => {

  // ===== 通話ボタン処理 追加 =====
  const callBtn = document.getElementById('callBtn');
  const hangupBtn = document.getElementById('hangupBtn');

  if (callBtn) {
    callBtn.onclick = async () => {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true });

      socket.emit('call-join', {
        roomId: window.currentRoomId,
        user: localStorage.getItem('userName')
      });

      callBtn.style.display = 'none';
      hangupBtn.style.display = 'inline-block';
    };
  }

  if (hangupBtn) {
    hangupBtn.onclick = () => {
      Object.values(peers).forEach(pc => pc.close());
      for (const k in peers) delete peers[k];
      document.getElementById('callAudios').innerHTML = '';
      callBtn.style.display = 'inline-block';
      hangupBtn.style.display = 'none';
    };
  }
  // ===============================

  document.getElementById('saveNameBtn').onclick = () => {
    const name = document.getElementById('nameInput').value.trim();
    if (!name) return alert('名前を入力して');
    localStorage.setItem('userName', name);
    document.getElementById('userNameDisplay').textContent = name;
    document.getElementById('namePopup').style.display = 'none';
  };

  // （以下、既存コードそのまま）
});
 
// ---------- Socket ----------
socket.on('message', data => {
  if (String(data.room_id) !== String(window.currentRoomId)) return;
  appendMessage(data.author, data.text, data.time, data.image);
});

// ===== 通話用 Socket 追加 =====
function createPeer(targetUser) {
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  });

  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

  pc.ontrack = e => {
    const audio = document.createElement('audio');
    audio.srcObject = e.streams[0];
    audio.autoplay = true;
    document.getElementById('callAudios').appendChild(audio);
  };

  pc.onicecandidate = e => {
    if (e.candidate) {
      socket.emit('call-ice', {
        to: targetUser,
        candidate: e.candidate
      });
    }
  };

  peers[targetUser] = pc;
  return pc;
}

socket.on('call-users', async users => {
  for (const u of users) {
    const pc = createPeer(u);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('call-offer', { to: u, offer });
  }
});

socket.on('call-offer', async ({ from, offer }) => {
  const pc = createPeer(from);
  await pc.setRemoteDescription(offer);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit('call-answer', { to: from, answer });
});

socket.on('call-answer', async ({ from, answer }) => {
  await peers[from].setRemoteDescription(answer);
});

socket.on('call-ice', ({ from, candidate }) => {
  peers[from]?.addIceCandidate(candidate);
});
// =============================
