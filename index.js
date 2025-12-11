// index.js
const express = require('express');
const bodyParser = require('body-parser');
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');

const app = express();
const port = process.env.PORT || 3000;

// lowdb セットアップ
const adapter = new JSONFile('db.json');
const db = new Low(adapter);

async function initDB(){
  await db.read();
  db.data ||= { posts: [], users: [{ id:1, username:'admin', password:'admin123', role:'admin' }], rooms: [] };
  await db.write();
}
initDB();

app.use(bodyParser.json());
app.use(express.static('public'));

// -------------------- 投稿・コメント API --------------------

// 投稿一覧
app.get('/posts', async (req,res)=>{
  await db.read();
  const category = req.query.category;
  let posts = db.data.posts;
  if(category) posts = posts.filter(p=>p.category===category);
  res.json(posts);
});

// 投稿作成
app.post('/posts', async (req,res)=>{
  const { title, author, content, category } = req.body;
  await db.read();
  db.data.posts.push({
    id: Date.now(),
    title, author, content, category,
    comments: [],
    likes:0,
    solved:false,
    created_at:new Date().toISOString()
  });
  await db.write();
  res.json({ success:true });
});

// コメント作成
app.post('/posts/:postId/comments', async (req,res)=>{
  const postId = Number(req.params.postId);
  const { author, content } = req.body;
  await db.read();
  const post = db.data.posts.find(p=>p.id===postId);
  if(!post) return res.status(404).json({ error:'投稿が見つかりません' });
  post.comments.push({ id: Date.now(), author, content });
  await db.write();
  res.json({ success:true });
});

// -------------------- 管理者ログイン・ユーザー管理 --------------------

// 管理者ログイン
app.post('/kanri/login', async (req,res)=>{
  const { username, password } = req.body;
  await db.read();
  const user = db.data.users.find(u=>u.username===username && u.password===password && u.role==='admin');
  if(!user) return res.status(403).json({ error:'ログイン失敗' });
  res.json({ success:true, userId:user.id });
});

// 新規ユーザー作成
app.post('/kanri/create-user', async (req,res)=>{
  const { username, password, role, adminId } = req.body;
  await db.read();
  const admin = db.data.users.find(u=>u.id==adminId);
  if(!admin || admin.role!=='admin') return res.status(403).json({ error:'アクセス拒否' });

  const newUser = { id:Date.now(), username, password, role };
  db.data.users.push(newUser);
  await db.write();
  res.json({ success:true, user:newUser });
});

// ユーザー一覧
app.get('/kanri/users', async (req,res)=>{
  const { userId } = req.query;
  await db.read();
  const admin = db.data.users.find(u=>u.id==userId);
  if(!admin || admin.role!=='admin') return res.status(403).send('アクセス拒否');

  res.json(db.data.users);
});

// ユーザー削除
app.post('/kanri/delete-user/:targetId', async (req,res)=>{
  const { userId } = req.query;
  await db.read();
  const admin = db.data.users.find(u=>u.id==userId);
  if(!admin || admin.role!=='admin') return res.status(403).send('アクセス拒否');

  const targetId = Number(req.params.targetId);
  db.data.users = db.data.users.filter(u=>u.id!==targetId);
  await db.write();
  res.send('ok');
});

// 権限変更
app.post('/kanri/update-role/:targetId', async (req,res)=>{
  const { userId, newRole } = req.body;
  await db.read();
  const admin = db.data.users.find(u=>u.id==userId);
  if(!admin || admin.role!=='admin') return res.status(403).send('アクセス拒否');

  const targetId = Number(req.params.targetId);
  const user = db.data.users.find(u=>u.id===targetId);
  if(user){
    user.role = newRole;
    await db.write();
  }
  res.json({ success:true, user });
});

// -------------------- ルームAPI / メッセージ --------------------

// ルーム一覧
app.get('/rooms', async (req, res) => {
  await db.read();
  res.json(db.data.rooms);
});

// ルーム作成
app.post('/rooms', async (req, res) => {
  const { name, creator } = req.body;
  await db.read();

  const room = {
    id: Date.now(),
    name,
    creator,
    created_at: new Date().toISOString(),
    messages: []
  };

  db.data.rooms.push(room);
  await db.write();

  res.json({ success: true, room });
});

// ルームごとのメッセージ取得
app.get('/rooms/:roomId/messages', async (req, res) => {
  await db.read();
  const roomId = Number(req.params.roomId);
  const room = db.data.rooms.find(r => r.id === roomId);
  if (!room) return res.json([]);
  room.messages ||= [];
  res.json(room.messages);
});

// ルームへメッセージ追加（RESTフォールバック）
app.post('/rooms/:roomId/messages', async (req, res) => {
  await db.read();
  const roomId = Number(req.params.roomId);
  const room = db.data.rooms.find(r => r.id === roomId);
  if (!room) return res.status(404).json({error:"no room"});

  room.messages ||= [];
  room.messages.push({
    id: Date.now(),
    author: req.body.author,
    text: req.body.text,
    time: new Date().toISOString()
  });

  await db.write();
  res.json({success:true});
});

// -------------------- 投稿・コメント管理（adminのみ） --------------------
app.get('/kanri/data', async (req,res)=>{
  const { userId } = req.query;
  await db.read();
  const user = db.data.users.find(u=>u.id==userId);
  if(!user || user.role!=='admin') return res.status(403).send('アクセス拒否');
  res.json(db.data.posts);
});

app.post('/kanri/delete-post/:postId', async (req,res)=>{
  const { userId } = req.query;
  await db.read();
  const user = db.data.users.find(u=>u.id==userId);
  if(!user || user.role!=='admin') return res.status(403).send('アクセス拒否');

  const postId = Number(req.params.postId);
  db.data.posts = db.data.posts.filter(p=>p.id!==postId);
  await db.write();
  res.send('ok');
});

app.post('/kanri/delete-comment/:postId/:commentId', async (req,res)=>{
  const { userId } = req.query;
  await db.read();
  const user = db.data.users.find(u=>u.id==userId);
  if(!user || user.role!=='admin') return res.status(403).send('アクセス拒否');

  const postId = Number(req.params.postId);
  const commentId = Number(req.params.commentId);
  const post = db.data.posts.find(p=>p.id===postId);
  if(post){
    post.comments = post.comments.filter(c=>c.id!==commentId);
    await db.write();
  }
  res.send('ok');
});

// -------------------- 管理画面 HTML --------------------
app.get('/kanri', (req,res)=>{
  const html = `
  <!DOCTYPE html>
  <html>
  <head>
    <title>管理画面</title>
    <style>
      body { font-family: Arial; padding: 20px; }
      .hidden { display:none; }
      .post { border:1px solid #ccc; padding:10px; margin-bottom:10px; border-radius:5px; }
      .comment { margin-left:20px; }
      button { margin-left:5px; }
    </style>
  </head>
  <body>
    <h1>管理画面</h1>

    <div id="loginSection">
      <h3>管理者ログイン</h3>
      <input id="username" placeholder="ユーザー名">
      <input id="password" placeholder="パスワード" type="password">
      <button onclick="login()">ログイン</button>
    </div>

    <div id="adminSection" class="hidden">
      <h3>ユーザー作成</h3>
      <input id="newUsername" placeholder="ユーザー名">
      <input id="newPassword" placeholder="パスワード" type="password">
      <select id="newRole">
        <option value="admin">管理者</option>
        <option value="user">一般</option>
      </select>
      <button onclick="createUser()">作成</button>

      <h3>ユーザー一覧</h3>
      <div id="usersContainer">読み込み中…</div>

      <h3>投稿管理</h3>
      <div id="postsContainer">読み込み中…</div>
    </div>

    <script>
    let adminId = null;

    async function login() {
      const username = document.getElementById('username').value;
      const password = document.getElementById('password').value;

      const res = await fetch('/kanri/login', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ username, password })
      });
      const data = await res.json();
      if(!data.success){ alert('ログイン失敗'); return; }
      adminId = data.userId;
      document.getElementById('loginSection').classList.add('hidden');
      document.getElementById('adminSection').classList.remove('hidden');
      loadUsers();
      loadPosts();
    }

    async function createUser() {
      const username = document.getElementById('newUsername').value;
      const password = document.getElementById('newPassword').value;
      const role = document.getElementById('newRole').value;

      const res = await fetch('/kanri/create-user', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ username, password, role, adminId })
      });
      const data = await res.json();
      if(data.success) alert('ユーザー作成成功: ' + data.user.username);
      loadUsers();
    }

    async function loadUsers() {
      const res = await fetch('/kanri/users?userId=' + adminId);
      const users = await res.json();
      const container = document.getElementById('usersContainer');
      container.innerHTML = '';

      users.forEach(u=>{
        const div = document.createElement('div');
        div.style.border='1px solid #ccc'; div.style.margin='3px'; div.style.padding='3px';
        div.innerHTML = \`
          ID: ${u.id} | ${u.username} | 権限: 
          <select id="role-${u.id}">
            <option value="admin" ${u.role==='admin'?'selected':''}>admin</option>
            <option value="user" ${u.role==='user'?'selected':''}>user</option>
          </select>
          <button onclick="updateRole(${u.id})">変更</button>
          <button onclick="deleteUser(${u.id})">削除</button>
        \`;
        container.appendChild(div);
      });
    }

    async function updateRole(targetId){
      const newRole = document.getElementById('role-' + targetId).value;
      await fetch('/kanri/update-role/' + targetId, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ userId: adminId, newRole })
      });
      alert('権限を変更しました');
      loadUsers();
    }

    async function deleteUser(targetId){
      if(!confirm('本当に削除しますか？')) return;
      await fetch('/kanri/delete-user/' + targetId + '?userId=' + adminId, { method:'POST' });
      loadUsers();
    }

    async function loadPosts() {
      const res = await fetch('/kanri/data?userId=' + adminId);
      const posts = await res.json();
      const container = document.getElementById('postsContainer');
      container.innerHTML = '';

      posts.forEach(p=>{
        const div = document.createElement('div');
        div.className='post';
        div.innerHTML = \`
          <strong>\${p.title}</strong> by \${p.author} [\${p.category}]
          <button onclick="deletePost(\${p.id})">投稿削除</button>
          <ul id="comments-\${p.id}"></ul>
        \`;
        container.appendChild(div);
        const ul = div.querySelector('ul');
        p.comments.forEach(c=>{
          const li = document.createElement('li');
          li.className='comment';
          li.innerHTML = \`\${c.author}: \${c.content} <button onclick="deleteComment(\${p.id},\${c.id})">削除</button>\`;
          ul.appendChild(li);
        });
      });
    }

    async function deletePost(postId){
      await fetch('/kanri/delete-post/' + postId + '?userId=' + adminId, {method:'POST'});
      loadPosts();
    }

    async function deleteComment(postId, commentId){
      await fetch('/kanri/delete-comment/' + postId + '/' + commentId + '?userId=' + adminId, {method:'POST'});
      loadPosts();
    }
    </script>
  </body>
  </html>
  `;
  res.send(html);
});

// -------------------- Socket.io セットアップ --------------------
const http = require('http').createServer(app);
const { Server } = require('socket.io');
const io = new Server(http);

// Socket.io イベント
io.on("connection", (socket) => {
  socket.on("joinRoom", (roomId) => {
    socket.join(String(roomId));
  });

  socket.on("message", async (data) => {
    // data: { roomId, author, text }
    await db.read();
    const rid = Number(data.roomId);
    const room = db.data.rooms.find(r => r.id === rid);
    if (!room) return;

    room.messages ||= [];
    const msg = {
      id: Date.now(),
      author: data.author,
      text: data.text,
      time: new Date().toISOString()
    };
    room.messages.push(msg);
    await db.write();

    io.to(String(data.roomId)).emit("message", { roomId: data.roomId, author: data.author, text: data.text, time: msg.time });
  });
});

// -------------------- サーバー起動 --------------------
http.listen(port, ()=>console.log(`学習掲示板（リアルタイム）動作中: ${port}`));
