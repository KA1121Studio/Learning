const express = require('express');
const bodyParser = require('body-parser');
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');

const app = express();
const port = process.env.PORT || 3000;

// lowdb セットアップ
const adapter = new JSONFile('db.json');
const db = new Low(adapter, { posts: [], users: [] });  // ← この2つ目の引数を追加

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

app.post('/kanri/login', async (req,res)=>{
  const { username, password } = req.body;
  await db.read();
  const user = db.data.users.find(u=>u.username===username && u.password===password && u.role==='admin');
  if(!user) return res.status(403).json({ error:'ログイン失敗' });
  res.json({ success:true, userId:user.id });
});

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

app.get('/kanri/users', async (req,res)=>{
  const { userId } = req.query;
  await db.read();
  const admin = db.data.users.find(u=>u.id==userId);
  if(!admin || admin.role!=='admin') return res.status(403).send('アクセス拒否');

  res.json(db.data.users);
});

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

// ルーム作成（★members を追加）
app.post('/rooms', async (req, res) => {
  const { name, creator } = req.body;
  await db.read();

  const room = {
    id: Date.now(),
    name,
    creator,
    created_at: new Date().toISOString(),
    messages: [],
    members: [creator]   // ★追加
  };

  db.data.rooms.push(room);
  await db.write();

  res.json({ success: true, room });
});

// -------------------- ★ ルーム参加API（追加） --------------------
app.post('/rooms/:id/join', async (req, res) => {
  const roomId = Number(req.params.id);
  const { user } = req.body;

  await db.read();
  const room = db.data.rooms.find(r => r.id === roomId);
  if (!room) return res.status(404).json({ error: "not found" });

  room.members ||= [];
  if (!room.members.includes(user)) {
    room.members.push(user);
    await db.write();
  }

  res.json({ ok: true });
});
// ---------------------------------------------------------------

// ルームごとのメッセージ取得
app.get('/rooms/:roomId/messages', async (req, res) => {
  await db.read();
  const roomId = Number(req.params.roomId);
  const room = db.data.rooms.find(r => r.id === roomId);
  if (!room) return res.json([]);
  room.messages ||= [];
  res.json(room.messages);
});

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

// -------- 管理画面（パスワード保護） --------
app.get('/admin', (req, res) => {
  const pass = req.query.pass;
  if (pass !== 'kazuma1121') {
    return res.status(401).send('認証エラー: パスワードが違うよ');
  }
  res.sendFile(__dirname + '/public/admin.html');
});

// -------------------- 管理画面 HTML --------------------
app.get('/kanri', (req,res)=>{
  const html = `...（ここはそのまま）...`;
  res.send(html);
});

// -------------------- Socket.io セットアップ --------------------
const http = require('http').createServer(app);
const { Server } = require('socket.io');
const io = new Server(http);

io.on("connection", (socket) => {
  socket.on("joinRoom", (roomId) => {
    socket.join(String(roomId));
  });

  socket.on("message", async (data) => {
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

    io.to(String(data.roomId))
      .emit("message", { roomId: data.roomId, author: data.author, text: data.text, time: msg.time });
  });
});

// -------------------- サーバー起動 --------------------
http.listen(port, ()=>console.log(`学習掲示板（リアルタイム）動作中: ${port}`));
