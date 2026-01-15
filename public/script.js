// public/script.js
const socket = io();

// 共通
window.currentRoomId = null;
let selectedImageUrl = null;

/* ===== 通話用（追加） ===== */
const peers = {};     // { socketId: RTCPeerConnection }
let localStream = null;
let isCalling = false;           // 通話中フラグ
window.pendingCallUsers = [];    // ルーム内の他ソケットID（通話開始待ち）

// 着信情報
let incomingCallFrom = null;
let lastReceivedOffer = null;
/* ======================== */

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
    const hidden = localStorage.getItem('noticeHidden') === 'true';
    if (hidden) return;

    box.childNodes[box.childNodes.length - 1].textContent = data.content;
    box.style.display = 'block';

    closeBtn.onclick = () => {
      box.style.display = 'none';
      // ユーザーが閉じたら localStorage に反映する（元の挙動に合わせる）
      localStorage.setItem('noticeHidden', 'true');
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
    .replace(/\n/g,'<br>');  // ← 改行を <br> に変換
}

/* ============================
   WebRTC / 複数人通話ロジック
   ============================ */

async function ensureLocalStream() {
  if (localStream) return localStream;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // 画面上に簡単にローカル状態を示す（任意）
    return localStream;
  } catch (err) {
    console.error('マイクが使えない', err);
    alert('マイクの利用を許可して');
    throw err;
  }
}

function createAudioElementForPeer(peerId) {
  // 既にあるならそれを返す
  const existing = document.getElementById('audio_' + peerId);
  if (existing) return existing;

  const audio = document.createElement('audio');
  audio.id = 'audio_' + peerId;
  audio.autoplay = true;
  audio.controls = false;
  // chatArea の外に置く（影響少なく）
  document.body.appendChild(audio);
  return audio;
}

async function createPeer(remoteSocketId, isCaller) {
  if (peers[remoteSocketId]) {
    // 既にあるなら新規作成しない
    return peers[remoteSocketId];
  }

  await ensureLocalStream();

  const pc = new RTCPeerConnection();

  // Add local audio tracks
  if (localStream) {
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  }

  // ICE candidate を集めて相手に送る
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('ice-candidate', {
        to: remoteSocketId,
        candidate: event.candidate
      });
    }
  };

  // リモートのトラックを受け取る
  pc.ontrack = (event) => {
    const stream = event.streams && event.streams[0];
    if (!stream) return;
    const audioEl = createAudioElementForPeer(remoteSocketId);
    audioEl.srcObject = stream;
  };

  peers[remoteSocketId] = pc;

  if (isCaller) {
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('call-offer', {
        to: remoteSocketId,
        offer
      });
    } catch (err) {
      console.error('Offer作成失敗', err);
    }
  }

  return pc;
}

/* ============================
   イベント：DOMContentLoaded 内でボタン等に接続
   ============================ */
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
    const enterSend = localStorage.getItem('enterSend') !== 'off';

    if (e.key === 'Enter') {
      if (e.ctrlKey) return; // Ctrl+Enter なら改行する
      if (enterSend) {
        e.preventDefault(); // Enterだけなら送信
        document.getElementById('sendBtn').click();
      }
    }
  });


  
  document.getElementById('backBtn').onclick = () => {
    document.getElementById('chatScreen').style.display = 'none';
    document.getElementById('homeScreen').style.display = 'block';
    window.currentRoomId = null;
    document.getElementById('chatArea').innerHTML = '';
    // ルームから離れるときに通話停止（安全策）
    if (isCalling) {
      // mimic endCallBtn behavior
      isCalling = false;

      Object.values(peers).forEach(p => {
        try { p.close(); } catch (e) {}
      });
      Object.keys(peers).forEach(k => delete peers[k]);

      if (localStream) {
        try {
          localStream.getTracks().forEach(t => t.stop());
        } catch (e) {}
        localStream = null;
      }

      document.querySelectorAll('audio[id^="audio_"]').forEach(a => a.remove());

      const callBtnEl = document.getElementById('callBtn');
      const endCallBtnEl = document.getElementById('endCallBtn');
      if (callBtnEl) callBtnEl.style.display = 'inline';
      if (endCallBtnEl) endCallBtnEl.style.display = 'none';
    }

    // 着信情報もクリアしておく
    incomingCallFrom = null;
    lastReceivedOffer = null;
    window.pendingCallUsers = [];
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

  // 通話ボタン（index.html に追加済みが前提）
  const callBtn = document.getElementById('callBtn');
callBtn.onclick = () => {
  document.getElementById('chatScreen').style.display = 'none';
  document.getElementById('callScreen').style.display = 'block';

  // ルーム名を反映
  document.getElementById('callRoomTitle').textContent =
    document.getElementById('roomTitle').textContent;

  // メンバーを表示
  fetch('/rooms/' + window.currentRoomId + '/members')
    .then(r => r.json())
    .then(members => {
      const ul = document.getElementById('callMembersList');
      ul.innerHTML = members.map(m => `<li>${m.user}</li>`).join('');
    });
};

  
  const endCallBtn = document.getElementById('endCallBtn');

  if (callBtn) {
    callBtn.onclick = async () => {
      if (isCalling) return;

      try {
        isCalling = true;
        await ensureLocalStream();

        // 発信（すでにルームにいるユーザーへ）
        (window.pendingCallUsers || []).forEach(userId => {
          try {
            // 自分自身は skip
            if (userId === socket.id) return;
            createPeer(userId, true);
          } catch (e) {
            console.error('peer create error for', userId, e);
          }
        });

        // 着信があればそれに応答する（最後に受けた offer を使用）
        if (incomingCallFrom && lastReceivedOffer) {
          try {
            const from = incomingCallFrom;
            // 受信側として Peer を作成（これ内部で ensureLocalStream を呼ぶが既に取得済）
            await createPeer(from, false);

            const pc = peers[from];
            if (pc) {
              await pc.setRemoteDescription(lastReceivedOffer);
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);

              socket.emit('call-answer', {
                to: from,
                answer
              });
            }
          } catch (e) {
            console.error('着信への応答に失敗', e);
          } finally {
            incomingCallFrom = null;
            lastReceivedOffer = null;
          }
        }

        // UI 切替
        callBtn.style.display = 'none';
        if (endCallBtn) endCallBtn.style.display = 'inline';
      } catch (e) {
        console.error('通話開始失敗', e);
        isCalling = false;
      }
    };
  }

  if (endCallBtn) {
    endCallBtn.onclick = () => {
      isCalling = false;

      Object.values(peers).forEach(p => {
        try { p.close(); } catch (e) {}
      });
      Object.keys(peers).forEach(k => delete peers[k]);

      if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
        localStream = null;
      }

      // audio エレメントを片付ける（確実に消す）
      document.querySelectorAll('audio[id^="audio_"]').forEach(a => {
        if (a && a.parentNode) a.parentNode.removeChild(a);
      });

      // pending と着信情報をクリア（再度通話するときに再度取得される）
      window.pendingCallUsers = [];
      incomingCallFrom = null;
      lastReceivedOffer = null;

      if (callBtn) callBtn.style.display = 'inline';
      endCallBtn.style.display = 'none';
    };
  }
});

// ---------- Socket ----------
socket.on('message', data => {
  if (String(data.room_id) !== String(window.currentRoomId)) return;
  appendMessage(data.author, data.text, data.time, data.image);
});

/* ===== Socket.io シグナリング受信処理（追加） ===== */

// サーバーが joinRoom に対して送る「ルーム内の他のソケットIDリスト」
socket.on('room-users', (users) => {
  // users は socket.id の配列を想定
  if (!users || !Array.isArray(users)) return;

  // 既存 peers を差し引いて未接続のもののみ扱う
  const unknown = users.filter(id => !peers[id] && id !== socket.id);

  // 通話中なら即接続（caller として）
  if (isCalling) {
    unknown.forEach(userId => {
      try {
        if (userId === socket.id) return;
        createPeer(userId, true);
      } catch (e) {
        console.error('room-users createPeer error', e);
      }
    });
    // pending は更新しておく
    window.pendingCallUsers = users;
    return;
  }

  // 通話していない場合は接続しないで pending に保存しておく
  window.pendingCallUsers = users;
});

// 他からの offer を受け取る
socket.on('call-offer', async (data) => {
  try {
    const from = data.from || data.socketId || data.sender;
    const offer = data.offer;
    if (!from || !offer) return;

    // もし自分がすでに通話中なら自動で応答（既にマイク取得済のはず）
    if (isCalling) {
      try {
        await createPeer(from, false);

        const pc = peers[from];
        if (!pc) return;
        await pc.setRemoteDescription(offer);

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        socket.emit('call-answer', {
          to: from,
          answer
        });
      } catch (e) {
        console.error('自動応答エラー', e);
      }
      return;
    }

    // 通話していない場合は「着信状態」として保存するだけにする（勝手にマイクONしない）
    incomingCallFrom = from;
    lastReceivedOffer = offer;

    console.log('着信: ', from);
    // 必要ならここで UI に「着信中」を表示する実装を追加する
  } catch (err) {
    console.error('call-offer 処理エラー', err);
  }
});

// 他からの answer を受け取る
socket.on('call-answer', async (data) => {
  try {
    const from = data.from || data.socketId || data.sender;
    const answer = data.answer;
    if (!from || !answer) return;

    const pc = peers[from];
    if (!pc) return;
    await pc.setRemoteDescription(answer);
  } catch (err) {
    console.error('call-answer 処理エラー', err);
  }
});

// ICE candidate を受け取る
socket.on('ice-candidate', async (data) => {
  try {
    const from = data.from || data.socketId || data.sender;
    const candidate = data.candidate;
    if (!from || !candidate) return;

    const pc = peers[from];
    if (!pc) return;
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  } catch (err) {
    console.error('ice-candidate 処理エラー', err);
  }
});

/* ================================================== */

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
// テーマカラー
themeColorPicker.oninput = e => {
  const color = e.target.value;
  document.documentElement.style.setProperty('--theme', color);
  localStorage.setItem('themeColor', color);
};

// フォントサイズ
// フォントサイズ
fontSizeRange.oninput = e => {
  const size = e.target.value;
  document.body.style.fontSize = size + 'px';
  localStorage.setItem('fontSize', size);
};

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

  // ★ テーマカラー復元
  const theme = localStorage.getItem('themeColor');
  if (theme) {
    document.documentElement.style.setProperty('--theme', theme);
  }

  checkTerms();
  checkPrivacy();
});


if ('Notification' in window) {
  if (Notification.permission === 'default') {
    Notification.requestPermission();
  }
}


document.getElementById('startCallBtn').onclick = async () => {
  document.getElementById('callStatusText').textContent = '通話中…';
  document.getElementById('startCallBtn').style.display = 'none';
  document.getElementById('stopCallBtn').style.display = 'inline';

  // ★ ここで“本物の通話開始”を呼ぶ
  await ensureLocalStream();

  (window.pendingCallUsers || []).forEach(userId => {
    if (userId !== socket.id) {
      createPeer(userId, true);
    }
  });

  isCalling = true;
};


document.getElementById('stopCallBtn').onclick = () => {
  isCalling = false;

  Object.values(peers).forEach(p => p.close());
  Object.keys(peers).forEach(k => delete peers[k]);

  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }

  document.querySelectorAll('audio[id^="audio_"]').forEach(a => a.remove());

  // 画面を戻す
  document.getElementById('callScreen').style.display = 'none';
  document.getElementById('chatScreen').style.display = 'block';
};
