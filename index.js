// ------------------------------------
// 必要な追加 (Supabase)
// ------------------------------------
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ------------------------------------
const express = require('express');
const bodyParser = require('body-parser');
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');

const app = express();
const port = process.env.PORT || 3000;

// lowdb セットアップ（投稿 / 管理系は今のまま保持）
const adapter = new JSONFile('db.json');
const db = new Low(adapter, { posts: [], users: [] });

async function initDB(){
  await db.read();
  db.data ||= { posts: [], users: [{ id:1, username:'admin', password:'admin123', role:'admin' }], rooms: [] };
  await db.write();
}
initDB();

app.use(bodyParser.json());
app.use(express.static('public'));


// -------------------- 投稿・コメント API --------------------
app.get('/posts', async (req,res)=>{
  await db.read();
  const category = req.query.category;
  let posts = db.data.posts;
  if(category) posts = posts.filter(p=>p.category===category);
  res.json(posts);
});

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

app.post('/posts/:postId/comments', async (req, res) => {
  const postId = Number(req.params.postId);
  const { author, content } = req.body;

  // 1. 投稿取得
  const { data: post, error: selectError } = await supabase
    .from('posts')
    .select('comments')
    .eq('id', postId)
    .single();

  if (selectError || !post) {
    console.error(selectError);
    return res.status(404).json({ error: '投稿が見つからない' });
  }

  // 2. コメント追加
  const newComment = {
    id: Date.now(),
    author,
    content
  };

  const updatedComments = [...(post.comments || []), newComment];

  // 3. UPDATE
  const { error: updateError } = await supabase
    .from('posts')
    .update({ comments: updatedComments })
    .eq('id', postId);

  if (updateError) {
    console.error(updateError);
    return res.status(500).json({ error: 'コメント保存でエラー' });
  }

  res.json({ success: true });
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


// -------------------- ルームAPI：ここから Supabase 化 --------------------

// ルームID生成（そのまま）
function generateRoomId() {
  return Math.floor(100000 + Math.random() * 900000);
}

// ★ Supabase 版：ルーム一覧
app.get('/rooms', async (req, res) => {
  const { data, error } = await supabase.from('rooms').select('*');
  if (error) return res.status(500).json({ error });
  res.json(data);
});

// ★ Supabase 版：ルーム作成
app.post('/rooms', async (req, res) => {
  const { name, creator } = req.body;

  const room = {
    id: generateRoomId(),
    name,
    creator
  };

  const { error } = await supabase.from('rooms').insert(room);
  if (error) return res.status(500).json({ error });

  res.json({ success: true, room });
});

// ★ Supabase 版：ルーム参加
app.post('/rooms/:id/join', async (req, res) => {
  const roomId = Number(req.params.id);
  const { user } = req.body;

  const member = { room_id: roomId, user };
  const { error } = await supabase.from('members').insert(member);

  if (error) return res.status(500).json({ error });
  res.json({ ok: true });
});

// ★ Supabase 版：メッセージ一覧
app.get('/rooms/:roomId/messages', async (req, res) => {
  const roomId = Number(req.params.roomId);

  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('room_id', roomId)
    .order('time', { ascending: true });

  if (error) return res.status(500).json({ error });
  res.json(data);
});

// ★ Supabase 版：メッセージ投稿
app.post('/rooms/:roomId/messages', async (req, res) => {
  const roomId = Number(req.params.roomId);

  const msg = {
    id: Date.now(),
    room_id: roomId,
    author: req.body.author,
    text: req.body.text,
    time: new Date().toISOString()
  };

  const { error } = await supabase.from('messages').insert(msg);
  if (error) return res.status(500).json({ error });

  res.json({ success: true });
});

// ★ Supabase 版：ルーム削除
app.delete('/rooms/:id', async (req, res) => {
  const roomId = Number(req.params.id);

  await supabase.from('messages').delete().eq('room_id', roomId);
  await supabase.from('members').delete().eq('room_id', roomId);

  const { error } = await supabase.from('rooms').delete().eq('id', roomId);
  if (error) return res.status(500).json({ error });

  res.json({ ok: true });
});


// -------------------- 管理画面 HTML --------------------
app.get('/kanri', (req,res)=>{
  const html = `...（省略）...`;
  res.send(html);
});


// -------------------- Socket.io --------------------
const http = require('http').createServer(app);
const { Server } = require('socket.io');
const io = new Server(http);

// ★ メッセージ保存は Supabase 化
io.on("connection", (socket) => {
  socket.on("joinRoom", (roomId) => {
    socket.join(String(roomId));
  });

socket.on("message", async (data) => {
  const rid = Number(data.roomId);

  const msg = {
    room_id: rid,
    author: data.author,
    text: data.text,
    time: new Date().toISOString()
  };

  const { error } = await supabase.from('messages').insert(msg);

  if (error) {
    console.error('Supabase insert error:', error);
    return;
  }

  io.to(String(data.roomId))
    .emit("message", msg);
});


// -------------------- サーバー起動 --------------------
http.listen(port, ()=>console.log(`学習掲示板（リアルタイム）動作中: ${port}`));
