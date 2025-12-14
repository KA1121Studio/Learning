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

// lowdb セットアップ
const adapter = new JSONFile('db.json');
const db = new Low(adapter, { posts: [], users: [] });

async function initDB(){
  await db.read();
  db.data ||= {
    posts: [],
    users: [{ id:1, username:'admin', password:'admin123', role:'admin' }],
    rooms: []
  };
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

  const { data: post, error } = await supabase
    .from('posts')
    .select('comments')
    .eq('id', postId)
    .single();

  if (error || !post) {
    return res.status(404).json({ error: '投稿が見つからない' });
  }

  const newComment = { id: Date.now(), author, content };
  const updatedComments = [...(post.comments || []), newComment];

  await supabase
    .from('posts')
    .update({ comments: updatedComments })
    .eq('id', postId);

  res.json({ success: true });
});


// -------------------- 管理者 --------------------
app.post('/kanri/login', async (req,res)=>{
  const { username, password } = req.body;
  await db.read();
  const user = db.data.users.find(
    u=>u.username===username && u.password===password && u.role==='admin'
  );
  if(!user) return res.status(403).json({ error:'ログイン失敗' });
  res.json({ success:true, userId:user.id });
});


// -------------------- ルームAPI（Supabase） --------------------
function generateRoomId() {
  return Math.floor(100000 + Math.random() * 900000);
}

// ルーム一覧（管理・デバッグ用）
app.get('/rooms', async (req, res) => {
  const { data, error } = await supabase.from('rooms').select('*');
  if (error) return res.status(500).json({ error });
  res.json(data);
});

// ★ 自分が入った部屋だけ取得（完成ポイント）
app.get('/my-rooms', async (req, res) => {
  const user = req.query.user;
  if (!user) return res.json([]);

  const { data, error } = await supabase
    .from('members')
    .select('rooms(*)')
    .eq('user', user);

  if (error) return res.status(500).json({ error });

  const rooms = data
    .map(d => d.rooms)
    .filter(r => r); // 念のため

  res.json(rooms);
});

// ルーム作成
app.post('/rooms', async (req, res) => {
  const { name, creator } = req.body;

  const room = {
    id: generateRoomId(),
    name,
    creator
  };

  await supabase.from('rooms').insert(room);
  res.json({ success: true, room });
});

// ルーム参加
app.post('/rooms/:id/join', async (req, res) => {
  const roomId = Number(req.params.id);
  const { user } = req.body;

  await supabase
    .from('members')
    .insert({ room_id: roomId, user });

  res.json({ ok: true });
});

// メッセージ取得
app.get('/rooms/:roomId/messages', async (req, res) => {
  const roomId = Number(req.params.roomId);

  const { data } = await supabase
    .from('messages')
    .select('*')
    .eq('room_id', roomId)
    .order('time', { ascending: true });

  res.json(data);
});

// メッセージ投稿
app.post('/rooms/:roomId/messages', async (req, res) => {
  const roomId = Number(req.params.roomId);

  const msg = {
    id: Date.now(),
    room_id: roomId,
    author: req.body.author,
    text: req.body.text,
    time: new Date().toISOString()
  };

  await supabase.from('messages').insert(msg);
  res.json({ success: true });
});

// ルーム削除
app.delete('/rooms/:id', async (req, res) => {
  const roomId = Number(req.params.id);

  await supabase.from('messages').delete().eq('room_id', roomId);
  await supabase.from('members').delete().eq('room_id', roomId);
  await supabase.from('rooms').delete().eq('id', roomId);

  res.json({ ok: true });
});


// -------------------- Socket.io --------------------
const http = require('http').createServer(app);
const { Server } = require('socket.io');
const io = new Server(http);

io.on("connection", (socket) => {
  socket.on("joinRoom", (roomId) => {
    socket.join(String(roomId));
  });

  socket.on("message", async (data) => {
    const msg = {
      id: Date.now(),
      room_id: Number(data.roomId),
      author: data.author,
      text: data.text,
      time: new Date().toISOString()
    };

    await supabase.from('messages').insert(msg);

    io.to(String(data.roomId)).emit("message", msg);
  });
});

// -------------------- 起動 --------------------
http.listen(port, ()=>{
  console.log(`学習掲示板（リアルタイム）動作中: ${port}`);
});
